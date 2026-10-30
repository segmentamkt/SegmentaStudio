"""Minimal, dependency-free audiovisual engine for Kiko Studio.

The module delegates media decoding and encoding to the system ``ffmpeg`` and
``ffprobe`` binaries.  Importing a file never rewrites the source: a byte-for-
byte copy is placed below the selected project directory.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Mapping, Sequence


SUPPORTED_INPUTS = frozenset({".mp4", ".mov"})
DEFAULT_PURPLE = "0x2E1065"
TRANSITION_TYPES = frozenset(
    {"cut", "fade", "fadeblack", "fadewhite", "wipeleft", "wiperight", "slideleft", "slideright", "dissolve"}
)
SUBTITLE_TEMPLATES = frozenset({"kiko", "caption", "minimal"})


class VideoEngineError(RuntimeError):
    """Base error for media operations."""


class ToolUnavailableError(VideoEngineError):
    """Raised when ffmpeg or ffprobe is not installed or discoverable."""


@dataclass(frozen=True)
class Toolchain:
    ffmpeg: Path | None
    ffprobe: Path | None
    native: bool = False

    @property
    def available(self) -> bool:
        return (self.ffmpeg is not None and self.ffprobe is not None) or self.native

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(
            name
            for name, path in (("ffmpeg", self.ffmpeg), ("ffprobe", self.ffprobe))
            if path is None
        )


@dataclass(frozen=True)
class MediaInfo:
    path: Path
    duration: float
    width: int
    height: int
    has_audio: bool
    video_codec: str | None = None
    audio_codec: str | None = None

    @property
    def resolution(self) -> tuple[int, int]:
        return self.width, self.height


@dataclass(frozen=True)
class SilenceSegment:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def detect_toolchain() -> Toolchain:
    """Locate the required media executables without starting a process."""

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    try:
        from . import native_video

        native = native_video.is_available()
    except (ImportError, OSError):
        native = False
    return Toolchain(Path(ffmpeg) if ffmpeg else None, Path(ffprobe) if ffprobe else None, native)


def _require_tool(path: Path | None, name: str) -> Path:
    if path is None:
        raise ToolUnavailableError(
            f"{name} is required for this operation but was not found on PATH. "
            "Install an ffmpeg distribution that includes both ffmpeg and ffprobe."
        )
    return path


def _safe_name(source: Path) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", source.stem).strip("._") or "video"
    return f"{stem}{source.suffix.lower()}"


def import_media(source: os.PathLike[str] | str, project_dir: os.PathLike[str] | str) -> Path:
    """Copy an MP4/MOV into ``project_dir/media/imports`` and return its path.

    Existing files are never overwritten.  If a same-named byte-identical copy
    already exists it is reused; otherwise a numeric suffix is added.
    """

    src = Path(source).expanduser().resolve()
    if not src.is_file():
        raise FileNotFoundError(f"Video source does not exist: {src}")
    if src.suffix.lower() not in SUPPORTED_INPUTS:
        raise VideoEngineError("Only MP4 and MOV inputs are supported.")

    target_dir = Path(project_dir).expanduser().resolve() / "media" / "imports"
    target_dir.mkdir(parents=True, exist_ok=True)
    candidate = target_dir / _safe_name(src)
    index = 2
    while candidate.exists():
        if candidate.is_file() and _files_equal(src, candidate):
            return candidate
        candidate = target_dir / f"{Path(_safe_name(src)).stem}-{index}{src.suffix.lower()}"
        index += 1

    shutil.copy2(src, candidate)
    return candidate


def _files_equal(left: Path, right: Path, chunk_size: int = 1024 * 1024) -> bool:
    if left.stat().st_size != right.stat().st_size:
        return False
    with left.open("rb") as lhs, right.open("rb") as rhs:
        while True:
            a = lhs.read(chunk_size)
            b = rhs.read(chunk_size)
            if a != b:
                return False
            if not a:
                return True


def _run(command: Sequence[os.PathLike[str] | str]) -> subprocess.CompletedProcess[str]:
    rendered = [os.fspath(part) for part in command]
    try:
        return subprocess.run(
            rendered,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise ToolUnavailableError(f"Media tool was not found: {rendered[0]}") from exc
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or "unknown ffmpeg error").strip()
        raise VideoEngineError(f"Media command failed: {details}") from exc


def analyze_media(
    path: os.PathLike[str] | str, *, toolchain: Toolchain | None = None
) -> MediaInfo:
    """Read duration, resolution, codecs and audio presence with ffprobe."""

    media_path = Path(path).expanduser().resolve()
    if not media_path.is_file():
        raise FileNotFoundError(f"Video does not exist: {media_path}")
    tools = toolchain or detect_toolchain()
    if tools.ffprobe is None and tools.native:
        try:
            from . import native_video

            payload = native_video.probe(media_path)
            return MediaInfo(
                path=media_path,
                duration=float(payload["duration"]),
                width=int(payload["width"]),
                height=int(payload["height"]),
                has_audio=bool(payload["has_audio"]),
                video_codec=payload.get("video_codec"),
                audio_codec=payload.get("audio_codec"),
            )
        except (native_video.NativeVideoError, KeyError, TypeError, ValueError) as exc:
            raise VideoEngineError(f"Native media inspection failed: {exc}") from exc
    ffprobe = _require_tool(tools.ffprobe, "ffprobe")
    result = _run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            media_path,
        ]
    )
    try:
        payload: Mapping[str, Any] = json.loads(result.stdout)
        streams = payload.get("streams", [])
        video = next(item for item in streams if item.get("codec_type") == "video")
        audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
        raw_duration = payload.get("format", {}).get("duration") or video.get("duration")
        return MediaInfo(
            path=media_path,
            duration=float(raw_duration),
            width=int(video["width"]),
            height=int(video["height"]),
            has_audio=audio is not None,
            video_codec=video.get("codec_name"),
            audio_codec=audio.get("codec_name") if audio else None,
        )
    except (KeyError, TypeError, ValueError, StopIteration) as exc:
        raise VideoEngineError("ffprobe returned incomplete or invalid media metadata.") from exc


_SILENCE_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


def detect_silences(
    path: os.PathLike[str] | str,
    *,
    noise_db: float = -35.0,
    min_duration: float = 0.5,
    toolchain: Toolchain | None = None,
) -> list[SilenceSegment]:
    """Return silent intervals detected by ffmpeg's ``silencedetect`` filter."""

    if min_duration <= 0:
        raise ValueError("min_duration must be greater than zero")
    media_path = Path(path).expanduser().resolve()
    if not media_path.is_file():
        raise FileNotFoundError(f"Video does not exist: {media_path}")
    tools = toolchain or detect_toolchain()
    if tools.ffmpeg is None and tools.native:
        try:
            from . import native_video

            return [
                SilenceSegment(float(item["start"]), float(item["end"]))
                for item in native_video.detect_silences(media_path, noise_db, min_duration)
            ]
        except native_video.NativeVideoError as exc:
            raise ToolUnavailableError(str(exc)) from exc
    ffmpeg = _require_tool(tools.ffmpeg, "ffmpeg")
    result = _run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-i",
            media_path,
            "-af",
            f"silencedetect=noise={noise_db:g}dB:d={min_duration:g}",
            "-f",
            "null",
            "-",
        ]
    )
    segments: list[SilenceSegment] = []
    pending: float | None = None
    for line in result.stderr.splitlines():
        start_match = _SILENCE_START.search(line)
        if start_match:
            pending = max(0.0, float(start_match.group(1)))
        end_match = _SILENCE_END.search(line)
        if end_match and pending is not None:
            end = max(pending, float(end_match.group(1)))
            segments.append(SilenceSegment(pending, end))
            pending = None
    if pending is not None:
        try:
            end = analyze_media(media_path, toolchain=tools).duration
        except VideoEngineError:
            end = pending
        segments.append(SilenceSegment(pending, max(pending, end)))
    return segments


def _escape_drawtext(text: str) -> str:
    # ffmpeg drawtext treats these characters specially inside a single-quoted
    # value. Newlines are intentionally normalized to keep the filter portable.
    return (
        text.replace("\\", r"\\")
        .replace("'", r"\'")
        .replace(":", r"\:")
        .replace("%", r"\%")
        .replace("\n", " ")
        .replace("\r", " ")
    )


def export_vertical(
    source: os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    *,
    subtitle: str | None = None,
    width: int = 1080,
    height: int = 1920,
    purple: str = DEFAULT_PURPLE,
    start_time: float = 0.0,
    end_time: float | None = None,
    toolchain: Toolchain | None = None,
) -> Path:
    """Export a vertical, H.264/AAC MP4 with purple framing and optional text."""

    if width <= 0 or height <= 0 or height <= width:
        raise ValueError("Vertical output requires positive dimensions with height > width")
    if start_time < 0 or (end_time is not None and end_time <= start_time):
        raise ValueError("Trim times require 0 <= start_time < end_time")
    src = Path(source).expanduser().resolve()
    if not src.is_file():
        raise FileNotFoundError(f"Video does not exist: {src}")
    dest = Path(destination).expanduser().resolve()
    if dest.suffix.lower() != ".mp4":
        raise VideoEngineError("Vertical exports must use an .mp4 destination.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tools = toolchain or detect_toolchain()
    if tools.ffmpeg is None and tools.native:
        try:
            from . import native_video

            native_video.export_vertical(src, dest, width, height, purple, subtitle, start_time, end_time)
        except native_video.NativeVideoError as exc:
            raise VideoEngineError(f"Native vertical export failed: {exc}") from exc
        if not dest.is_file() or dest.stat().st_size == 0:
            raise VideoEngineError("Native exporter finished without producing an MP4.")
        return dest
    ffmpeg = _require_tool(tools.ffmpeg, "ffmpeg")

    filters = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={purple}"
    )
    if subtitle:
        safe_text = _escape_drawtext(subtitle)
        font_size = max(20, width // 18)
        filters += (
            ",drawtext="
            f"text='{safe_text}':fontcolor=white:fontsize={font_size}:"
            "box=1:boxcolor=0x2E1065CC:boxborderw=20:"
            "x=(w-text_w)/2:y=h-text_h-h*0.08"
        )

    temporary = dest.with_name(f".{dest.stem}.partial.mp4")
    command: list[os.PathLike[str] | str] = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-nostdin",
    ]
    if start_time:
        command.extend(["-ss", f"{start_time:g}"])
    command.extend(["-i", src])
    if end_time is not None:
        command.extend(["-t", f"{end_time - start_time:g}"])
    command.extend([
        "-vf",
        filters,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        temporary,
    ])
    try:
        _run(command)
        if not temporary.is_file() or temporary.stat().st_size == 0:
            raise VideoEngineError("ffmpeg finished without producing a playable MP4.")
        temporary.replace(dest)
    finally:
        if temporary.exists():
            temporary.unlink()
    return dest


def generate_synthetic_test_video(
    destination: os.PathLike[str] | str,
    *,
    duration: float = 2.0,
    width: int = 360,
    height: int = 640,
    with_audio: bool = True,
    toolchain: Toolchain | None = None,
) -> Path:
    """Generate an obviously synthetic test pattern; no real likeness is used."""

    if duration <= 0 or width <= 0 or height <= 0:
        raise ValueError("duration and dimensions must be greater than zero")
    dest = Path(destination).expanduser().resolve()
    if dest.suffix.lower() != ".mp4":
        raise VideoEngineError("Synthetic test videos must use an .mp4 destination.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tools = toolchain or detect_toolchain()
    if tools.ffmpeg is None and tools.native:
        try:
            from . import native_video

            native_video.generate_synthetic(dest, duration, width, height)
        except native_video.NativeVideoError as exc:
            raise VideoEngineError(f"Native synthetic video generation failed: {exc}") from exc
        if not dest.is_file() or dest.stat().st_size == 0:
            raise VideoEngineError("Native generator finished without producing the synthetic MP4.")
        return dest
    ffmpeg = _require_tool(tools.ffmpeg, "ffmpeg")
    command: list[os.PathLike[str] | str] = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={width}x{height}:rate=30:duration={duration:g}",
    ]
    if with_audio:
        command.extend(
            ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={duration:g}"]
        )
    command.extend(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    if with_audio:
        command.extend(["-c:a", "aac", "-shortest"])
    command.extend(["-movflags", "+faststart", dest])
    _run(command)
    if not dest.is_file() or dest.stat().st_size == 0:
        raise VideoEngineError("ffmpeg finished without producing the synthetic MP4.")
    return dest


def _timeline_plan(
    plan: Mapping[str, Any], *, toolchain: Toolchain
) -> tuple[dict[str, Any], float]:
    """Validate and normalize the public timeline dictionary."""

    if not isinstance(plan, Mapping):
        raise TypeError("plan must be a mapping")
    raw_clips = plan.get("clips")
    if not isinstance(raw_clips, Sequence) or isinstance(raw_clips, (str, bytes)) or not raw_clips:
        raise VideoEngineError("Timeline plan requires a non-empty 'clips' list.")
    normalized: dict[str, Any] = dict(plan)
    clips: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_clips):
        if not isinstance(raw, Mapping) or "path" not in raw:
            raise VideoEngineError(f"Clip {index + 1} requires a path.")
        path = Path(os.fspath(raw["path"])).expanduser().resolve()
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_INPUTS:
            raise VideoEngineError(f"Clip {index + 1} is not a readable MP4/MOV: {path}")
        info = analyze_media(path, toolchain=toolchain)
        start = float(raw.get("start", 0.0))
        end = float(raw.get("end", info.duration))
        if start < 0 or end <= start or end > info.duration + 0.05:
            raise VideoEngineError(f"Clip {index + 1} has invalid trim bounds {start:g}..{end:g}.")
        clips.append(
            {
                "path": str(path),
                "start": start,
                "end": min(end, info.duration),
                "duration": min(end, info.duration) - start,
                "volume": max(0.0, float(raw.get("volume", 1.0))),
                "has_audio": info.has_audio,
            }
        )
    raw_transition = plan.get("transition", {})
    if raw_transition is None:
        raw_transition = {}
    if not isinstance(raw_transition, Mapping):
        raise VideoEngineError("'transition' must be an object with type and duration.")
    transition_type = str(
        raw_transition.get("type", plan.get("transition_type", "fade"))
    ).lower()
    if transition_type not in TRANSITION_TYPES:
        raise VideoEngineError(
            f"Unsupported transition '{transition_type}'. Choose one of: {', '.join(sorted(TRANSITION_TYPES))}."
        )
    transition = max(
        0.0,
        float(raw_transition.get("duration", plan.get("transition_duration", 0.0))),
    )
    if transition_type == "cut":
        transition = 0.0
    if len(clips) == 1:
        transition = 0.0
    if transition and any(transition >= item["duration"] for item in clips):
        raise VideoEngineError("Each clip must be longer than the crossfade transition.")
    total = sum(item["duration"] for item in clips) - transition * (len(clips) - 1)
    normalized["clips"] = clips
    normalized["transition_duration"] = transition
    normalized["transition_type"] = transition_type
    normalized["transition"] = {"type": transition_type, "duration": transition}
    normalized["width"] = int(plan.get("width", 1080))
    normalized["height"] = int(plan.get("height", 1920))
    normalized["purple"] = str(plan.get("purple", DEFAULT_PURPLE))
    framing = str(plan.get("framing", "fit")).lower()
    if framing not in {"fit", "fill"}:
        raise VideoEngineError("Timeline framing must be 'fit' or 'fill'.")
    normalized["framing"] = framing
    if normalized["width"] <= 0 or normalized["height"] <= normalized["width"]:
        raise VideoEngineError("Timeline output must use positive vertical dimensions.")
    for kind in ("subtitles", "sounds"):
        items = plan.get(kind, [])
        if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
            raise VideoEngineError(f"'{kind}' must be a list.")
        normalized[kind] = [dict(item) for item in items]
    for kind in ("labels", "images"):
        items = plan.get(kind, [])
        if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
            raise VideoEngineError(f"'{kind}' must be a list.")
        normalized[kind] = [dict(item) for item in items]
    music = plan.get("music")
    normalized["music"] = dict(music) if isinstance(music, Mapping) else None
    dialogue_volume = max(0.0, min(2.0, float(plan.get("dialogue_volume", 1.0))))
    music_volume = max(0.0, min(2.0, float(plan.get("music_volume", 1.0))))
    sfx_volume = max(0.0, min(2.0, float(plan.get("sfx_volume", 1.0))))
    normalized["dialogue_volume"] = dialogue_volume
    normalized["music_volume"] = music_volume
    normalized["sfx_volume"] = sfx_volume
    for clip in clips:
        clip["volume"] = min(2.0, clip["volume"] * dialogue_volume)
    if normalized["music"]:
        normalized["music"]["volume"] = min(
            2.0, float(normalized["music"].get("volume", 0.18)) * music_volume
        )
    for sound in normalized["sounds"]:
        sound["volume"] = min(2.0, float(sound.get("volume", 0.7)) * sfx_volume)

    style = plan.get("subtitle_style", {})
    if style is None:
        style = {}
    if not isinstance(style, Mapping):
        raise VideoEngineError("'subtitle_style' must be an object.")
    template = str(style.get("template", "kiko")).lower()
    if template not in SUBTITLE_TEMPLATES:
        raise VideoEngineError(
            f"Unsupported subtitle template '{template}'. Choose kiko, caption, or minimal."
        )
    font_size = int(style.get("font_size", max(20, normalized["width"] // 18)))
    if not 12 <= font_size <= 240:
        raise VideoEngineError("Subtitle font_size must be between 12 and 240.")
    position = str(style.get("position", "bottom")).lower()
    if position not in {"top", "center", "bottom"}:
        raise VideoEngineError("Subtitle position must be top, center, or bottom.")

    def validated_color(value: Any, field: str, default: str) -> str:
        color = str(value or default)
        if not re.fullmatch(r"(?:0x|#)?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?", color):
            raise VideoEngineError(f"{field} must be a 6- or 8-digit hexadecimal color.")
        return "0x" + color.removeprefix("0x").removeprefix("#")

    default_background = "0x000000B8" if template == "caption" else "0x2E1065CC"
    normalized["subtitle_style"] = {
        "template": template,
        "font_size": font_size,
        "text_color": validated_color(style.get("text_color"), "subtitle text_color", "0xFFFFFF"),
        "background_color": validated_color(
            style.get("background_color"), "subtitle background_color", default_background
        ),
        "position": position,
        "highlight_keywords": bool(style.get("highlight_keywords", False)),
        "highlight_color": validated_color(
            style.get("highlight_color"), "subtitle highlight_color", "0xFFE66D"
        ),
    }
    audio_items = list(normalized["sounds"])
    if normalized["music"]:
        audio_items.append(normalized["music"])
    for item in audio_items:
        path_value = item.get("path")
        if path_value is None:
            raise VideoEngineError("Music and sound entries require a path.")
        audio_path = Path(os.fspath(path_value)).expanduser().resolve()
        if not audio_path.is_file():
            raise VideoEngineError(f"Audio track does not exist: {audio_path}")
        item["path"] = str(audio_path)
    for index, image in enumerate(normalized["images"]):
        path_value = image.get("path")
        image_path = Path(os.fspath(path_value or "")).expanduser().resolve()
        if not image_path.is_file() or image_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise VideoEngineError(f"Image overlay {index + 1} is not a readable PNG, JPG or WEBP.")
        start, end = float(image.get("start", 0)), float(image.get("end", total))
        if start < 0 or end <= start or start >= total:
            raise VideoEngineError(f"Image overlay {index + 1} has invalid timing.")
        image.update({"path": str(image_path), "start": start, "end": min(end, total)})
    for index, label in enumerate(normalized["labels"]):
        start, end = float(label.get("start", 0)), float(label.get("end", total))
        if not str(label.get("text", "")).strip() or start < 0 or end <= start or start >= total:
            raise VideoEngineError(f"Label overlay {index + 1} has invalid text or timing.")
        label.update({"start": start, "end": min(end, total)})
        if label.get("full_screen"):
            label["background_color"] = validated_color(
                label.get("background_color"), "label background_color", "0x2E1065"
            )
    normalized["duration"] = total
    return normalized, total


def _compose_ffmpeg(plan: Mapping[str, Any], destination: Path, ffmpeg: Path) -> None:
    clips: list[Mapping[str, Any]] = plan["clips"]
    width, height = int(plan["width"]), int(plan["height"])
    transition = float(plan["transition_duration"])
    total = float(plan["duration"])
    command: list[os.PathLike[str] | str] = [ffmpeg, "-y", "-hide_banner", "-nostdin"]
    for clip in clips:
        command.extend(["-i", clip["path"]])
    next_input = len(clips)
    music_index: int | None = None
    music = plan.get("music")
    if music:
        music_path = Path(os.fspath(music.get("path", ""))).expanduser().resolve()
        if not music_path.is_file():
            raise VideoEngineError(f"Music track does not exist: {music_path}")
        if music.get("loop", True):
            command.extend(["-stream_loop", "-1"])
        command.extend(["-i", music_path])
        music_index = next_input
        next_input += 1
    sound_indices: list[int] = []
    for sound in plan.get("sounds", []):
        sound_path = Path(os.fspath(sound.get("path", ""))).expanduser().resolve()
        if not sound_path.is_file():
            raise VideoEngineError(f"Sound effect does not exist: {sound_path}")
        command.extend(["-i", sound_path])
        sound_indices.append(next_input)
        next_input += 1
    image_indices: list[int] = []
    for image in plan.get("images", []):
        command.extend(["-loop", "1", "-i", image["path"]])
        image_indices.append(next_input)
        next_input += 1

    filters: list[str] = []
    for index, clip in enumerate(clips):
        if plan["framing"] == "fill":
            framing_filter = (
                f"scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height}:(iw-ow)/2:(ih-oh)/2"
            )
        else:
            framing_filter = (
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={plan['purple']}"
            )
        filters.append(
            f"[{index}:v]trim=start={clip['start']:g}:end={clip['end']:g},setpts=PTS-STARTPTS,"
            f"{framing_filter},"
            f"fps=30,format=yuv420p[v{index}]"
        )
        if clip["has_audio"]:
            filters.append(
                f"[{index}:a]atrim=start={clip['start']:g}:end={clip['end']:g},asetpts=PTS-STARTPTS,"
                f"aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"loudnorm=I=-16:LRA=11:TP=-1.5,volume={clip['volume']:g}[a{index}]"
            )
        else:
            filters.append(
                f"anullsrc=r=48000:cl=stereo,atrim=duration={clip['duration']:g},asetpts=PTS-STARTPTS[a{index}]"
            )

    video_label, audio_label = "v0", "a0"
    elapsed = float(clips[0]["duration"])
    for index in range(1, len(clips)):
        if transition:
            offset = elapsed - transition
            filters.append(
                f"[{video_label}][v{index}]xfade=transition={plan['transition_type']}:duration={transition:g}:offset={offset:g}[vx{index}]"
            )
            filters.append(f"[{audio_label}][a{index}]acrossfade=d={transition:g}:c1=tri:c2=tri[ax{index}]")
            elapsed += float(clips[index]["duration"]) - transition
        else:
            filters.append(f"[{video_label}][v{index}]concat=n=2:v=1:a=0[vx{index}]")
            filters.append(f"[{audio_label}][a{index}]concat=n=2:v=0:a=1[ax{index}]")
            elapsed += float(clips[index]["duration"])
        video_label, audio_label = f"vx{index}", f"ax{index}"

    subtitle_style = plan["subtitle_style"]
    position_y = {
        "top": "h*0.08",
        "center": "(h-text_h)/2",
        "bottom": "h-text_h-h*0.08",
    }[subtitle_style["position"]]
    subtitle_box = "0" if subtitle_style["template"] == "minimal" else "1"
    border = 12 if subtitle_style["template"] == "caption" else 20
    for index, subtitle in enumerate(plan.get("subtitles", [])):
        raw_text = str(subtitle.get("text", "")).strip()
        text = _escape_drawtext(raw_text)
        start, end = float(subtitle.get("start", 0)), float(subtitle.get("end", total))
        if not text or start < 0 or end <= start:
            raise VideoEngineError(f"Subtitle {index + 1} has invalid text or timing.")
        if subtitle_style["highlight_keywords"]:
            words = raw_text.split()
            prefix = " ".join(words[:-1])
            keyword = words[-1]
            estimated_character_width = subtitle_style["font_size"] * 0.55
            total_width = max(estimated_character_width, len(raw_text) * estimated_character_width)
            start_x = max(0.0, (width - total_width) / 2)
            if prefix:
                prefix_output = f"vsp{index}"
                filters.append(
                    f"[{video_label}]drawtext=text='{_escape_drawtext(prefix)}':"
                    f"fontcolor={subtitle_style['text_color']}:fontsize={subtitle_style['font_size']}:"
                    f"box=0:x={start_x:g}:y={position_y}:"
                    f"enable='between(t,{start:g},{end:g})'[{prefix_output}]"
                )
                video_label = prefix_output
                keyword_x = start_x + (len(prefix) + 1) * estimated_character_width
            else:
                keyword_x = start_x
            output = f"vs{index}"
            filters.append(
                f"[{video_label}]drawtext=text='{_escape_drawtext(keyword)}':"
                f"fontcolor={subtitle_style['highlight_color']}:fontsize={subtitle_style['font_size']}:"
                f"box=0:x={keyword_x:g}:y={position_y}:"
                f"enable='between(t,{start:g},{end:g})'[{output}]"
            )
            video_label = output
            continue
        output = f"vs{index}"
        filters.append(
            f"[{video_label}]drawtext=text='{text}':fontcolor={subtitle_style['text_color']}:"
            f"fontsize={subtitle_style['font_size']}:box={subtitle_box}:"
            f"boxcolor={subtitle_style['background_color']}:boxborderw={border}:"
            f"x=(w-text_w)/2:y={position_y}:"
            f"enable='between(t,{start:g},{end:g})'[{output}]"
        )
        video_label = output

    label_y = {"top": "h*0.06", "center": "(h-text_h)/2", "bottom": "h-text_h-h*0.06"}
    for index, label in enumerate(plan.get("labels", [])):
        text = _escape_drawtext(str(label.get("text", "")))
        start, end = float(label["start"]), float(label["end"])
        position = str(label.get("position", "top"))
        if label.get("full_screen"):
            card_color = str(label.get("background_color", "0x2E1065"))
            card_output, output = f"vlb{index}", f"vl{index}"
            filters.append(
                f"[{video_label}]drawbox=x=0:y=0:w=iw:h=ih:color={card_color}:t=fill:"
                f"enable='between(t,{start:g},{end:g})'[{card_output}]"
            )
            filters.append(
                f"[{card_output}]drawtext=text='{text}':fontcolor=white:fontsize={max(48, width//12)}:"
                f"box=0:x=(w-text_w)/2:y=(h-text_h)/2:"
                f"enable='between(t,{start:g},{end:g})'[{output}]"
            )
            video_label = output
            continue
        output = f"vl{index}"
        filters.append(
            f"[{video_label}]drawtext=text='{text}':fontcolor=white:fontsize={max(28, width//22)}:"
            f"box=1:boxcolor=0x111111D8:boxborderw=18:x=(w-text_w)/2:y={label_y.get(position, label_y['top'])}:"
            f"enable='between(t,{start:g},{end:g})'[{output}]"
        )
        video_label = output

    overlay_y = {"top": "h*0.08", "center": "(h-overlay_h)/2", "bottom": "h-overlay_h-h*0.08"}
    for index, (image, input_index) in enumerate(zip(plan.get("images", []), image_indices)):
        width_percent = max(0.1, min(0.95, float(image.get("width_percent", 0.72))))
        position = str(image.get("position", "center"))
        start, end = float(image["start"]), float(image["end"])
        prepared, output = f"img{index}", f"vi{index}"
        filters.append(f"[{input_index}:v]scale={int(width*width_percent)}:-1,format=rgba[{prepared}]")
        filters.append(
            f"[{video_label}][{prepared}]overlay=x=(w-overlay_w)/2:y={overlay_y.get(position, overlay_y['center'])}:"
            f"enable='between(t,{start:g},{end:g})'[{output}]"
        )
        video_label = output

    mix_labels = [audio_label]
    if music_index is not None and music:
        start = max(0.0, float(music.get("start", 0.0)))
        delay = round(start * 1000)
        volume = max(0.0, float(music.get("volume", 0.18)))
        filters.append(
            f"[{music_index}:a]atrim=duration={max(0.0, total-start):g},asetpts=PTS-STARTPTS,"
            f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={volume:g},"
            f"adelay={delay}|{delay}[music]"
        )
        mix_labels.append("music")
    for number, (sound, input_index) in enumerate(zip(plan.get("sounds", []), sound_indices)):
        start = max(0.0, float(sound.get("start", 0.0)))
        delay = round(start * 1000)
        volume = max(0.0, float(sound.get("volume", 0.7)))
        label = f"sound{number}"
        filters.append(
            f"[{input_index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"volume={volume:g},adelay={delay}|{delay}[{label}]"
        )
        mix_labels.append(label)
    if len(mix_labels) > 1:
        inputs = "".join(f"[{label}]" for label in mix_labels)
        filters.append(
            f"{inputs}amix=inputs={len(mix_labels)}:duration=first:dropout_transition=2:normalize=0,"
            "alimiter=limit=0.95[aout]"
        )
        audio_label = "aout"

    temporary = destination.with_name(f".{destination.stem}.partial.mp4")
    command.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            f"[{video_label}]",
            "-map",
            f"[{audio_label}]",
            "-c:v",
            "libx264",
            "-preset",
            str(plan.get("preset", "medium")),
            "-crf",
            str(plan.get("crf", 20)),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            "-t",
            f"{total:g}",
            temporary,
        ]
    )
    try:
        _run(command)
        if not temporary.is_file() or temporary.stat().st_size == 0:
            raise VideoEngineError("Timeline export did not produce an MP4.")
        temporary.replace(destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def compose_timeline(
    plan: Mapping[str, Any],
    destination: os.PathLike[str] | str,
    *,
    toolchain: Toolchain | None = None,
) -> Path:
    """Compose ordered clips, timed text and optional audio into one vertical MP4.

    ``plan`` accepts ``clips`` (path/start/end/volume), ``transition_duration``,
    ``subtitles`` (text/start/end), optional ``music`` and ``sounds`` entries.
    Inputs are read-only; only the destination and a temporary sibling are used.
    """

    dest = Path(destination).expanduser().resolve()
    if dest.suffix.lower() != ".mp4":
        raise VideoEngineError("Timeline destination must use .mp4.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tools = toolchain or detect_toolchain()
    normalized, _ = _timeline_plan(plan, toolchain=tools)
    if tools.ffmpeg is not None:
        _compose_ffmpeg(normalized, dest, tools.ffmpeg)
    elif tools.native:
        if normalized["transition_duration"]:
            normalized["native_transition_note"] = "AVFoundation fallback uses hard cuts"
            normalized["transition_duration"] = 0.0
            normalized["transition"] = {"type": "cut", "duration": 0.0}
            normalized["duration"] = sum(clip["duration"] for clip in normalized["clips"])
        try:
            from . import native_video

            native_video.compose_timeline(normalized, dest)
        except native_video.NativeVideoError as exc:
            raise VideoEngineError(f"Native timeline composition failed: {exc}") from exc
    else:
        raise ToolUnavailableError("Timeline composition requires ffmpeg or macOS AVFoundation.")
    if not dest.is_file() or dest.stat().st_size == 0:
        raise VideoEngineError("Timeline composition finished without producing an MP4.")
    return dest


class VideoEngine:
    """Small object-oriented facade suitable for application integration."""

    def __init__(self, toolchain: Toolchain | None = None) -> None:
        self.toolchain = toolchain or detect_toolchain()

    @property
    def available(self) -> bool:
        return self.toolchain.available

    @property
    def backend(self) -> str:
        if self.toolchain.ffmpeg is not None and self.toolchain.ffprobe is not None:
            return "ffmpeg"
        if self.toolchain.native:
            return "avfoundation"
        return "unavailable"

    @property
    def capabilities(self) -> dict[str, bool]:
        """Feature flags suitable for disabling unavailable controls in a UI."""

        ffmpeg = self.toolchain.ffmpeg is not None
        probe = self.toolchain.ffprobe is not None or self.toolchain.native
        encode = ffmpeg or self.toolchain.native
        return {
            "import": True,
            "inspect": probe,
            "vertical_export": encode,
            "timeline_composition": encode,
            "crossfade": ffmpeg,
            "audio_mix": encode,
            "audio_normalization": ffmpeg,
            "trim": encode,
            "subtitles": encode,
            "subtitle_styling": encode,
            "image_overlays": encode,
            "text_labels": encode,
            "volume_controls": encode,
            "framing_fit": encode,
            "framing_fill": encode,
            "synthetic_video": encode,
            "silence_detection": ffmpeg,
            "synthetic_audio": ffmpeg,
        }

    @property
    def supported_transitions(self) -> tuple[str, ...]:
        if self.toolchain.ffmpeg is not None:
            return tuple(sorted(TRANSITION_TYPES))
        if self.toolchain.native:
            return ("cut",)
        return ()

    def import_media(self, source: os.PathLike[str] | str, project_dir: os.PathLike[str] | str) -> Path:
        return import_media(source, project_dir)

    def analyze(self, path: os.PathLike[str] | str) -> MediaInfo:
        return analyze_media(path, toolchain=self.toolchain)

    def detect_silences(self, path: os.PathLike[str] | str, **options: Any) -> list[SilenceSegment]:
        return detect_silences(path, toolchain=self.toolchain, **options)

    def export_vertical(self, source: os.PathLike[str] | str, destination: os.PathLike[str] | str, **options: Any) -> Path:
        return export_vertical(source, destination, toolchain=self.toolchain, **options)

    def generate_synthetic_test_video(self, destination: os.PathLike[str] | str, **options: Any) -> Path:
        return generate_synthetic_test_video(destination, toolchain=self.toolchain, **options)

    def compose_timeline(
        self, plan: Mapping[str, Any], destination: os.PathLike[str] | str
    ) -> Path:
        return compose_timeline(plan, destination, toolchain=self.toolchain)
