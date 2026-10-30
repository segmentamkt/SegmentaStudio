"""Small, dependency-free MCP connection tester for Kiko Studio.

The hub stores no credentials and never invokes a shell. Local servers are
started from an explicit executable plus parsed arguments; remote servers use
plain Streamable HTTP without custom authorization headers.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shlex
import shutil
import subprocess
import threading
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


PROTOCOL_VERSION = "2025-06-18"
AGENTS = {"codex", "claude", "gemini"}


class MCPConnectionError(RuntimeError):
    pass


def normalize_agents(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("Selecciona las IA que usarán el complemento")
    agents = [str(item).strip().lower() for item in value]
    agents = list(dict.fromkeys(item for item in agents if item in AGENTS))
    if not agents:
        raise ValueError("Selecciona al menos una IA")
    return agents


def validate_connection(body: dict[str, Any]) -> dict[str, Any]:
    name = str(body.get("name", "")).strip()[:80]
    transport = str(body.get("transport", "stdio")).strip().lower()
    if not name:
        raise ValueError("El nombre del complemento es obligatorio")
    if transport not in {"stdio", "http"}:
        raise ValueError("El tipo de conexión debe ser local o HTTP")
    command = str(body.get("command", "")).strip()
    arguments = str(body.get("arguments", "")).strip()
    url = str(body.get("url", "")).strip()
    if transport == "stdio":
        if not command:
            raise ValueError("Indica el ejecutable del servidor MCP local")
        if len(command) > 500 or len(arguments) > 4000:
            raise ValueError("El comando o sus argumentos son demasiado largos")
        url = ""
    else:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username:
            raise ValueError("Indica una URL HTTP o HTTPS válida, sin credenciales incrustadas")
        if len(url) > 2000:
            raise ValueError("La URL es demasiado larga")
        command = arguments = ""
    return {
        "name": name,
        "transport": transport,
        "command": command,
        "arguments": arguments,
        "url": url,
        "agents": normalize_agents(body.get("agents", ["codex", "claude", "gemini"])),
    }


def _tool_list(value: Any) -> list[dict[str, Any]]:
    raw = value.get("tools", []) if isinstance(value, dict) else []
    tools = []
    for item in raw[:100] if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not str(item.get("name", "")).strip():
            continue
        tools.append({
            "name": str(item["name"])[:160],
            "description": str(item.get("description", ""))[:1000],
            "inputSchema": item.get("inputSchema") if isinstance(item.get("inputSchema"), dict) else {},
        })
    return tools


def _reader(stream: Any, output: queue.Queue[str]) -> None:
    try:
        for line in iter(stream.readline, ""):
            output.put(line)
    finally:
        output.put("")


def _wait_response(lines: queue.Queue[str], request_id: int, timeout: float) -> dict[str, Any]:
    while True:
        try:
            line = lines.get(timeout=timeout)
        except queue.Empty as exc:
            raise MCPConnectionError("El servidor MCP no respondió a tiempo") from exc
        if not line:
            raise MCPConnectionError("El servidor MCP cerró la conexión")
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("id") != request_id:
            continue
        if payload.get("error"):
            raise MCPConnectionError(str(payload["error"])[:1000])
        result = payload.get("result", {})
        return result if isinstance(result, dict) else {}


def probe_stdio(command: str, arguments: str, *, timeout: float = 8.0) -> list[dict[str, Any]]:
    executable = command if os.path.isabs(command) else shutil.which(command)
    if not executable or not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise MCPConnectionError("No se encontró un ejecutable válido para este MCP")
    try:
        argv = [executable, *shlex.split(arguments)]
    except ValueError as exc:
        raise MCPConnectionError(f"Argumentos inválidos: {exc}") from exc
    if len(argv) > 80:
        raise MCPConnectionError("El servidor tiene demasiados argumentos")
    process = subprocess.Popen(
        argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1, shell=False,
        env={"PATH": os.environ.get("PATH", ""), "LANG": os.environ.get("LANG", "C.UTF-8")},
    )
    if process.stdin is None or process.stdout is None:
        process.kill()
        raise MCPConnectionError("No se pudo abrir el canal local del MCP")
    lines: queue.Queue[str] = queue.Queue()
    threading.Thread(target=_reader, args=(process.stdout, lines), daemon=True).start()

    def send(payload: dict[str, Any]) -> None:
        process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        process.stdin.flush()

    try:
        send({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {}, "clientInfo": {"name": "kiko-studio", "version": "0.1.0"},
            },
        })
        _wait_response(lines, 1, timeout)
        send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        return _tool_list(_wait_response(lines, 2, timeout))
    except (BrokenPipeError, OSError) as exc:
        raise MCPConnectionError(f"Falló la comunicación con el MCP: {exc}") from exc
    finally:
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def _json_from_http(data: str) -> dict[str, Any]:
    stripped = data.strip()
    if stripped.startswith("{"):
        value = json.loads(stripped)
        return value if isinstance(value, dict) else {}
    for line in stripped.splitlines():
        if line.startswith("data:"):
            value = json.loads(line[5:].strip())
            if isinstance(value, dict):
                return value
    raise MCPConnectionError("El servidor HTTP no devolvió JSON-RPC ni eventos SSE válidos")


def _http_request(
    url: str, payload: dict[str, Any], timeout: float, *,
    session_id: str | None = None, allow_empty: bool = False,
) -> tuple[dict[str, Any], str | None]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    request = Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers=headers,
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(2_000_000).decode("utf-8", "replace")
            result = {} if allow_empty and not raw.strip() else _json_from_http(raw)
            return result, response.headers.get("Mcp-Session-Id") or session_id
    except Exception as exc:
        raise MCPConnectionError(f"No se pudo conectar con el MCP HTTP: {exc}") from exc


def probe_http(url: str, *, timeout: float = 8.0) -> list[dict[str, Any]]:
    initialized, session_id = _http_request(url, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "kiko-studio", "version": "0.1.0"},
        },
    }, timeout)
    if initialized.get("error"):
        raise MCPConnectionError(str(initialized["error"])[:1000])
    _http_request(
        url, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        timeout, session_id=session_id, allow_empty=True,
    )
    listed, _ = _http_request(
        url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        timeout, session_id=session_id,
    )
    if listed.get("error"):
        raise MCPConnectionError(str(listed["error"])[:1000])
    return _tool_list(listed.get("result", {}))


def probe_connection(connection: dict[str, Any], *, timeout: float = 8.0) -> list[dict[str, Any]]:
    if connection.get("transport") == "stdio":
        return probe_stdio(str(connection.get("command", "")), str(connection.get("arguments", "")), timeout=timeout)
    return probe_http(str(connection.get("url", "")), timeout=timeout)
