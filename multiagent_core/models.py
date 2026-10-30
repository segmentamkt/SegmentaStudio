"""Domain models.  Kept dependency-free so adapters can reuse them."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TaskStatus(str, Enum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    RETRY_WAIT = "retry_wait"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {
    TaskStatus.SUCCEEDED,
    TaskStatus.FAILED,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
}


@dataclass
class Task:
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid4()))
    status: TaskStatus = TaskStatus.PENDING
    priority: int = 0
    dependencies: list[str] = field(default_factory=list)
    attempts: int = 0
    max_attempts: int = 3
    result: Any = None
    error: str | None = None
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    available_at: datetime = field(default_factory=utc_now)
    lease_until: datetime | None = None
    worker_id: str | None = None
    lease_token: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.kind.strip():
            raise ValueError("task kind cannot be empty")
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if self.id in self.dependencies:
            raise ValueError("a task cannot depend on itself")
        for name in ("created_at", "updated_at", "available_at", "lease_until"):
            value = getattr(self, name)
            if value is not None and value.tzinfo is None:
                setattr(self, name, value.replace(tzinfo=timezone.utc))


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


@dataclass(frozen=True)
class ProviderResult:
    content: str
    provider: str
    model: str = ""
    usage: Usage = Usage()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    cached: bool = False


@dataclass(frozen=True)
class ProviderDiagnostics:
    """Pre-flight state without claiming that a model was executed."""

    installed: bool
    authenticated: bool | None = None
    reachable: bool | None = None
    executed: bool = False
    stage: str = "installed"
    code: str = ""
    message: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ProviderExecution:
    """Normalized evidence for a provider attempt."""

    provider_id: str
    capability: str
    diagnostics: ProviderDiagnostics
    status_code: str = "SKIPPED_PRECONDITION"
    model: str = ""
    latency_ms: float = 0.0
    cost_usd: float = 0.0
    error_stage: str | None = None
    error_code: str | None = None

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["diagnostics"] = self.diagnostics.as_dict()
        return data


@dataclass(frozen=True)
class CollaborationAttempt:
    """Auditable outcome of one provider call in a collaboration phase."""

    id: str
    round_id: str
    phase: str
    provider: str
    status: str
    started_at: datetime
    finished_at: datetime
    result: ProviderResult | None = None
    error: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded" and self.result is not None


@dataclass
class CollaborationRound:
    """Independent proposals, peer reviews and the evidenced integration."""

    prompt: str
    id: str = field(default_factory=lambda: str(uuid4()))
    status: str = "running"
    contributions: list[CollaborationAttempt] = field(default_factory=list)
    reviews: list[CollaborationAttempt] = field(default_factory=list)
    integration: CollaborationAttempt | None = None
    created_at: datetime = field(default_factory=utc_now)
    completed_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def content(self) -> str | None:
        if self.integration and self.integration.succeeded:
            return self.integration.result.content  # type: ignore[union-attr]
        return None


@dataclass(frozen=True)
class TaskEvent:
    task_id: str
    event: str
    at: datetime
    details: Mapping[str, Any] = field(default_factory=dict)
