"""Persistent, auditable planning for professional media edits.

This module creates plans only; it never mutates source media or claims visual,
audio, or semantic understanding that was not supplied as metadata/evidence.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterable, Mapping
from uuid import uuid4

from .collaboration import MultiAgentCollaborator
from .providers import detect_cli_providers
from .storage import SQLiteStore, _dt, _parse_dt


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _positive(value: float, name: str, *, allow_zero: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if value < 0 or (not allow_zero and value == 0):
        raise ValueError(f"{name} must be {'non-negative' if allow_zero else 'positive'}")
    return float(value)


def _aware(value: datetime | None, name: str) -> datetime | None:
    if value is not None and value.tzinfo is None:
        raise ValueError(f"{name} must include a timezone")
    return value


class EditProjectStatus(str, Enum):
    NEW = "new"
    PLANNING = "planning"
    PLANNED = "planned"
    ARCHIVED = "archived"


class EditPlanStatus(str, Enum):
    DRAFT = "draft"
    PROPOSED = "proposed"
    REVIEWED = "reviewed"
    APPROVED = "approved"
    REJECTED = "rejected"
    RENDERED = "rendered"
    FAILED = "failed"


@dataclass(frozen=True)
class SubtitleSettings:
    enabled: bool = True
    language: str = "und"
    style: str = "default"
    max_characters_per_line: int = 42
    max_lines: int = 2
    position: str = "bottom"
    burn_in: bool = False

    def __post_init__(self) -> None:
        if not self.language.strip() or not self.style.strip():
            raise ValueError("subtitle language and style are required")
        if self.position not in {"top", "center", "bottom"}:
            raise ValueError("subtitle position must be top, center or bottom")
        if (
            isinstance(self.max_characters_per_line, bool)
            or not isinstance(self.max_characters_per_line, int)
            or isinstance(self.max_lines, bool)
            or not isinstance(self.max_lines, int)
            or not 10 <= self.max_characters_per_line <= 120
            or not 1 <= self.max_lines <= 4
        ):
            raise ValueError("subtitle line limits are outside supported bounds")


@dataclass(frozen=True)
class TransitionSettings:
    default_kind: str = "cut"
    default_duration: float = 0.0
    allowed_kinds: tuple[str, ...] = ("cut", "crossfade", "fade", "dip_to_black")

    def __post_init__(self) -> None:
        supported = {"cut", "crossfade", "fade", "dip_to_black", "wipe"}
        if not self.allowed_kinds or len(self.allowed_kinds) != len(set(self.allowed_kinds)):
            raise ValueError("transition allowed_kinds must be unique and non-empty")
        if set(self.allowed_kinds) - supported or self.default_kind not in self.allowed_kinds:
            raise ValueError("transition settings contain an unsupported kind")
        _positive(self.default_duration, "default transition duration", allow_zero=True)
        if self.default_kind == "cut" and self.default_duration != 0:
            raise ValueError("default cut duration must be zero")


@dataclass(frozen=True)
class MusicSettings:
    enabled: bool = False
    asset: str | None = None
    volume: float = 0.25
    duck_under_dialogue: bool = True

    def __post_init__(self) -> None:
        if self.enabled and (self.asset is None or not self.asset.strip()):
            raise ValueError("enabled music requires an explicit asset")
        if self.asset is not None and not self.asset.strip():
            raise ValueError("music asset cannot be blank")
        if isinstance(self.volume, bool) or not isinstance(self.volume, (int, float)) or not 0 <= self.volume <= 2:
            raise ValueError("music volume must be between 0 and 2")


@dataclass(frozen=True)
class SFXSettings:
    enabled: bool = False
    allowed_assets: tuple[str, ...] = ()
    default_volume: float = 1.0

    def __post_init__(self) -> None:
        if len(self.allowed_assets) != len(set(self.allowed_assets)) or any(
            not item.strip() for item in self.allowed_assets
        ):
            raise ValueError("SFX assets must be unique non-empty identifiers")
        if isinstance(self.default_volume, bool) or not isinstance(self.default_volume, (int, float)) or not 0 <= self.default_volume <= 2:
            raise ValueError("SFX volume must be between 0 and 2")


@dataclass(frozen=True)
class PacingFramingSettings:
    pacing: str = "balanced"
    target_shot_seconds: float | None = None
    aspect_ratio: str = "16:9"
    framing: str = "source"
    safe_area_percent: float = 0.05

    def __post_init__(self) -> None:
        if self.pacing not in {"deliberate", "balanced", "dynamic"}:
            raise ValueError("unsupported pacing preset")
        if self.target_shot_seconds is not None:
            _positive(self.target_shot_seconds, "target_shot_seconds")
        parts = self.aspect_ratio.split(":")
        if len(parts) != 2 or not all(part.isdigit() and int(part) > 0 for part in parts):
            raise ValueError("aspect_ratio must use a positive W:H form")
        if self.framing not in {"source", "fit", "center_crop", "manual"}:
            raise ValueError("unsupported framing strategy")
        if not isinstance(self.safe_area_percent, (int, float)) or isinstance(self.safe_area_percent, bool) or not 0 <= self.safe_area_percent <= 0.25:
            raise ValueError("safe_area_percent must be between 0 and 0.25")


@dataclass(frozen=True)
class EditSettings:
    subtitles: SubtitleSettings = field(default_factory=SubtitleSettings)
    transitions: TransitionSettings = field(default_factory=TransitionSettings)
    music: MusicSettings = field(default_factory=MusicSettings)
    sfx: SFXSettings = field(default_factory=SFXSettings)
    pacing_framing: PacingFramingSettings = field(default_factory=PacingFramingSettings)


@dataclass
class EditClip:
    project_id: str
    name: str
    source: str
    duration_seconds: float
    id: str = field(default_factory=lambda: str(uuid4()))
    script_order: int | None = None
    recorded_at: datetime | None = None
    source_in: float = 0.0
    source_out: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.project_id.strip() or not self.name.strip() or not self.source.strip():
            raise ValueError("clip project_id, name and source are required")
        self.duration_seconds = _positive(self.duration_seconds, "duration_seconds")
        self.source_in = _positive(self.source_in, "source_in", allow_zero=True)
        self.source_out = self.duration_seconds if self.source_out is None else _positive(
            self.source_out, "source_out"
        )
        if self.source_in >= self.source_out or self.source_out > self.duration_seconds:
            raise ValueError("clip source range must be within its duration")
        if self.script_order is not None and (
            isinstance(self.script_order, bool) or not isinstance(self.script_order, int)
            or self.script_order < 0
        ):
            raise ValueError("script_order must be a non-negative integer")
        _aware(self.recorded_at, "recorded_at")

    @property
    def selected_duration(self) -> float:
        return self.source_out - self.source_in  # type: ignore[operator]


@dataclass
class EditProject:
    name: str
    clips: list[EditClip]
    id: str = field(default_factory=lambda: str(uuid4()))
    script: str | None = None
    status: EditProjectStatus = EditProjectStatus.NEW
    settings: EditSettings = field(default_factory=EditSettings)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=_now)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("project name is required")
        if not self.clips:
            raise ValueError("project requires at least one clip")
        ids = [clip.id for clip in self.clips]
        if len(ids) != len(set(ids)):
            raise ValueError("clip ids must be unique")
        if any(clip.project_id != self.id for clip in self.clips):
            raise ValueError("every clip must reference its project")
        if not isinstance(self.status, EditProjectStatus):
            raise ValueError("project status must be an EditProjectStatus")
        if not isinstance(self.settings, EditSettings):
            raise ValueError("project settings must be EditSettings")
        _aware(self.created_at, "created_at")


@dataclass(frozen=True)
class TimelinePlacement:
    clip_id: str
    timeline_start: float
    source_in: float
    source_out: float

    def __post_init__(self) -> None:
        if not self.clip_id.strip():
            raise ValueError("placement clip_id is required")
        _positive(self.timeline_start, "timeline_start", allow_zero=True)
        _positive(self.source_in, "source_in", allow_zero=True)
        _positive(self.source_out, "source_out")
        if self.source_out <= self.source_in:
            raise ValueError("placement source_out must exceed source_in")

    @property
    def duration(self) -> float:
        return self.source_out - self.source_in

    @property
    def timeline_end(self) -> float:
        return self.timeline_start + self.duration


@dataclass(frozen=True)
class SubtitleCue:
    start: float
    end: float
    text: str
    language: str = "und"
    style: str = "default"

    def __post_init__(self) -> None:
        _positive(self.start, "subtitle start", allow_zero=True)
        _positive(self.end, "subtitle end")
        if self.end <= self.start or not self.text.strip():
            raise ValueError("subtitle requires text and an increasing time range")
        if not self.language.strip() or not self.style.strip():
            raise ValueError("subtitle language and style are required")


@dataclass(frozen=True)
class Transition:
    from_clip_id: str
    to_clip_id: str
    kind: str = "cut"
    duration: float = 0.0

    def __post_init__(self) -> None:
        if not self.from_clip_id.strip() or not self.to_clip_id.strip():
            raise ValueError("transition clip ids are required")
        if self.from_clip_id == self.to_clip_id or self.kind not in {
            "cut", "crossfade", "fade", "dip_to_black", "wipe",
        }:
            raise ValueError("transition must connect distinct clips and have a kind")
        _positive(self.duration, "transition duration", allow_zero=True)
        if self.kind == "cut" and self.duration != 0:
            raise ValueError("a cut transition must have zero duration")


@dataclass(frozen=True)
class SoundCue:
    start: float
    asset: str
    duration: float
    volume: float = 1.0
    purpose: str = "effect"

    def __post_init__(self) -> None:
        _positive(self.start, "sound start", allow_zero=True)
        _positive(self.duration, "sound duration")
        if not self.asset.strip() or self.purpose not in {"effect", "music", "ambience", "voiceover"}:
            raise ValueError("sound asset and purpose are required")
        if isinstance(self.volume, bool) or not isinstance(self.volume, (int, float)) or not 0 <= self.volume <= 2:
            raise ValueError("sound volume must be between 0 and 2")


@dataclass(frozen=True)
class PlanEvidence:
    category: str
    source: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=_now)

    def __post_init__(self) -> None:
        if not self.category.strip() or not self.source.strip() or not self.message.strip():
            raise ValueError("evidence category, source and message are required")
        _aware(self.created_at, "created_at")


@dataclass
class EditPlan:
    project_id: str
    placements: list[TimelinePlacement]
    id: str = field(default_factory=lambda: str(uuid4()))
    status: EditPlanStatus = EditPlanStatus.DRAFT
    settings: EditSettings = field(default_factory=EditSettings)
    subtitles: list[SubtitleCue] = field(default_factory=list)
    transitions: list[Transition] = field(default_factory=list)
    sounds: list[SoundCue] = field(default_factory=list)
    source: str = "deterministic_metadata_sort"
    collaboration_round_id: str | None = None
    evidence: list[PlanEvidence] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)

    @property
    def duration_seconds(self) -> float:
        return max((item.timeline_end for item in self.placements), default=0.0)

    def __post_init__(self) -> None:
        if not self.project_id.strip():
            raise ValueError("plan project_id is required")
        if not isinstance(self.status, EditPlanStatus):
            raise ValueError("plan status must be an EditPlanStatus")
        if not isinstance(self.settings, EditSettings):
            raise ValueError("plan settings must be EditSettings")
        _aware(self.created_at, "created_at")
        _aware(self.updated_at, "updated_at")

    def validate(self, project: EditProject) -> None:
        if self.project_id != project.id or not self.placements:
            raise ValueError("plan must reference its project and contain placements")
        clips = {clip.id: clip for clip in project.clips}
        placed: set[str] = set()
        previous_end = 0.0
        for item in sorted(self.placements, key=lambda value: value.timeline_start):
            if item.clip_id not in clips or item.clip_id in placed:
                raise ValueError("placements must reference unique project clips")
            clip = clips[item.clip_id]
            if item.source_in < clip.source_in or item.source_out > clip.source_out:
                raise ValueError("placement range exceeds selected clip range")
            if item.timeline_start < previous_end - 1e-9:
                raise ValueError("timeline placements cannot overlap")
            previous_end = item.timeline_end
            placed.add(item.clip_id)
        for cue in [*self.subtitles, *self.sounds]:
            end = cue.end if isinstance(cue, SubtitleCue) else cue.start + cue.duration
            if end > self.duration_seconds + 1e-9:
                raise ValueError("subtitle or sound exceeds plan duration")
        if self.subtitles and not self.settings.subtitles.enabled:
            raise ValueError("subtitle cues require subtitles to be enabled")
        for subtitle in self.subtitles:
            if subtitle.language != self.settings.subtitles.language or subtitle.style != self.settings.subtitles.style:
                raise ValueError("subtitle cue must match the plan subtitle language and style")
            lines = subtitle.text.splitlines() or [subtitle.text]
            if (
                len(lines) > self.settings.subtitles.max_lines
                or any(len(line) > self.settings.subtitles.max_characters_per_line for line in lines)
            ):
                raise ValueError("subtitle cue exceeds configured line limits")
        ordered_ids = [item.clip_id for item in sorted(self.placements, key=lambda value: value.timeline_start)]
        adjacency = set(zip(ordered_ids, ordered_ids[1:]))
        for transition in self.transitions:
            if (transition.from_clip_id, transition.to_clip_id) not in adjacency:
                raise ValueError("transition must connect adjacent placements")
            if transition.kind not in self.settings.transitions.allowed_kinds:
                raise ValueError("transition kind is disabled by plan settings")
        pairs = [(item.from_clip_id, item.to_clip_id) for item in self.transitions]
        if len(pairs) != len(set(pairs)):
            raise ValueError("only one transition is allowed per adjacent clip pair")
        for sound in self.sounds:
            if sound.purpose == "music":
                if not self.settings.music.enabled or sound.asset != self.settings.music.asset:
                    raise ValueError("music cue must match enabled plan music settings")
            elif not self.settings.sfx.enabled or sound.asset not in self.settings.sfx.allowed_assets:
                raise ValueError("sound cue must reference an enabled declared SFX asset")


class EditRepository:
    """SQLite repository for projects, plans, evidence and state changes."""

    _allowed = {
        EditPlanStatus.DRAFT: {EditPlanStatus.PROPOSED, EditPlanStatus.REJECTED, EditPlanStatus.FAILED},
        EditPlanStatus.PROPOSED: {EditPlanStatus.REVIEWED, EditPlanStatus.APPROVED, EditPlanStatus.REJECTED, EditPlanStatus.FAILED},
        EditPlanStatus.REVIEWED: {EditPlanStatus.APPROVED, EditPlanStatus.REJECTED, EditPlanStatus.FAILED},
        EditPlanStatus.APPROVED: {EditPlanStatus.RENDERED, EditPlanStatus.FAILED},
        EditPlanStatus.REJECTED: set(), EditPlanStatus.RENDERED: set(), EditPlanStatus.FAILED: set(),
    }
    _project_allowed = {
        EditProjectStatus.NEW: {EditProjectStatus.PLANNING, EditProjectStatus.ARCHIVED},
        EditProjectStatus.PLANNING: {EditProjectStatus.PLANNED, EditProjectStatus.ARCHIVED},
        EditProjectStatus.PLANNED: {EditProjectStatus.PLANNING, EditProjectStatus.ARCHIVED},
        EditProjectStatus.ARCHIVED: set(),
    }

    def __init__(self, store: SQLiteStore) -> None:
        self.store = store
        with self.store.transaction(immediate=True) as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS edit_projects (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS edit_plans (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
                    source TEXT NOT NULL, collaboration_round_id TEXT,
                    data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES edit_projects(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_edit_plans_project ON edit_plans(project_id,created_at);
                CREATE TABLE IF NOT EXISTS edit_plan_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL,
                    at TEXT NOT NULL, event TEXT NOT NULL, evidence TEXT NOT NULL,
                    FOREIGN KEY(plan_id) REFERENCES edit_plans(id) ON DELETE CASCADE
                );
            """)

    def save_project(self, project: EditProject) -> EditProject:
        data = json.dumps(_project_dict(project), ensure_ascii=False, default=str)
        with self.store.transaction(immediate=True) as conn:
            conn.execute(
                """INSERT INTO edit_projects(id,data,updated_at) VALUES(?,?,?)
                   ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at""",
                (project.id, data, _dt(_now())),
            )
        return project

    def get_project(self, project_id: str) -> EditProject | None:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT data FROM edit_projects WHERE id=?", (project_id,)
            ).fetchone()
        return _project_from_dict(json.loads(row["data"])) if row else None

    def transition_project(
        self, project_id: str, status: EditProjectStatus, *, reason: str, actor: str = "system"
    ) -> EditProject:
        project = self.get_project(project_id)
        if not project:
            raise KeyError(project_id)
        if status not in self._project_allowed[project.status]:
            raise ValueError(f"invalid project transition: {project.status.value} -> {status.value}")
        if not reason.strip() or not actor.strip():
            raise ValueError("transition reason and actor are required")
        history = project.metadata.setdefault("state_history", [])
        history.append({"at": _now().isoformat(), "actor": actor, "reason": reason,
                        "from": project.status.value, "to": status.value})
        project.status = status
        return self.save_project(project)

    def save_plan(self, plan: EditPlan) -> EditPlan:
        project = self.get_project(plan.project_id)
        if not project:
            raise KeyError(f"unknown edit project: {plan.project_id}")
        plan.validate(project)
        data = json.dumps(_plan_dict(plan), ensure_ascii=False, default=str)
        with self.store.transaction(immediate=True) as conn:
            conn.execute(
                """INSERT INTO edit_plans
                   (id,project_id,status,source,collaboration_round_id,data,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                     project_id=excluded.project_id,status=excluded.status,
                     source=excluded.source,collaboration_round_id=excluded.collaboration_round_id,
                     data=excluded.data,updated_at=excluded.updated_at""",
                (plan.id, plan.project_id, plan.status.value, plan.source,
                 plan.collaboration_round_id, data, _dt(plan.created_at), _dt(plan.updated_at)),
            )
            conn.execute(
                "INSERT INTO edit_plan_events(plan_id,at,event,evidence) VALUES(?,?,?,?)",
                (plan.id, _dt(_now()), "saved", json.dumps([_evidence_dict(e) for e in plan.evidence], default=str)),
            )
        return plan

    def get_plan(self, plan_id: str) -> EditPlan | None:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT data FROM edit_plans WHERE id=?", (plan_id,)
            ).fetchone()
        return _plan_from_dict(json.loads(row["data"])) if row else None

    def list_plans(self, project_id: str) -> list[EditPlan]:
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT data FROM edit_plans WHERE project_id=? ORDER BY created_at,id", (project_id,)
            ).fetchall()
        return [_plan_from_dict(json.loads(row["data"])) for row in rows]

    def transition_plan(
        self, plan_id: str, status: EditPlanStatus, *, reason: str, actor: str = "system"
    ) -> EditPlan:
        plan = self.get_plan(plan_id)
        if not plan:
            raise KeyError(plan_id)
        if status not in self._allowed[plan.status]:
            raise ValueError(f"invalid plan transition: {plan.status.value} -> {status.value}")
        if not reason.strip() or not actor.strip():
            raise ValueError("transition reason and actor are required")
        old = plan.status
        plan.status = status
        plan.updated_at = _now()
        plan.evidence.append(PlanEvidence(
            "state_transition", actor, reason,
            {"from": old.value, "to": status.value},
        ))
        return self.save_plan(plan)

    def events(self, plan_id: str) -> list[dict[str, Any]]:
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT at,event,evidence FROM edit_plan_events WHERE plan_id=? ORDER BY id", (plan_id,)
            ).fetchall()
        return [{"at": row["at"], "event": row["event"], "evidence": json.loads(row["evidence"])} for row in rows]


class ProfessionalEditPlanner:
    def __init__(
        self, repository: EditRepository, collaborator: MultiAgentCollaborator | None = None
    ) -> None:
        self.repository = repository
        self.collaborator = collaborator

    @classmethod
    def with_detected_clis(
        cls, repository: EditRepository, *, timeout_seconds: float = 120.0,
        executables: Mapping[str, str] | None = None,
    ) -> "ProfessionalEditPlanner":
        providers = detect_cli_providers(
            executables=executables, timeout_seconds=timeout_seconds
        )
        collaborator = MultiAgentCollaborator(providers, repository.store) if providers else None
        return cls(repository, collaborator)

    def plan(
        self, project: EditProject, *, collaborate: bool = True, min_contributors: int = 2
    ) -> EditPlan:
        self.repository.save_project(project)
        fallback = self._deterministic_plan(project)
        if not collaborate or self.collaborator is None:
            return self.repository.save_plan(fallback)
        round_ = self.collaborator.run(
            self._collaboration_prompt(project), min_contributors=min_contributors,
            metadata={"edit_project_id": project.id, "purpose": "edit_plan"},
        )
        evidence = PlanEvidence(
            "collaboration", "multiagent",
            "Provider round completed; only persisted successful outputs were considered.",
            {"round_id": round_.id, "status": round_.status,
             "successful_contributors": sum(item.succeeded for item in round_.contributions)},
        )
        if round_.status == "completed" and round_.content:
            try:
                proposed = self._parse_collaborative_plan(project, round_.content)
                proposed.collaboration_round_id = round_.id
                proposed.evidence.append(evidence)
                return self.repository.save_plan(proposed)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                fallback.evidence.append(PlanEvidence(
                    "validation", "strict_plan_parser",
                    "Collaborative output was rejected; deterministic fallback retained.",
                    {"round_id": round_.id, "error": f"{type(exc).__name__}: {exc}"},
                ))
        else:
            fallback.evidence.append(evidence)
        fallback.collaboration_round_id = round_.id
        return self.repository.save_plan(fallback)

    @staticmethod
    def _deterministic_plan(project: EditProject) -> EditPlan:
        far_future = datetime.max.replace(tzinfo=timezone.utc)
        ordered = sorted(project.clips, key=lambda clip: (
            clip.script_order is None,
            clip.script_order if clip.script_order is not None else 0,
            clip.recorded_at is None,
            clip.recorded_at or far_future,
            clip.name.casefold(), clip.id,
        ))
        cursor = 0.0
        placements: list[TimelinePlacement] = []
        for clip in ordered:
            placements.append(TimelinePlacement(clip.id, cursor, clip.source_in, clip.source_out))
            cursor += clip.selected_duration
        return EditPlan(
            project_id=project.id, placements=placements, settings=project.settings,
            evidence=[PlanEvidence(
                "ordering", "deterministic_metadata_sort",
                "Ordered only by explicit script_order, recorded_at, normalized name and id.",
                {"semantic_understanding": False,
                 "sort_precedence": ["script_order", "recorded_at", "name", "id"]},
            )],
        )

    @staticmethod
    def _collaboration_prompt(project: EditProject) -> str:
        clips = [{
            "id": clip.id, "name": clip.name, "duration_seconds": clip.duration_seconds,
            "script_order": clip.script_order,
            "recorded_at": clip.recorded_at.isoformat() if clip.recorded_at else None,
            "source_in": clip.source_in, "source_out": clip.source_out,
            "metadata": clip.metadata,
        } for clip in project.clips]
        schema = {
            "clip_order": ["clip-id"],
            "subtitles": [{"start": 0, "end": 1, "text": "",
                           "language": project.settings.subtitles.language,
                           "style": project.settings.subtitles.style}],
            "transitions": [{"from_clip_id": "", "to_clip_id": "", "kind": "cut", "duration": 0}],
            "sounds": [{"start": 0, "asset": "", "duration": 1, "volume": 1, "purpose": "effect"}],
        }
        return (
            "Propose a professional edit plan using only the supplied project metadata. "
            "Do not claim to have watched or heard media. The final integration must be one JSON object, "
            "without markdown, matching this schema; omit optional cues rather than inventing assets or text. "
            + ("The application already has word-timed local transcription; return subtitles as an empty list because verified cues will be injected after planning. " if project.metadata.get("captions_precomputed") else "") + "\n"
            f"Schema: {json.dumps(schema, ensure_ascii=False)}\n"
            f"Project: {json.dumps({'id': project.id, 'script': project.script, 'settings': _settings_dict(project.settings), 'metadata': project.metadata, 'clips': clips}, ensure_ascii=False)}"
        )

    @staticmethod
    def _parse_collaborative_plan(project: EditProject, content: str) -> EditPlan:
        stripped = content.strip()
        if stripped.startswith("```"):
            lines = stripped.splitlines()[1:]
            if lines and lines[-1].strip() == "```":
                lines.pop()
            stripped = "\n".join(lines)
        data = json.loads(stripped)
        if not isinstance(data, dict) or not isinstance(data.get("clip_order"), list):
            raise ValueError("collaborative plan requires clip_order")
        allowed_keys = {"clip_order", "subtitles", "transitions", "sounds"}
        if set(data) - allowed_keys:
            raise ValueError("collaborative plan contains unknown fields")
        clip_map = {clip.id: clip for clip in project.clips}
        order = data["clip_order"]
        if len(order) != len(set(order)) or set(order) != set(clip_map):
            raise ValueError("clip_order must contain every known clip id exactly once")
        cursor = 0.0
        placements = []
        for clip_id in order:
            clip = clip_map[clip_id]
            placements.append(TimelinePlacement(clip.id, cursor, clip.source_in, clip.source_out))
            cursor += clip.selected_duration
        subtitles = []
        for item in data.get("subtitles", []):
            values = dict(item)
            values.setdefault("language", project.settings.subtitles.language)
            values.setdefault("style", project.settings.subtitles.style)
            subtitles.append(SubtitleCue(**values))
        transitions = [Transition(**item) for item in data.get("transitions", [])]
        sounds = [SoundCue(**item) for item in data.get("sounds", [])]
        plan = EditPlan(
            project.id, placements, status=EditPlanStatus.PROPOSED,
            settings=project.settings,
            subtitles=subtitles, transitions=transitions, sounds=sounds,
            source="multiagent_validated_json",
            evidence=[PlanEvidence(
                "validation", "strict_plan_parser",
                "Collaborative JSON passed structural and timeline validation.",
                {"semantic_understanding_claimed_by_core": False},
            )],
        )
        plan.validate(project)
        return plan


def _clip_dict(clip: EditClip) -> dict[str, Any]:
    return {"id": clip.id, "project_id": clip.project_id, "name": clip.name,
            "source": clip.source, "duration_seconds": clip.duration_seconds,
            "script_order": clip.script_order,
            "recorded_at": clip.recorded_at.isoformat() if clip.recorded_at else None,
            "source_in": clip.source_in, "source_out": clip.source_out, "metadata": clip.metadata}


def _project_dict(project: EditProject) -> dict[str, Any]:
    return {"id": project.id, "name": project.name, "script": project.script,
            "status": project.status.value, "settings": _settings_dict(project.settings),
            "metadata": project.metadata,
            "created_at": project.created_at.isoformat(),
            "clips": [_clip_dict(clip) for clip in project.clips]}


def _project_from_dict(data: dict[str, Any]) -> EditProject:
    clips = [EditClip(**(item | {"recorded_at": _parse_dt(item.get("recorded_at"))})) for item in data["clips"]]
    return EditProject(data["name"], clips, id=data["id"], script=data.get("script"),
                       status=EditProjectStatus(data["status"]),
                       settings=_settings_from_dict(data.get("settings", {})),
                       metadata=data.get("metadata", {}),
                       created_at=_parse_dt(data["created_at"]))


def _evidence_dict(value: PlanEvidence) -> dict[str, Any]:
    return {"category": value.category, "source": value.source, "message": value.message,
            "data": value.data, "created_at": value.created_at.isoformat()}


def _plan_dict(plan: EditPlan) -> dict[str, Any]:
    return {"id": plan.id, "project_id": plan.project_id, "status": plan.status.value,
            "settings": _settings_dict(plan.settings),
            "placements": [item.__dict__ for item in plan.placements],
            "subtitles": [item.__dict__ for item in plan.subtitles],
            "transitions": [item.__dict__ for item in plan.transitions],
            "sounds": [item.__dict__ for item in plan.sounds], "source": plan.source,
            "collaboration_round_id": plan.collaboration_round_id,
            "evidence": [_evidence_dict(item) for item in plan.evidence],
            "metadata": plan.metadata, "created_at": plan.created_at.isoformat(),
            "updated_at": plan.updated_at.isoformat()}


def _plan_from_dict(data: dict[str, Any]) -> EditPlan:
    return EditPlan(
        id=data["id"], project_id=data["project_id"], status=EditPlanStatus(data["status"]),
        settings=_settings_from_dict(data.get("settings", {})),
        placements=[TimelinePlacement(**item) for item in data["placements"]],
        subtitles=[SubtitleCue(**item) for item in data.get("subtitles", [])],
        transitions=[Transition(**item) for item in data.get("transitions", [])],
        sounds=[SoundCue(**item) for item in data.get("sounds", [])],
        source=data["source"], collaboration_round_id=data.get("collaboration_round_id"),
        evidence=[PlanEvidence(item["category"], item["source"], item["message"], item.get("data", {}),
                               _parse_dt(item["created_at"])) for item in data.get("evidence", [])],
        metadata=data.get("metadata", {}), created_at=_parse_dt(data["created_at"]),
        updated_at=_parse_dt(data["updated_at"]),
    )


def _settings_dict(settings: EditSettings) -> dict[str, Any]:
    return {
        "subtitles": settings.subtitles.__dict__,
        "transitions": {
            **settings.transitions.__dict__,
            "allowed_kinds": list(settings.transitions.allowed_kinds),
        },
        "music": settings.music.__dict__,
        "sfx": {
            **settings.sfx.__dict__,
            "allowed_assets": list(settings.sfx.allowed_assets),
        },
        "pacing_framing": settings.pacing_framing.__dict__,
    }


def _settings_from_dict(data: dict[str, Any]) -> EditSettings:
    transitions = dict(data.get("transitions", {}))
    if "allowed_kinds" in transitions:
        transitions["allowed_kinds"] = tuple(transitions["allowed_kinds"])
    sfx = dict(data.get("sfx", {}))
    if "allowed_assets" in sfx:
        sfx["allowed_assets"] = tuple(sfx["allowed_assets"])
    return EditSettings(
        subtitles=SubtitleSettings(**data.get("subtitles", {})),
        transitions=TransitionSettings(**transitions),
        music=MusicSettings(**data.get("music", {})),
        sfx=SFXSettings(**sfx),
        pacing_framing=PacingFramingSettings(**data.get("pacing_framing", {})),
    )
