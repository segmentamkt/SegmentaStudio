"""Herramientas deterministas de tendencias, ideas y aprendizaje de estilo.

El módulo no recopila datos por medios no autorizados: normaliza referencias
aportadas por el usuario o conectores oficiales y conserva su procedencia.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class Trend:
    title: str
    url: str
    creator: str
    platform: str
    published_at: str | None = None
    public_metrics: dict[str, int | float] | None = None
    topic: str = ""
    narrative_patterns: tuple[str, ...] = ()
    audiovisual_notes: str = ""
    adaptation_opportunity: str = ""
    source: str = "user"

    def validate(self) -> None:
        if not self.title.strip() or not self.url.startswith(("https://", "http://")):
            raise ValueError("La tendencia necesita título y URL verificable")
        if self.source not in {"user", "official_api", "authorized_connector"}:
            raise ValueError("La fuente debe ser aportada o autorizada")
        for name, value in (self.public_metrics or {}).items():
            if not isinstance(value, (int, float)) or value < 0:
                raise ValueError(f"Métrica pública inválida: {name}")


class CreativeStore:
    """Persistencia aislada por proyecto para referencias y correcciones."""

    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        return con

    def _init(self) -> None:
        with self.connect() as con:
            con.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS trends (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                    payload TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS style_observations (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                    key TEXT NOT NULL, value TEXT NOT NULL,
                    confidence REAL NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
                    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_trends_project ON trends(project_id);
                CREATE INDEX IF NOT EXISTS idx_style_project ON style_observations(project_id);
                """
            )

    def add_trend(self, project_id: str, trend: Trend) -> str:
        trend.validate()
        ident = str(uuid.uuid4())
        payload = asdict(trend)
        payload["narrative_patterns"] = list(trend.narrative_patterns)
        with self.connect() as con:
            con.execute(
                "INSERT INTO trends VALUES (?,?,?,?)",
                (ident, project_id, json.dumps(payload, ensure_ascii=False), utc_now()),
            )
        return ident

    def list_trends(self, project_id: str) -> list[dict[str, Any]]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT id,payload,created_at FROM trends WHERE project_id=? ORDER BY created_at DESC",
                (project_id,),
            ).fetchall()
        return [{"id": r["id"], "created_at": r["created_at"], **json.loads(r["payload"])} for r in rows]

    def record_style(
        self, project_id: str, key: str, value: Any, *, confidence: float = 0.5, confirmed: bool = False
    ) -> str:
        if not 0 <= confidence <= 1:
            raise ValueError("confidence debe estar entre 0 y 1")
        ident = str(uuid.uuid4())
        with self.connect() as con:
            con.execute(
                "INSERT INTO style_observations VALUES (?,?,?,?,?,?,?,?)",
                (ident, project_id, key, json.dumps(value, ensure_ascii=False), confidence, int(confirmed), 1, utc_now()),
            )
        return ident

    def confirm_style(self, observation_id: str) -> None:
        with self.connect() as con:
            cur = con.execute(
                "UPDATE style_observations SET confirmed=1, confidence=1 WHERE id=? AND active=1",
                (observation_id,),
            )
            if not cur.rowcount:
                raise KeyError(observation_id)

    def revert_style(self, observation_id: str) -> None:
        with self.connect() as con:
            cur = con.execute("UPDATE style_observations SET active=0 WHERE id=?", (observation_id,))
            if not cur.rowcount:
                raise KeyError(observation_id)

    def confirmed_style(self, project_id: str) -> dict[str, Any]:
        with self.connect() as con:
            rows = con.execute(
                """SELECT key,value FROM style_observations
                   WHERE project_id=? AND confirmed=1 AND active=1
                   ORDER BY created_at""",
                (project_id,),
            ).fetchall()
        return {r["key"]: json.loads(r["value"]) for r in rows}


def idea_from_trend(trend: Trend, *, audience: str = "emprendedores") -> dict[str, Any]:
    """Crea un briefing local. Un modelo semántico puede enriquecerlo después."""
    trend.validate()
    topic = trend.topic or trend.title
    return {
        "title": f"Lo que {topic} cambia para tu negocio",
        "hook": f"Si estás construyendo una marca, esto sobre {topic} te interesa.",
        "audience": audience,
        "structure": [
            "Presentar el cambio con una afirmación verificable",
            "Explicar por qué importa con un ejemplo propio",
            "Dar tres acciones concretas",
            "Cerrar con una pregunta que invite a conversar",
        ],
        "recording": ["Plano medio vertical", "Audio limpio", "Texto grande para las tres acciones"],
        "cta": "¿Cuál de estas acciones vas a probar primero?",
        "source_url": trend.url,
        "requires_editorial_review": True,
    }

