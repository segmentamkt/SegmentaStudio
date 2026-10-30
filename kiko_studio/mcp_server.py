"""Read-only MCP servers bundled with Kiko Studio IA."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any


PROTOCOL_VERSION = "2025-06-18"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "data" / "kiko_studio.sqlite3"


MEDIA_TOOLS = [
    {
        "name": "kiko_list_projects",
        "description": "Lista los proyectos locales de Kiko Studio sin modificar nada.",
        "inputSchema": {
            "type": "object",
            "properties": {"include_archived": {"type": "boolean", "default": False}},
            "additionalProperties": False,
        },
    },
    {
        "name": "kiko_list_videos",
        "description": "Lista videos importados y su estado; puede limitarse a un proyecto.",
        "inputSchema": {
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "kiko_list_completed_edits",
        "description": "Lista los montajes creados, su estilo y el resultado disponible.",
        "inputSchema": {
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "kiko_storage_summary",
        "description": "Resume proyectos, videos, montajes y recursos guardados localmente.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


CREATIVE_TOOLS = [
    {
        "name": "kiko_list_editorial_styles",
        "description": "Lista todos los estilos editoriales disponibles y cuándo usar cada uno.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "kiko_recommend_style",
        "description": "Recomienda un estilo de edición a partir del tema y la intención del video.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "goal": {"type": "string"},
            },
            "required": ["topic"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kiko_build_edit_brief",
        "description": "Crea un brief editorial breve para dirigir el montaje local.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "audience": {"type": "string"},
                "duration_seconds": {"type": "integer", "minimum": 10, "maximum": 600},
            },
            "required": ["topic"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kiko_list_style_references",
        "description": "Lista los referentes y enlaces guardados para cada estilo editorial.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


def _styles() -> list[dict[str, Any]]:
    from kiko_studio.app import EDITORIAL_STYLES

    return EDITORIAL_STYLES


def _connect(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    return connection


def _rows(connection: sqlite3.Connection, query: str, values: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(query, values).fetchall()]


def call_media(database: Path, name: str, arguments: dict[str, Any]) -> Any:
    with _connect(database) as connection:
        if name == "kiko_list_projects":
            where = "" if arguments.get("include_archived") else " WHERE archived_at IS NULL"
            return _rows(connection, f"SELECT id,name,objective,created_at,archived_at FROM projects{where} ORDER BY created_at DESC")
        if name == "kiko_list_videos":
            project_id = str(arguments.get("project_id", "")).strip()
            where, values = (" WHERE project_id=?", (project_id,)) if project_id else ("", ())
            return _rows(connection, f"SELECT id,project_id,original_name,status,created_at FROM videos{where} ORDER BY created_at DESC", values)
        if name == "kiko_list_completed_edits":
            project_id = str(arguments.get("project_id", "")).strip()
            where, values = (" WHERE project_id=?", (project_id,)) if project_id else ("", ())
            rows = _rows(connection, f"SELECT id,project_id,name,status,details,created_at FROM professional_edits{where} ORDER BY created_at DESC", values)
            for row in rows:
                details = json.loads(row.pop("details") or "{}")
                row["style_pack"] = (details.get("settings") or {}).get("style_pack")
                row["output_ready"] = row.get("status") == "ready"
            return rows
        if name == "kiko_storage_summary":
            tables = {"projects": "projects", "videos": "videos", "montajes": "professional_edits", "recursos": "media_assets"}
            return {label: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for label, table in tables.items()}
    raise ValueError(f"Herramienta desconocida: {name}")


def _recommend_style(text: str) -> str:
    value = text.lower()
    rules = [
        ("storytelling-marca-pop", ("marca", "producto", "campaña", "nostalgia")),
        ("demo-visual-dividida", ("prompt", "tutorial", "pantalla", "aplicación")),
        ("reflexion-intima", ("fe", "amor", "familia", "relación", "humano")),
        ("ia-demostrativa", ("inteligencia artificial", "automatiza", "herramienta ia")),
        ("historia-cinematica", ("historia", "caso", "aprendizaje", "fracaso")),
        ("aula-premium", ("método", "paso", "enseñar", "framework")),
        ("autoridad-minimal", ("tesis", "opinión", "marca personal", "autoridad")),
    ]
    for style_id, words in rules:
        if any(word in value for word in words):
            return style_id
    return "kiko-impacto"


def call_creative(name: str, arguments: dict[str, Any]) -> Any:
    styles = _styles()
    if name == "kiko_list_editorial_styles":
        return [{key: style[key] for key in ("id", "name", "best_for", "description", "signature")} for style in styles]
    if name == "kiko_list_style_references":
        return [{"style": style["name"], "inspired_by": style["inspired_by"], "references": style["references"]} for style in styles]
    if name == "kiko_recommend_style":
        topic = str(arguments.get("topic", "")).strip()
        if not topic:
            raise ValueError("Indica el tema del video")
        style_id = _recommend_style(f"{topic} {arguments.get('goal', '')}")
        style = next(item for item in styles if item["id"] == style_id)
        return {"style_id": style_id, "style": style["name"], "why": style["best_for"], "direction": style["direction"]}
    if name == "kiko_build_edit_brief":
        topic = str(arguments.get("topic", "")).strip()
        if not topic:
            raise ValueError("Indica el tema del video")
        audience = str(arguments.get("audience", "audiencia de redes")).strip() or "audiencia de redes"
        duration = max(10, min(600, int(arguments.get("duration_seconds", 60))))
        recommendation = call_creative("kiko_recommend_style", {"topic": topic})
        return {
            "topic": topic,
            "audience": audience,
            "duration_seconds": duration,
            "recommended_style": recommendation,
            "structure": ["Hook visual inmediato", "Una idea central", "Prueba o demostración", "Cierre memorable"],
            "delivery": "Frases breves, voz natural y recursos visuales alineados con cada idea.",
        }
    raise ValueError(f"Herramienta desconocida: {name}")


def response(message_id: Any, result: Any = None, error: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"jsonrpc": "2.0", "id": message_id}
    if error:
        payload["error"] = {"code": -32000, "message": error[:1000]}
    else:
        payload["result"] = result
    return payload


def serve(profile: str, database: Path) -> None:
    tools = MEDIA_TOOLS if profile == "media" else CREATIVE_TOOLS
    for raw in sys.stdin:
        try:
            message = json.loads(raw)
            method = message.get("method")
            if "id" not in message:
                continue
            if method == "initialize":
                result = {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": f"kiko-{profile}", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {"tools": tools}
            elif method == "tools/call":
                params = message.get("params") if isinstance(message.get("params"), dict) else {}
                name = str(params.get("name", ""))
                arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
                value = call_media(database, name, arguments) if profile == "media" else call_creative(name, arguments)
                result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "isError": False}
            elif method == "ping":
                result = {}
            else:
                print(json.dumps(response(message.get("id"), error=f"Método no disponible: {method}")), flush=True)
                continue
            print(json.dumps(response(message.get("id"), result=result), ensure_ascii=False), flush=True)
        except Exception as exc:
            message_id = message.get("id") if isinstance(locals().get("message"), dict) else None
            print(json.dumps(response(message_id, error=str(exc)), ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("media", "creative"), default="media")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    args = parser.parse_args()
    serve(args.profile, args.database.expanduser().resolve())


if __name__ == "__main__":
    main()
