"""Radar local de tendencias con procedencia y métricas verificables.

Este módulo no recopila información de Internet. Solo registra referencias
aportadas manualmente o importadas desde una fuente autorizada. Una métrica se
acepta únicamente si incluye cuándo se observó y una URL de evidencia.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Union
from urllib.parse import urlsplit


ALLOWED_SOURCES = {"manual", "official_export", "authorized_connector"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s no puede estar vacío" % field_name)
    return value.strip()


def _web_url(value: Any, field_name: str) -> str:
    text = _required_text(value, field_name)
    parsed = urlsplit(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("%s debe ser una URL http(s) verificable" % field_name)
    return text


def _iso_timestamp(value: Any, field_name: str) -> str:
    text = _required_text(value, field_name)
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("%s debe usar formato ISO 8601" % field_name) from exc
    return text


@dataclass(frozen=True)
class MetricEvidence:
    """Valor público acompañado de la evidencia con la que fue observado."""

    value: Union[int, float]
    observed_at: str
    source_url: str

    def validated(self) -> "MetricEvidence":
        if isinstance(self.value, bool) or not isinstance(self.value, (int, float)):
            raise ValueError("La métrica debe ser numérica")
        if self.value < 0:
            raise ValueError("La métrica no puede ser negativa")
        _iso_timestamp(self.observed_at, "observed_at")
        _web_url(self.source_url, "source_url de la métrica")
        return self

    @classmethod
    def from_value(cls, value: Any) -> "MetricEvidence":
        if isinstance(value, cls):
            return value.validated()
        if not isinstance(value, Mapping):
            raise ValueError(
                "Cada métrica requiere value, observed_at y source_url; "
                "no se aceptan cifras sin evidencia"
            )
        return cls(
            value=value.get("value"),
            observed_at=value.get("observed_at", ""),
            source_url=value.get("source_url", ""),
        ).validated()


@dataclass(frozen=True)
class TrendRecord:
    title: str
    url: str
    creator: str
    platform: str
    topic: str
    source_kind: str
    source_reference: str
    published_at: Optional[str] = None
    public_metrics: Mapping[str, MetricEvidence] = field(default_factory=dict)
    narrative_patterns: tuple[str, ...] = ()
    audiovisual_notes: str = ""
    adaptation_opportunity: str = ""

    def validated(self) -> "TrendRecord":
        _required_text(self.title, "title")
        _web_url(self.url, "url")
        _required_text(self.creator, "creator")
        _required_text(self.platform, "platform")
        _required_text(self.topic, "topic")
        if self.source_kind not in ALLOWED_SOURCES:
            raise ValueError("source_kind debe identificar una fuente autorizada")
        _required_text(self.source_reference, "source_reference")
        if self.published_at is not None:
            _iso_timestamp(self.published_at, "published_at")
        for name, metric in self.public_metrics.items():
            _required_text(name, "nombre de métrica")
            MetricEvidence.from_value(metric)
        return self

    def as_payload(self) -> dict[str, Any]:
        self.validated()
        payload = asdict(self)
        payload["public_metrics"] = {
            name: asdict(MetricEvidence.from_value(metric))
            for name, metric in self.public_metrics.items()
        }
        payload["narrative_patterns"] = list(self.narrative_patterns)
        return payload

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
        *,
        source_kind: Optional[str] = None,
        source_reference: Optional[str] = None,
    ) -> "TrendRecord":
        metrics = {
            str(name): MetricEvidence.from_value(metric)
            for name, metric in (value.get("public_metrics") or {}).items()
        }
        patterns = value.get("narrative_patterns") or ()
        if isinstance(patterns, str):
            patterns = (patterns,)
        record = cls(
            title=value.get("title", ""),
            url=value.get("url", ""),
            creator=value.get("creator", ""),
            platform=value.get("platform", ""),
            topic=value.get("topic", ""),
            source_kind=source_kind or value.get("source_kind", ""),
            source_reference=source_reference or value.get("source_reference", ""),
            published_at=value.get("published_at"),
            public_metrics=metrics,
            narrative_patterns=tuple(str(item) for item in patterns),
            audiovisual_notes=str(value.get("audiovisual_notes", "")),
            adaptation_opportunity=str(value.get("adaptation_opportunity", "")),
        )
        return record.validated()


class TrendRadar:
    """Registro SQLite aislado por proyecto y con importación transaccional."""

    def __init__(self, database: Union[str, Path]):
        self.path = Path(database)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS trend_radar_records (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(project_id, fingerprint)
                );
                CREATE INDEX IF NOT EXISTS idx_trend_radar_project
                    ON trend_radar_records(project_id, created_at);
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _fingerprint(record: TrendRecord) -> str:
        stable = json.dumps(record.as_payload(), ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(stable.encode("utf-8")).hexdigest()

    def register(self, project_id: str, record: TrendRecord) -> str:
        project = _required_text(project_id, "project_id")
        payload = record.as_payload()
        identifier = str(uuid.uuid4())
        try:
            with self._connect() as connection:
                connection.execute(
                    "INSERT INTO trend_radar_records VALUES (?,?,?,?,?)",
                    (
                        identifier,
                        project,
                        self._fingerprint(record),
                        json.dumps(payload, ensure_ascii=False, sort_keys=True),
                        _now(),
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("La referencia ya está registrada en este proyecto") from exc
        return identifier

    def register_manual(self, project_id: str, **fields: Any) -> str:
        fields = dict(fields)
        fields["source_kind"] = "manual"
        fields.setdefault("source_reference", fields.get("url", ""))
        return self.register(project_id, TrendRecord.from_mapping(fields))

    def import_records(
        self,
        project_id: str,
        records: Iterable[Mapping[str, Any]],
        *,
        source_kind: str,
        source_reference: str,
    ) -> list[str]:
        """Importa un lote completo o no importa nada si un registro es inválido."""
        project = _required_text(project_id, "project_id")
        if source_kind not in {"official_export", "authorized_connector"}:
            raise ValueError("Una importación debe provenir de export oficial o conector autorizado")
        reference = _required_text(source_reference, "source_reference")
        prepared = [
            TrendRecord.from_mapping(
                item, source_kind=source_kind, source_reference=reference
            )
            for item in records
        ]
        identifiers = [str(uuid.uuid4()) for _ in prepared]
        try:
            with self._connect() as connection:
                connection.executemany(
                    "INSERT INTO trend_radar_records VALUES (?,?,?,?,?)",
                    [
                        (
                            identifier,
                            project,
                            self._fingerprint(record),
                            json.dumps(record.as_payload(), ensure_ascii=False, sort_keys=True),
                            _now(),
                        )
                        for identifier, record in zip(identifiers, prepared)
                    ],
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("El lote contiene una referencia duplicada") from exc
        return identifiers

    def list_records(self, project_id: str) -> list[dict[str, Any]]:
        project = _required_text(project_id, "project_id")
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT id, payload, created_at FROM trend_radar_records
                   WHERE project_id=? ORDER BY created_at, id""",
                (project,),
            ).fetchall()
        return [
            {"id": row["id"], "created_at": row["created_at"], **json.loads(row["payload"])}
            for row in rows
        ]

