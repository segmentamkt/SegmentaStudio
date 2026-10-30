"""Durable task queue with dependencies, leases, retries and recovery."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .models import TERMINAL_STATUSES, Task, TaskStatus
from .storage import SQLiteStore, _dt


class TaskQueue:
    def __init__(self, store: SQLiteStore, *, retry_base_seconds: float = 1.0) -> None:
        self.store = store
        self.retry_base_seconds = retry_base_seconds

    def enqueue(self, task: Task | str, payload: dict[str, Any] | None = None, **kwargs: Any) -> Task:
        item = task if isinstance(task, Task) else Task(kind=task, payload=payload or {}, **kwargs)
        for dependency in item.dependencies:
            if self.store.get_task(dependency) is None:
                raise ValueError(f"unknown dependency: {dependency}")
        return self.store.add_task(item)

    def claim_next(
        self, worker_id: str, *, lease_seconds: float = 60.0, now: datetime | None = None
    ) -> Task | None:
        with self.store.transaction(immediate=True) as conn:
            now = now or self.store.database_now(conn)
            lease_until = now + timedelta(seconds=lease_seconds)
            rows = conn.execute(
                """SELECT * FROM tasks
                   WHERE status IN ('pending','ready','retry_wait') AND available_at<=?
                   ORDER BY priority DESC, created_at, id""",
                (_dt(now),),
            ).fetchall()
            for row in rows:
                task = self.store.row_to_task(row)
                dep_states = self._dependency_states(conn, task.dependencies)
                if any(state in {TaskStatus.FAILED, TaskStatus.BLOCKED, TaskStatus.CANCELLED} for state in dep_states):
                    conn.execute(
                        "UPDATE tasks SET status='blocked',error=?,updated_at=? WHERE id=?",
                        ("dependency did not succeed", _dt(now), task.id),
                    )
                    self.store._add_event(conn, task.id, "blocked", {"reason": "dependency"})
                    continue
                if any(state != TaskStatus.SUCCEEDED for state in dep_states):
                    continue
                updated = conn.execute(
                    """UPDATE tasks SET status='running', attempts=attempts+1,
                       worker_id=?, lease_until=?, lease_token=lease_token+1,
                       updated_at=?, error=NULL
                       WHERE id=? AND status IN ('pending','ready','retry_wait')""",
                    (worker_id, _dt(lease_until), _dt(now), task.id),
                )
                if updated.rowcount:
                    claimed = self.store.row_to_task(
                        conn.execute("SELECT * FROM tasks WHERE id=?", (task.id,)).fetchone()
                    )
                    self.store._add_event(
                        conn, task.id, "claimed",
                        {"worker_id": worker_id, "lease_token": claimed.lease_token},
                    )
                    return claimed
        return None

    @staticmethod
    def _dependency_states(conn: Any, dependencies: list[str]) -> list[TaskStatus]:
        if not dependencies:
            return []
        placeholders = ",".join("?" for _ in dependencies)
        rows = conn.execute(
            f"SELECT id,status FROM tasks WHERE id IN ({placeholders})", dependencies
        ).fetchall()
        found = {row["id"]: TaskStatus(row["status"]) for row in rows}
        return [found.get(dep, TaskStatus.BLOCKED) for dep in dependencies]

    def complete(self, task_id: str, result: Any, *, worker_id: str, lease_token: int) -> Task:
        import json
        with self.store.transaction(immediate=True) as conn:
            now = self.store.database_now(conn)
            row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise KeyError(task_id)
            task = self.store.row_to_task(row)
            self._assert_running_owner(task, worker_id, lease_token)
            updated = conn.execute(
                """UPDATE tasks SET status='succeeded',result=?,updated_at=?,
                   lease_until=NULL,worker_id=NULL WHERE id=? AND status='running'
                   AND worker_id=? AND lease_token=?""",
                (json.dumps(result, ensure_ascii=False, default=str), _dt(now), task_id,
                 worker_id, lease_token),
            )
            if updated.rowcount != 1:
                raise PermissionError("task lease changed before completion")
            self.store._add_event(conn, task_id, "succeeded", {})
            return self.store.row_to_task(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())

    def fail(
        self, task_id: str, error: str, *, worker_id: str, lease_token: int,
        now: datetime | None = None, retryable: bool = True,
    ) -> Task:
        with self.store.transaction(immediate=True) as conn:
            now = now or self.store.database_now(conn)
            row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise KeyError(task_id)
            task = self.store.row_to_task(row)
            self._assert_running_owner(task, worker_id, lease_token)
            retry = retryable and task.attempts < task.max_attempts
            status = TaskStatus.RETRY_WAIT if retry else TaskStatus.FAILED
            delay = self.retry_base_seconds * (2 ** max(task.attempts - 1, 0)) if retry else 0
            available_at = now + timedelta(seconds=delay)
            updated = conn.execute(
                """UPDATE tasks SET status=?,error=?,available_at=?,updated_at=?,
                   lease_until=NULL,worker_id=NULL WHERE id=? AND status='running'
                   AND worker_id=? AND lease_token=?""",
                (status.value, error, _dt(available_at), _dt(now), task_id,
                 worker_id, lease_token),
            )
            if updated.rowcount != 1:
                raise PermissionError("task lease changed before failure handling")
            self.store._add_event(conn, task_id, status.value, {"error": error, "delay_seconds": delay})
            return self.store.row_to_task(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())

    def recover_stale(self, *, now: datetime | None = None) -> int:
        recovered = 0
        with self.store.transaction(immediate=True) as conn:
            now = now or self.store.database_now(conn)
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status='running' AND lease_until IS NOT NULL AND lease_until<?",
                (_dt(now),),
            ).fetchall()
            for row in rows:
                task = self.store.row_to_task(row)
                status = TaskStatus.RETRY_WAIT if task.attempts < task.max_attempts else TaskStatus.FAILED
                conn.execute(
                    """UPDATE tasks SET status=?,error='worker lease expired',available_at=?,
                       lease_until=NULL,worker_id=NULL,updated_at=? WHERE id=?""",
                    (status.value, _dt(now), _dt(now), task.id),
                )
                self.store._add_event(conn, task.id, "recovered", {"new_status": status.value})
                recovered += 1
        return recovered

    def cancel(self, task_id: str) -> Task:
        task = self.store.get_task(task_id)
        if not task:
            raise KeyError(task_id)
        if task.status in TERMINAL_STATUSES:
            return task
        with self.store.transaction(immediate=True) as conn:
            now = self.store.database_now(conn)
            conn.execute(
                """UPDATE tasks SET status='cancelled',updated_at=?,lease_until=NULL,
                   worker_id=NULL,lease_token=lease_token+1 WHERE id=?""",
                (_dt(now), task_id),
            )
            self.store._add_event(conn, task_id, "cancelled", {})
        return self.store.get_task(task_id)  # type: ignore[return-value]

    @staticmethod
    def _assert_running_owner(task: Task, worker_id: str, lease_token: int) -> None:
        if task.status != TaskStatus.RUNNING:
            raise ValueError(f"task {task.id} is not running")
        if task.worker_id != worker_id:
            raise PermissionError("task is leased to another worker")
        if task.lease_token != lease_token:
            raise PermissionError("task lease token is stale")
