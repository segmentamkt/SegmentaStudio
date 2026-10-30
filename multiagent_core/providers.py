"""Replaceable provider adapters; paid providers fail closed without credentials."""

from __future__ import annotations

import json
import os
import shutil
import shlex
import subprocess
import time
from abc import ABC, abstractmethod
from typing import Any, Callable, Iterable, Mapping

from .models import ProviderDiagnostics, ProviderResult, Usage


class ProviderUnavailable(RuntimeError):
    pass


class BaseProvider(ABC):
    name = "base"
    model = ""
    capabilities: frozenset[str] = frozenset({"text"})
    cost_per_1k_input = 0.0
    cost_per_1k_output = 0.0
    requires_network = False
    quality_score = 1.0
    typical_latency_ms = 0

    def is_available(self) -> bool:
        return True

    def diagnose(self) -> ProviderDiagnostics:
        """Report preconditions separately from a real model execution."""
        return ProviderDiagnostics(
            installed=True, authenticated=True, reachable=True,
            executed=False, stage="ready", code="READY",
        )

    def estimate_cost(self, *, input_tokens: int = 0, output_tokens: int = 0) -> float:
        return input_tokens / 1000 * self.cost_per_1k_input + output_tokens / 1000 * self.cost_per_1k_output

    @abstractmethod
    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        raise NotImplementedError


class MockProvider(BaseProvider):
    name = "mock"

    def __init__(self, response: str | Callable[[str], str] = "mock response", *, model: str = "mock-v1") -> None:
        self.response = response
        self.model = model
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        self.calls.append((prompt, kwargs))
        content = self.response(prompt) if callable(self.response) else self.response
        return ProviderResult(content=content, provider=self.name, model=self.model)


class DryRunProvider(BaseProvider):
    name = "dry-run"
    model = "dry-run"
    quality_score = 0.0

    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        return ProviderResult(
            content="", provider=self.name, model=self.model,
            metadata={"would_send": prompt, "options": kwargs},
        )


class LocalCommandProvider(BaseProvider):
    """Executes an explicitly allowed local binary without invoking a shell."""

    name = "local-command"
    model = "local-command"

    def __init__(
        self, command: Iterable[str], *, allowed_executables: Iterable[str] | None = None,
        timeout_seconds: float = 30.0, environment: Mapping[str, str] | None = None,
    ) -> None:
        self.command = tuple(command)
        if not self.command:
            raise ValueError("command cannot be empty")
        executable = os.path.basename(self.command[0])
        allowed = set(allowed_executables or ())
        if executable not in allowed and self.command[0] not in allowed:
            raise ValueError("executable must be explicitly allowlisted")
        self.timeout_seconds = timeout_seconds
        self.environment = dict(environment or {})

    @classmethod
    def from_command_string(cls, command: str, **kwargs: Any) -> "LocalCommandProvider":
        return cls(shlex.split(command), **kwargs)

    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        env = {"PATH": os.environ.get("PATH", ""), "LANG": os.environ.get("LANG", "C.UTF-8")}
        env.update(self.environment)
        try:
            completed = subprocess.run(
                self.command, input=prompt, text=True, capture_output=True, timeout=self.timeout_seconds,
                check=False, shell=False, env=env,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProviderUnavailable(f"local command failed: {exc}") from exc
        if completed.returncode != 0:
            message = completed.stderr.strip()[:1000]
            raise ProviderUnavailable(f"local command exited {completed.returncode}: {message}")
        return ProviderResult(content=completed.stdout, provider=self.name, model=self.model)

    def diagnose(self) -> ProviderDiagnostics:
        executable = self.command[0]
        installed = (
            os.path.isfile(executable) and os.access(executable, os.X_OK)
            if os.path.isabs(executable)
            else shutil.which(executable) is not None
        )
        return ProviderDiagnostics(
            installed=installed,
            authenticated=None,
            reachable=None if installed else False,
            executed=False,
            stage="reachable" if installed else "installed",
            code="EXECUTABLE_PRESENT" if installed else "EXECUTABLE_MISSING",
            message="Execution is not used as a health check.",
        )


class _CredentialStub(BaseProvider):
    api_key_env = ""
    requires_network = True

    def __init__(self, *, api_key: str | None = None, model: str = "") -> None:
        self.api_key = api_key or os.environ.get(self.api_key_env)
        if model:
            self.model = model

    def is_available(self) -> bool:
        return bool(self.api_key)

    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        reason = f"{self.api_key_env} is not configured" if not self.api_key else "network client is not installed"
        raise ProviderUnavailable(f"{self.name} adapter unavailable: {reason}; inject a full adapter to enable it")

    def diagnose(self) -> ProviderDiagnostics:
        return ProviderDiagnostics(
            installed=False,
            authenticated=bool(self.api_key),
            reachable=None,
            executed=False,
            stage="installed",
            code="NETWORK_CLIENT_MISSING",
            message="Credentials alone do not prove provider reachability or execution.",
        )


class OpenAIProvider(_CredentialStub):
    name, api_key_env, model = "openai", "OPENAI_API_KEY", "gpt"


class AnthropicProvider(_CredentialStub):
    name, api_key_env, model = "anthropic", "ANTHROPIC_API_KEY", "claude"


class GeminiProvider(_CredentialStub):
    name, api_key_env, model = "gemini", "GEMINI_API_KEY", "gemini"


class AuthorizedAppProvider(BaseProvider):
    """Adapter for an app/connector whose authorization is verified externally.

    The core cannot inspect a desktop or cloud app session by itself, so callers
    must provide both the executor and explicit authorization evidence.
    """

    requires_network = True

    def __init__(
        self, name: str, executor: Callable[[str], str | ProviderResult], *,
        authorized: bool | Callable[[], bool], model: str = "authorized-app",
    ) -> None:
        if not name.strip():
            raise ValueError("app provider name cannot be empty")
        self.name = name
        self.executor = executor
        self.authorized = authorized
        self.model = model

    def is_available(self) -> bool:
        try:
            return bool(self.authorized() if callable(self.authorized) else self.authorized)
        except Exception:
            return False

    def diagnose(self) -> ProviderDiagnostics:
        authorized = self.is_available()
        return ProviderDiagnostics(
            installed=True, authenticated=authorized, reachable=None,
            executed=False, stage="authenticated", code="APP_AUTHORIZED" if authorized else "APP_NOT_AUTHORIZED",
            message="Reachability is established only by a requested execution.",
        )

    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        if not self.is_available():
            raise ProviderUnavailable(f"{self.name} app is not authorized")
        try:
            value = self.executor(prompt)
        except Exception as exc:
            raise ProviderUnavailable(f"{self.name} app execution failed: {exc}") from exc
        result = value if isinstance(value, ProviderResult) else ProviderResult(
            str(value), self.name, self.model, metadata={"executed": True, "authorized_app": True}
        )
        if not result.content.strip():
            raise ProviderUnavailable(f"{self.name} app returned no content")
        return result


class CLIProvider(BaseProvider):
    """Base for an installed, user-authenticated AI CLI.

    Availability only proves that an executable exists. Authentication and
    reachability are established by a successful real invocation; no hidden
    health-check request is made. Commands never pass through a shell.
    """

    executable_name = ""
    default_args: tuple[str, ...] = ()
    prompt_as_argument = False
    requires_network = True
    max_output_bytes = 2_000_000

    def __init__(
        self, *, executable: str | None = None, timeout_seconds: float = 120.0,
        extra_args: Iterable[str] = (), environment: Mapping[str, str] | None = None,
        model: str = "",
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self.executable = executable or shutil.which(self.executable_name)
        self.timeout_seconds = timeout_seconds
        self.extra_args = tuple(extra_args)
        self.environment = dict(environment or {})
        if model:
            self.model = model

    def is_available(self) -> bool:
        if not self.executable:
            return False
        if os.path.sep in self.executable:
            return os.path.isfile(self.executable) and os.access(self.executable, os.X_OK)
        return shutil.which(self.executable) is not None

    def diagnose(self) -> ProviderDiagnostics:
        installed = self.is_available()
        return ProviderDiagnostics(
            installed=installed, authenticated=None, reachable=None,
            executed=False, stage="installed",
            code="EXECUTABLE_PRESENT" if installed else "EXECUTABLE_MISSING",
            message="Authentication is verified only by a real requested invocation.",
        )

    def command(self, prompt: str) -> tuple[list[str], str | None]:
        if not self.executable:
            raise ProviderUnavailable(f"{self.executable_name} executable was not found")
        argv = [self.executable, *self.default_args, *self.extra_args]
        if self.prompt_as_argument:
            argv.append(prompt)
            return argv, None
        return argv, prompt

    def generate(self, prompt: str, **kwargs: Any) -> ProviderResult:
        if not self.is_available():
            raise ProviderUnavailable(f"{self.executable_name} executable was not found")
        argv, stdin = self.command(prompt)
        # These are explicitly selected AI CLIs, so preserve their authenticated
        # environment while still avoiding shell expansion or command injection.
        env = dict(os.environ)
        env.setdefault("LANG", "C.UTF-8")
        env["TERM"] = "dumb"
        env.update(self.environment)
        started = time.monotonic()
        try:
            completed = subprocess.run(
                argv, input=stdin, text=True, capture_output=True,
                timeout=self.timeout_seconds, check=False, shell=False, env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise ProviderUnavailable(
                f"{self.name} timed out after {self.timeout_seconds:g}s"
            ) from exc
        except OSError as exc:
            raise ProviderUnavailable(f"{self.name} could not start: {exc}") from exc
        latency_ms = (time.monotonic() - started) * 1000
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()[:2000]
            raise ProviderUnavailable(
                f"{self.name} exited {completed.returncode}: {detail or 'no diagnostic output'}"
            )
        raw = completed.stdout
        if len(raw.encode("utf-8")) > self.max_output_bytes:
            raise ProviderUnavailable(f"{self.name} output exceeded safety limit")
        content, parsed = self._parse_output(raw)
        if not content.strip():
            raise ProviderUnavailable(f"{self.name} returned no content")
        return ProviderResult(
            content=content, provider=self.name, model=self.model,
            metadata={
                "executed": True, "returncode": completed.returncode,
                "latency_ms": round(latency_ms, 3), "structured_output": parsed,
                "stderr": completed.stderr.strip()[:2000],
            },
        )

    @staticmethod
    def _parse_output(raw: str) -> tuple[str, bool]:
        stripped = raw.strip()
        if not stripped:
            return "", False
        candidates: list[Any] = []
        try:
            candidates.append(json.loads(stripped))
        except (ValueError, TypeError):
            for line in stripped.splitlines():
                try:
                    candidates.append(json.loads(line))
                except (ValueError, TypeError):
                    continue
        for value in reversed(candidates):
            if isinstance(value, str) and value.strip():
                return value, True
            if isinstance(value, dict):
                for key in ("result", "content", "response", "text", "message"):
                    text = value.get(key)
                    if isinstance(text, str) and text.strip():
                        return text, True
        return stripped, False


class CodexCLIProvider(CLIProvider):
    name = "codex-cli"
    executable_name = "codex"
    # Kiko Studio is also distributed as a plain local folder, not only as a
    # Git checkout. This flag keeps the authenticated CLI usable there.
    default_args = ("exec", "--skip-git-repo-check", "-")
    model = "codex-cli-default"


class ClaudeCLIProvider(CLIProvider):
    name = "claude-cli"
    executable_name = "claude"
    default_args = ("-p",)
    model = "claude-cli-default"


class GeminiCLIProvider(CLIProvider):
    name = "gemini-cli"
    executable_name = "gemini"
    default_args = ("-p",)
    prompt_as_argument = True
    model = "gemini-cli-default"


def detect_cli_providers(
    *, executables: Mapping[str, str] | None = None, include_unavailable: bool = False,
    timeout_seconds: float = 120.0,
) -> list[CLIProvider]:
    """Detect supported CLIs without executing them or claiming authentication."""

    configured = dict(executables or {})
    classes = (CodexCLIProvider, ClaudeCLIProvider, GeminiCLIProvider)
    providers = [
        cls(executable=configured.get(cls.executable_name), timeout_seconds=timeout_seconds)
        for cls in classes
    ]
    return providers if include_unavailable else [provider for provider in providers if provider.is_available()]
