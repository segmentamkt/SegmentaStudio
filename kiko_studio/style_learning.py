"""Aprendizaje local de estilo con confirmación humana y correcciones reversibles."""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Optional, Union


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s no puede estar vacío" % name)
    return value.strip()


def _json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise ValueError("El valor debe poder guardarse como JSON") from exc


class StyleLearningStore:
    """Separa observaciones tentativas de preferencias confirmadas.

    Las correcciones guardan el estado anterior. Solo se puede revertir una
    corrección si sigue siendo la versión activa, evitando borrar cambios más
    recientes accidentalmente.
    """

    def __init__(self, database: Union[str, Path]):
        self.path = Path(database)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS style_learning_observations (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    preference_key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    evidence_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    decided_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_style_learning_observations
                    ON style_learning_observations(project_id, status, created_at);
                CREATE TABLE IF NOT EXISTS style_learning_preferences (
                    project_id TEXT NOT NULL,
                    preference_key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(project_id, preference_key)
                );
                CREATE TABLE IF NOT EXISTS style_learning_corrections (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    preference_key TEXT NOT NULL,
                    previous_state_json TEXT,
                    new_value_json TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reverted_at TEXT
                );
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def record_observation(
        self,
        project_id: str,
        preference_key: str,
        value: Any,
        *,
        evidence: Mapping[str, Any],
        confidence: float = 0.5,
    ) -> str:
        project = _text(project_id, "project_id")
        key = _text(preference_key, "preference_key")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            raise ValueError("confidence debe ser numérica")
        if not 0 <= float(confidence) <= 1:
            raise ValueError("confidence debe estar entre 0 y 1")
        if not isinstance(evidence, Mapping) or not evidence:
            raise ValueError("Toda observación necesita evidencia")
        identifier = str(uuid.uuid4())
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO style_learning_observations VALUES (?,?,?,?,?,?,?,?,NULL)",
                (
                    identifier,
                    project,
                    key,
                    _json(value),
                    float(confidence),
                    _json(dict(evidence)),
                    "pending",
                    _now(),
                ),
            )
        return identifier

    def record_comparison(
        self,
        project_id: str,
        original_asset: str,
        edited_asset: str,
        findings: Mapping[str, Any],
        *,
        confidence: float = 0.5,
    ) -> list[str]:
        original = _text(original_asset, "original_asset")
        edited = _text(edited_asset, "edited_asset")
        if original == edited:
            raise ValueError("El original y la versión editada deben ser distintos")
        if not isinstance(findings, Mapping) or not findings:
            raise ValueError("La comparación necesita hallazgos")
        return [
            self.record_observation(
                project_id,
                key,
                value,
                evidence={"original_asset": original, "edited_asset": edited},
                confidence=confidence,
            )
            for key, value in findings.items()
        ]

    def decide_observation(self, observation_id: str, *, confirm: bool) -> None:
        identifier = _text(observation_id, "observation_id")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM style_learning_observations WHERE id=?", (identifier,)
            ).fetchone()
            if row is None:
                raise KeyError(identifier)
            if row["status"] != "pending":
                raise ValueError("La observación ya fue decidida")
            status = "confirmed" if confirm else "rejected"
            connection.execute(
                "UPDATE style_learning_observations SET status=?, decided_at=? WHERE id=?",
                (status, _now(), identifier),
            )
            if confirm:
                connection.execute(
                    """INSERT INTO style_learning_preferences VALUES (?,?,?,?,?,?)
                       ON CONFLICT(project_id, preference_key) DO UPDATE SET
                         value_json=excluded.value_json,
                         source_type=excluded.source_type,
                         source_id=excluded.source_id,
                         updated_at=excluded.updated_at""",
                    (
                        row["project_id"],
                        row["preference_key"],
                        row["value_json"],
                        "observation",
                        identifier,
                        _now(),
                    ),
                )

    def apply_correction(
        self,
        project_id: str,
        preference_key: str,
        value: Any,
        *,
        rationale: str,
    ) -> str:
        project = _text(project_id, "project_id")
        key = _text(preference_key, "preference_key")
        reason = _text(rationale, "rationale")
        identifier = str(uuid.uuid4())
        value_json = _json(value)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute(
                """SELECT value_json, source_type, source_id FROM style_learning_preferences
                   WHERE project_id=? AND preference_key=?""",
                (project, key),
            ).fetchone()
            previous_state = dict(previous) if previous is not None else None
            connection.execute(
                "INSERT INTO style_learning_corrections VALUES (?,?,?,?,?,?,?,NULL)",
                (
                    identifier,
                    project,
                    key,
                    None if previous_state is None else _json(previous_state),
                    value_json,
                    reason,
                    _now(),
                ),
            )
            connection.execute(
                """INSERT INTO style_learning_preferences VALUES (?,?,?,?,?,?)
                   ON CONFLICT(project_id, preference_key) DO UPDATE SET
                     value_json=excluded.value_json,
                     source_type=excluded.source_type,
                     source_id=excluded.source_id,
                     updated_at=excluded.updated_at""",
                (project, key, value_json, "correction", identifier, _now()),
            )
        return identifier

    def revert_correction(self, correction_id: str) -> None:
        identifier = _text(correction_id, "correction_id")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            correction = connection.execute(
                "SELECT * FROM style_learning_corrections WHERE id=?", (identifier,)
            ).fetchone()
            if correction is None:
                raise KeyError(identifier)
            if correction["reverted_at"] is not None:
                raise ValueError("La corrección ya fue revertida")
            current = connection.execute(
                """SELECT source_type, source_id FROM style_learning_preferences
                   WHERE project_id=? AND preference_key=?""",
                (correction["project_id"], correction["preference_key"]),
            ).fetchone()
            if current is None or current["source_type"] != "correction" or current["source_id"] != identifier:
                raise RuntimeError(
                    "No se puede revertir: existe un cambio posterior para esta preferencia"
                )
            previous = (
                json.loads(correction["previous_state_json"])
                if correction["previous_state_json"] is not None
                else None
            )
            if previous is None:
                connection.execute(
                    "DELETE FROM style_learning_preferences WHERE project_id=? AND preference_key=?",
                    (correction["project_id"], correction["preference_key"]),
                )
            else:
                connection.execute(
                    """UPDATE style_learning_preferences SET
                         value_json=?, source_type=?, source_id=?, updated_at=?
                       WHERE project_id=? AND preference_key=?""",
                    (
                        previous["value_json"],
                        previous["source_type"],
                        previous["source_id"],
                        _now(),
                        correction["project_id"],
                        correction["preference_key"],
                    ),
                )
            connection.execute(
                "UPDATE style_learning_corrections SET reverted_at=? WHERE id=?",
                (_now(), identifier),
            )

    def preferences(self, project_id: str) -> dict[str, Any]:
        project = _text(project_id, "project_id")
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT preference_key, value_json FROM style_learning_preferences
                   WHERE project_id=? ORDER BY preference_key""",
                (project,),
            ).fetchall()
        return {row["preference_key"]: json.loads(row["value_json"]) for row in rows}

    def correction_history(self, project_id: str) -> list[dict[str, Any]]:
        """Devuelve el historial auditable, incluidas las reversiones."""
        project = _text(project_id, "project_id")
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT id, preference_key, new_value_json, rationale,
                          created_at, reverted_at
                   FROM style_learning_corrections
                   WHERE project_id=? ORDER BY created_at, id""",
                (project,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "key": row["preference_key"],
                "value": json.loads(row["new_value_json"]),
                "rationale": row["rationale"],
                "created_at": row["created_at"],
                "reverted_at": row["reverted_at"],
            }
            for row in rows
        ]

    def correction_patterns(
        self, project_id: str, *, min_occurrences: int = 2
    ) -> list[dict[str, Any]]:
        """Detecta repeticiones sin convertirlas automáticamente en reglas.

        Solo considera correcciones no revertidas. El resultado es informativo:
        una repetición nunca confirma por sí sola una preferencia nueva.
        """
        if isinstance(min_occurrences, bool) or not isinstance(min_occurrences, int):
            raise ValueError("min_occurrences debe ser un entero")
        if min_occurrences < 2:
            raise ValueError("min_occurrences debe ser al menos 2")
        history = [item for item in self.correction_history(project_id) if item["reverted_at"] is None]
        counts = Counter(
            (item["key"], json.dumps(item["value"], ensure_ascii=False, sort_keys=True))
            for item in history
        )
        patterns = [
            {
                "key": key,
                "value": json.loads(value_json),
                "occurrences": occurrences,
                "requires_confirmation": True,
            }
            for (key, value_json), occurrences in counts.items()
            if occurrences >= min_occurrences
        ]
        return sorted(patterns, key=lambda item: (-item["occurrences"], item["key"]))

    def observations(self, project_id: str, status: Optional[str] = None) -> list[dict[str, Any]]:
        project = _text(project_id, "project_id")
        query = "SELECT * FROM style_learning_observations WHERE project_id=?"
        arguments: tuple[Any, ...] = (project,)
        if status is not None:
            if status not in {"pending", "confirmed", "rejected"}:
                raise ValueError("status inválido")
            query += " AND status=?"
            arguments += (status,)
        query += " ORDER BY created_at, id"
        with self._connect() as connection:
            rows = connection.execute(query, arguments).fetchall()
        return [
            {
                "id": row["id"],
                "key": row["preference_key"],
                "value": json.loads(row["value_json"]),
                "confidence": row["confidence"],
                "evidence": json.loads(row["evidence_json"]),
                "status": row["status"],
                "created_at": row["created_at"],
                "decided_at": row["decided_at"],
            }
            for row in rows
        ]

