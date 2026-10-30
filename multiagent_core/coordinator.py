"""Coordinator that connects the durable queue, router and task handlers."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Callable, Mapping

from .models import Task
from .providers import ProviderResult
from .queue import TaskQueue
from .router import AIRouter


TaskHandler = Callable[[Task], Any]


class Coordinator:
    def __init__(self, queue: TaskQueue, router: AIRouter, handlers: Mapping[str, TaskHandler] | None = None):
        self.queue = queue
        self.router = router
        self.handlers = dict(handlers or {})

    def register(self, kind: str, handler: TaskHandler) -> None:
        if not kind.strip():
            raise ValueError("kind cannot be empty")
        self.handlers[kind] = handler

    def run_once(self, worker_id: str = "local-worker") -> Task | None:
        task = self.queue.claim_next(worker_id)
        if task is None:
            return None
        try:
            if task.kind == "ai.prompt":
                prompt = str(task.payload.get("prompt", ""))
                if not prompt:
                    raise ValueError("ai.prompt requires a prompt")
                result = self.router.generate(
                    prompt,
                    capability=str(task.payload.get("capability", "text")),
                    preferred=task.payload.get("preferred_provider"),
                    expected_output_tokens=int(task.payload.get("expected_output_tokens", 0)),
                    project_id=task.metadata.get("project_id"), task_id=task.id,
                    min_quality=float(task.payload.get("min_quality", 0)),
                    max_latency_ms=task.payload.get("max_latency_ms"),
                    allow_network=bool(task.payload.get("allow_network", True)),
                )
                output: Any = self._provider_result(result)
            elif task.kind in self.handlers:
                output = self.handlers[task.kind](task)
            else:
                raise ValueError(f"no handler registered for task kind {task.kind!r}")
            return self.queue.complete(
                task.id, output, worker_id=worker_id, lease_token=task.lease_token
            )
        except Exception as exc:
            return self.queue.fail(
                task.id, f"{type(exc).__name__}: {exc}", worker_id=worker_id,
                lease_token=task.lease_token,
            )

    def run_available(self, worker_id: str = "local-worker", *, limit: int = 100) -> list[Task]:
        completed: list[Task] = []
        for _ in range(max(0, limit)):
            task = self.run_once(worker_id)
            if task is None:
                break
            completed.append(task)
        return completed

    @staticmethod
    def _provider_result(result: ProviderResult) -> dict[str, Any]:
        data = asdict(result)
        data["usage"] = asdict(result.usage)
        data["metadata"] = dict(result.metadata)
        return data

