"""SQLite persistence used by the queue and cost controller."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .models import (
    CollaborationAttempt,
    CollaborationRound,
    ProviderResult,
    Task,
    TaskEvent,
    TaskStatus,
    Usage,
)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _dt(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def _parse_dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


class SQLiteStore:
    """Thread-safe SQLite store with explicit transactions and WAL mode."""

    def __init__(self, path: str | Path = "multiagent.db") -> None:
        self.path = str(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.execute("PRAGMA busy_timeout=10000")
        self._create_schema()

    def _create_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
                status TEXT NOT NULL, priority INTEGER NOT NULL,
                dependencies TEXT NOT NULL, attempts INTEGER NOT NULL,
                max_attempts INTEGER NOT NULL, result TEXT, error TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                available_at TEXT NOT NULL, lease_until TEXT, worker_id TEXT,
                lease_token INTEGER NOT NULL DEFAULT 0,
                metadata TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_claim
                ON tasks(status, available_at, priority DESC, created_at);
            CREATE TABLE IF NOT EXISTS task_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
                event TEXT NOT NULL, at TEXT NOT NULL, details TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS ai_cache (
                cache_key TEXT PRIMARY KEY, value TEXT NOT NULL,
                expires_at TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
                provider TEXT NOT NULL, model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
                cost_usd REAL NOT NULL, metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS collaboration_rounds (
                id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, completed_at TEXT,
                integrated_content TEXT, metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_runs (
                id TEXT PRIMARY KEY, round_id TEXT NOT NULL, phase TEXT NOT NULL,
                provider TEXT NOT NULL, status TEXT NOT NULL,
                started_at TEXT NOT NULL, finished_at TEXT NOT NULL,
                latency_ms REAL NOT NULL, result_content TEXT, model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cost_usd REAL NOT NULL DEFAULT 0, error TEXT, metadata TEXT NOT NULL,
                FOREIGN KEY(round_id) REFERENCES collaboration_rounds(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_provider_runs_round
                ON provider_runs(round_id, phase, started_at);
            """
        )
        columns = {row["name"] for row in self._conn.execute("PRAGMA table_info(tasks)")}
        if "lease_token" not in columns:
            self._conn.execute(
                "ALTER TABLE tasks ADD COLUMN lease_token INTEGER NOT NULL DEFAULT 0"
            )

    @contextmanager
    def transaction(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
            try:
                yield self._conn
            except Exception:
                self._conn.rollback()
                raise
            else:
                self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @staticmethod
    def database_now(conn: sqlite3.Connection) -> datetime:
        """Use the database clock so independent workers compare the same timeline."""
        seconds = conn.execute(
            "SELECT (julianday('now') - 2440587.5) * 86400.0"
        ).fetchone()[0]
        # SQLite's clock is millisecond-granular on some macOS builds.  The
        # small ceiling prevents a just-created Python timestamp from landing
        # fractionally after the later database reading.
        return datetime.fromtimestamp(float(seconds), tz=timezone.utc) + timedelta(milliseconds=1)

    def add_task(self, task: Task) -> Task:
        with self.transaction(immediate=True) as conn:
            conn.execute(
                """INSERT INTO tasks(
                    id,kind,payload,status,priority,dependencies,attempts,max_attempts,
                    result,error,created_at,updated_at,available_at,lease_until,
                    worker_id,lease_token,metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                self.task_values(task),
            )
            self._add_event(conn, task.id, "enqueued", {"status": task.status.value})
        return task

    @staticmethod
    def task_values(task: Task) -> tuple[Any, ...]:
        return (
            task.id, task.kind, _dump(task.payload), task.status.value, task.priority,
            _dump(task.dependencies), task.attempts, task.max_attempts,
            None if task.result is None else _dump(task.result), task.error,
            _dt(task.created_at), _dt(task.updated_at), _dt(task.available_at),
            _dt(task.lease_until), task.worker_id, task.lease_token, _dump(task.metadata),
        )

    def get_task(self, task_id: str) -> Task | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return self.row_to_task(row) if row else None

    def list_tasks(self, status: TaskStatus | str | None = None) -> list[Task]:
        query, args = "SELECT * FROM tasks", ()
        if status is not None:
            value = status.value if isinstance(status, TaskStatus) else status
            query, args = query + " WHERE status=?", (value,)
        query += " ORDER BY priority DESC, created_at, id"
        with self._lock:
            rows = self._conn.execute(query, args).fetchall()
        return [self.row_to_task(row) for row in rows]

    def events(self, task_id: str) -> list[TaskEvent]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT task_id,event,at,details FROM task_events WHERE task_id=? ORDER BY id",
                (task_id,),
            ).fetchall()
        return [TaskEvent(r["task_id"], r["event"], _parse_dt(r["at"]), json.loads(r["details"])) for r in rows]

    def create_collaboration_round(self, round_: CollaborationRound) -> None:
        with self.transaction(immediate=True) as conn:
            conn.execute(
                """INSERT INTO collaboration_rounds
                   (id,prompt,status,created_at,completed_at,integrated_content,metadata)
                   VALUES(?,?,?,?,?,?,?)""",
                (round_.id, round_.prompt, round_.status, _dt(round_.created_at),
                 _dt(round_.completed_at), round_.content, _dump(round_.metadata)),
            )

    def record_collaboration_attempt(self, attempt: CollaborationAttempt) -> None:
        result = attempt.result
        usage = result.usage if result else Usage()
        latency_ms = max(0.0, (attempt.finished_at - attempt.started_at).total_seconds() * 1000)
        metadata = dict(attempt.metadata)
        if result:
            metadata["provider_metadata"] = dict(result.metadata)
        with self.transaction(immediate=True) as conn:
            conn.execute(
                """INSERT INTO provider_runs
                   (id,round_id,phase,provider,status,started_at,finished_at,latency_ms,
                    result_content,model,input_tokens,output_tokens,cost_usd,error,metadata)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (attempt.id, attempt.round_id, attempt.phase, attempt.provider,
                 attempt.status, _dt(attempt.started_at), _dt(attempt.finished_at),
                 latency_ms, result.content if result else None,
                 result.model if result else "", usage.input_tokens,
                 usage.output_tokens, usage.cost_usd, attempt.error, _dump(metadata)),
            )

    def finish_collaboration_round(self, round_: CollaborationRound) -> None:
        with self.transaction(immediate=True) as conn:
            updated = conn.execute(
                """UPDATE collaboration_rounds SET status=?,completed_at=?,
                   integrated_content=?,metadata=? WHERE id=?""",
                (round_.status, _dt(round_.completed_at), round_.content,
                 _dump(round_.metadata), round_.id),
            )
            if updated.rowcount != 1:
                raise KeyError(round_.id)

    def collaboration_attempts(self, round_id: str) -> list[CollaborationAttempt]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM provider_runs WHERE round_id=? ORDER BY started_at,id",
                (round_id,),
            ).fetchall()
        attempts: list[CollaborationAttempt] = []
        for row in rows:
            metadata = json.loads(row["metadata"])
            provider_metadata = metadata.pop("provider_metadata", {})
            result = None
            if row["status"] == "succeeded":
                result = ProviderResult(
                    row["result_content"], row["provider"], row["model"] or "",
                    Usage(row["input_tokens"], row["output_tokens"], row["cost_usd"]),
                    provider_metadata,
                )
            attempts.append(CollaborationAttempt(
                id=row["id"], round_id=row["round_id"], phase=row["phase"],
                provider=row["provider"], status=row["status"],
                started_at=_parse_dt(row["started_at"]),
                finished_at=_parse_dt(row["finished_at"]), result=result,
                error=row["error"], metadata=metadata,
            ))
        return attempts

    def get_collaboration_round(self, round_id: str) -> CollaborationRound | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM collaboration_rounds WHERE id=?", (round_id,)
            ).fetchone()
        if not row:
            return None
        attempts = self.collaboration_attempts(round_id)
        integrations = [item for item in attempts if item.phase == "integration"]
        return CollaborationRound(
            id=row["id"], prompt=row["prompt"], status=row["status"],
            contributions=[item for item in attempts if item.phase == "independent"],
            reviews=[item for item in attempts if item.phase == "review"],
            integration=integrations[-1] if integrations else None,
            created_at=_parse_dt(row["created_at"]),
            completed_at=_parse_dt(row["completed_at"]),
            metadata=json.loads(row["metadata"]),
        )

    @staticmethod
    def _add_event(conn: sqlite3.Connection, task_id: str, event: str, details: Any) -> None:
        conn.execute(
            "INSERT INTO task_events(task_id,event,at,details) VALUES(?,?,?,?)",
            (task_id, event, _dt(datetime.now(timezone.utc)), _dump(details)),
        )

    @staticmethod
    def row_to_task(row: sqlite3.Row) -> Task:
        return Task(
            id=row["id"], kind=row["kind"], payload=json.loads(row["payload"]),
            status=TaskStatus(row["status"]), priority=row["priority"],
            dependencies=json.loads(row["dependencies"]), attempts=row["attempts"],
            max_attempts=row["max_attempts"],
            result=json.loads(row["result"]) if row["result"] is not None else None,
            error=row["error"], created_at=_parse_dt(row["created_at"]),
            updated_at=_parse_dt(row["updated_at"]), available_at=_parse_dt(row["available_at"]),
            lease_until=_parse_dt(row["lease_until"]), worker_id=row["worker_id"],
            lease_token=row["lease_token"],
            metadata=json.loads(row["metadata"]),
        )

    @property
    def connection(self) -> sqlite3.Connection:
        """Low-level access for cooperating core components."""
        return self._conn

    @property
    def lock(self) -> threading.RLock:
        return self._lock
