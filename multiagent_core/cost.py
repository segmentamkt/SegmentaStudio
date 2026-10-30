"""Budgets, response cache and usage telemetry for AI calls."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from .models import ProviderResult, Usage
from .storage import SQLiteStore, _dt, _parse_dt


class BudgetExceeded(RuntimeError):
    pass


class AICostController:
    def __init__(
        self, store: SQLiteStore, *, daily_budget_usd: float | None = None,
        monthly_budget_usd: float | None = None, per_request_budget_usd: float | None = None,
        provider_budgets_usd: dict[str, float] | None = None,
        project_budgets_usd: dict[str, float] | None = None,
        task_budgets_usd: dict[str, float] | None = None,
        default_cache_ttl_seconds: int = 3600,
    ) -> None:
        self.store = store
        self.daily_budget_usd = daily_budget_usd
        self.monthly_budget_usd = monthly_budget_usd
        self.per_request_budget_usd = per_request_budget_usd
        self.provider_budgets_usd = dict(provider_budgets_usd or {})
        self.project_budgets_usd = dict(project_budgets_usd or {})
        self.task_budgets_usd = dict(task_budgets_usd or {})
        self.default_cache_ttl_seconds = default_cache_ttl_seconds

    @staticmethod
    def cache_key(prompt: str, provider: str = "", model: str = "", options: Any = None) -> str:
        canonical = json.dumps(
            {"prompt": prompt, "provider": provider, "model": model, "options": options or {}},
            sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str,
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    def check_budget(
        self, estimated_cost_usd: float = 0.0, *, at: datetime | None = None,
        provider: str | None = None, project_id: str | None = None, task_id: str | None = None,
    ) -> None:
        at = at or datetime.now(timezone.utc)
        if self.per_request_budget_usd is not None and estimated_cost_usd > self.per_request_budget_usd:
            raise BudgetExceeded("estimated request cost exceeds per-request budget")
        if self.daily_budget_usd is not None and self.spent_since(at.replace(hour=0, minute=0, second=0, microsecond=0)) + estimated_cost_usd > self.daily_budget_usd:
            raise BudgetExceeded("daily AI budget exceeded")
        month_start = at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if self.monthly_budget_usd is not None and self.spent_since(month_start) + estimated_cost_usd > self.monthly_budget_usd:
            raise BudgetExceeded("monthly AI budget exceeded")
        scopes = (
            ("provider", provider, self.provider_budgets_usd),
            ("project", project_id, self.project_budgets_usd),
            ("task", task_id, self.task_budgets_usd),
        )
        for label, value, limits in scopes:
            if value is not None and value in limits:
                spent = self.spent_for_scope(label, value)
                if spent + estimated_cost_usd > limits[value]:
                    raise BudgetExceeded(f"{label} AI budget exceeded: {value}")

    def spent_since(self, since: datetime) -> float:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT COALESCE(SUM(cost_usd),0) AS total FROM ai_usage WHERE at>=?", (_dt(since),)
            ).fetchone()
        return float(row["total"])

    def spent_for_scope(self, scope: str, value: str) -> float:
        with self.store.lock:
            rows = self.store.connection.execute("SELECT provider,cost_usd,metadata FROM ai_usage").fetchall()
        total = 0.0
        for row in rows:
            metadata = json.loads(row["metadata"])
            matches = row["provider"] == value if scope == "provider" else metadata.get(f"{scope}_id") == value
            if matches:
                total += float(row["cost_usd"])
        return total

    def record(self, result: ProviderResult, metadata: dict[str, Any] | None = None) -> None:
        usage = result.usage
        with self.store.transaction(immediate=True) as conn:
            conn.execute(
                """INSERT INTO ai_usage(at,provider,model,input_tokens,output_tokens,cost_usd,metadata)
                   VALUES(?,?,?,?,?,?,?)""",
                (_dt(datetime.now(timezone.utc)), result.provider, result.model, usage.input_tokens,
                 usage.output_tokens, usage.cost_usd, json.dumps(metadata or {}, default=str)),
            )

    def put_cached(self, key: str, result: ProviderResult, *, ttl_seconds: int | None = None) -> None:
        ttl = self.default_cache_ttl_seconds if ttl_seconds is None else ttl_seconds
        now = datetime.now(timezone.utc)
        expires = now + timedelta(seconds=ttl) if ttl >= 0 else None
        value = json.dumps({
            "content": result.content, "provider": result.provider, "model": result.model,
            "usage": {"input_tokens": result.usage.input_tokens, "output_tokens": result.usage.output_tokens,
                      "cost_usd": result.usage.cost_usd}, "metadata": dict(result.metadata),
        }, ensure_ascii=False, default=str)
        with self.store.transaction(immediate=True) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO ai_cache(cache_key,value,expires_at,created_at) VALUES(?,?,?,?)",
                (key, value, _dt(expires), _dt(now)),
            )

    def get_cached(self, key: str, *, now: datetime | None = None) -> ProviderResult | None:
        now = now or datetime.now(timezone.utc)
        with self.store.transaction(immediate=True) as conn:
            row = conn.execute("SELECT value,expires_at FROM ai_cache WHERE cache_key=?", (key,)).fetchone()
            if not row:
                return None
            if row["expires_at"] and _parse_dt(row["expires_at"]) <= now:
                conn.execute("DELETE FROM ai_cache WHERE cache_key=?", (key,))
                return None
            data = json.loads(row["value"])
        usage = Usage(**data["usage"])
        return ProviderResult(data["content"], data["provider"], data["model"], usage, data["metadata"], True)

    def telemetry(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT * FROM ai_usage ORDER BY id DESC LIMIT ?", (max(0, limit),)
            ).fetchall()
        return [dict(row) | {"metadata": json.loads(row["metadata"])} for row in rows]
