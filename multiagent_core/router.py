"""Progressive local-first provider selection with fallback."""

from __future__ import annotations

from typing import Any, Iterable

from .cost import AICostController, BudgetExceeded
from .models import ProviderResult
from .providers import BaseProvider, ProviderUnavailable


class NoProviderAvailable(RuntimeError):
    pass


class AIRouter:
    def __init__(
        self, providers: Iterable[BaseProvider], *, cost_controller: AICostController | None = None,
        local_first: bool = True,
    ) -> None:
        self.providers = list(providers)
        self.cost_controller = cost_controller
        self.local_first = local_first

    def candidates(
        self, capability: str = "text", preferred: str | None = None, *,
        min_quality: float = 0.0, max_latency_ms: int | None = None, allow_network: bool = True,
    ) -> list[BaseProvider]:
        available = [
            p for p in self.providers
            if capability in p.capabilities and p.is_available()
            and p.quality_score >= min_quality
            and (max_latency_ms is None or p.typical_latency_ms <= max_latency_ms)
            and (allow_network or not p.requires_network)
        ]
        return sorted(
            available,
            key=lambda p: (
                0 if preferred and p.name == preferred else 1,
                0 if self.local_first and not p.requires_network else 1,
                p.cost_per_1k_input + p.cost_per_1k_output,
                p.typical_latency_ms,
                -p.quality_score,
            ),
        )

    def generate(
        self, prompt: str, *, capability: str = "text", preferred: str | None = None,
        input_tokens: int | None = None, expected_output_tokens: int = 0,
        use_cache: bool = True, project_id: str | None = None, task_id: str | None = None,
        min_quality: float = 0.0, max_latency_ms: int | None = None, allow_network: bool = True,
        **options: Any,
    ) -> ProviderResult:
        failures: list[str] = []
        estimated_input = input_tokens if input_tokens is not None else max(1, len(prompt) // 4)
        candidates = self.candidates(
            capability, preferred, min_quality=min_quality,
            max_latency_ms=max_latency_ms, allow_network=allow_network,
        )
        if not candidates:
            raise NoProviderAvailable(f"no available provider supports {capability!r}")
        for provider in candidates:
            key = None
            if self.cost_controller:
                cache_options = {**options, "project_id": project_id, "task_id": task_id}
                key = self.cost_controller.cache_key(prompt, provider.name, provider.model, cache_options)
                if use_cache:
                    cached = self.cost_controller.get_cached(key)
                    if cached:
                        return cached
                estimate = provider.estimate_cost(
                    input_tokens=estimated_input, output_tokens=expected_output_tokens
                )
                try:
                    self.cost_controller.check_budget(
                        estimate, provider=provider.name, project_id=project_id, task_id=task_id
                    )
                except BudgetExceeded as exc:
                    failures.append(f"{provider.name}: {exc}")
                    continue
            try:
                result = provider.generate(prompt, **options)
            except ProviderUnavailable as exc:
                failures.append(f"{provider.name}: {exc}")
                continue
            if self.cost_controller:
                self.cost_controller.record(
                    result, {"capability": capability, "project_id": project_id, "task_id": task_id}
                )
                if use_cache and key is not None:
                    self.cost_controller.put_cached(key, result)
            return result
        raise NoProviderAvailable("all providers failed or exceeded budget: " + "; ".join(failures))
