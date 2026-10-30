from __future__ import annotations

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from kiko_studio import native_video

from kiko_studio.video_engine import (
    MediaInfo,
    ToolUnavailableError,
    Toolchain,
    VideoEngine,
    VideoEngineError,
    analyze_media,
    compose_timeline,
    detect_silences,
    detect_toolchain,
    export_vertical,
    generate_synthetic_test_video,
    import_media,
)


class VideoEngineUnitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "Original Clip.MOV"
        self.source.write_bytes(b"untouched source")
        self.tools = Toolchain(Path("/tools/ffmpeg"), Path("/tools/ffprobe"))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_import_copies_into_project_without_modifying_original(self) -> None:
        before = self.source.read_bytes()
        imported = import_media(self.source, self.root / "project")
        self.assertEqual(imported.parent, (self.root / "project" / "media" / "imports").resolve())
        self.assertEqual(imported.suffix, ".mov")
        self.assertEqual(imported.read_bytes(), before)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertNotEqual(imported, self.source)
        self.assertEqual(import_media(self.source, self.root / "project"), imported)

    def test_import_rejects_unsupported_type(self) -> None:
        bad = self.root / "clip.avi"
        bad.write_bytes(b"video")
        with self.assertRaises(VideoEngineError):
            import_media(bad, self.root / "project")

    @mock.patch("kiko_studio.video_engine._run")
    def test_analyze_extracts_duration_resolution_and_audio(self, run: mock.Mock) -> None:
        run.return_value = subprocess.CompletedProcess(
            [],
            0,
            stdout=(
                '{"format":{"duration":"3.25"},"streams":['
                '{"codec_type":"video","codec_name":"h264","width":1920,"height":1080},'
                '{"codec_type":"audio","codec_name":"aac"}]}'
            ),
            stderr="",
        )
        info = analyze_media(self.source, toolchain=self.tools)
        self.assertEqual(info.resolution, (1920, 1080))
        self.assertEqual(info.duration, 3.25)
        self.assertTrue(info.has_audio)
        self.assertEqual(info.audio_codec, "aac")

    @mock.patch("kiko_studio.video_engine._run")
    def test_silence_detection_parses_intervals(self, run: mock.Mock) -> None:
        run.return_value = subprocess.CompletedProcess(
            [],
            0,
            stdout="",
            stderr=(
                "[silencedetect] silence_start: 0.4\n"
                "[silencedetect] silence_end: 1.75 | silence_duration: 1.35\n"
                "[silencedetect] silence_start: 2.0\n"
                "[silencedetect] silence_end: 2.5 | silence_duration: 0.5\n"
            ),
        )
        segments = detect_silences(self.source, toolchain=self.tools)
        self.assertEqual([(x.start, x.end, x.duration) for x in segments], [(0.4, 1.75, 1.35), (2.0, 2.5, 0.5)])

    @mock.patch("kiko_studio.video_engine._run")
    def test_vertical_export_builds_purple_filter_and_optional_subtitle(self, run: mock.Mock) -> None:
        destination = self.root / "exports" / "vertical.mp4"

        def produce(command: list[str]) -> subprocess.CompletedProcess[str]:
            Path(command[-1]).write_bytes(b"mp4")
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = produce
        result = export_vertical(
            self.source,
            destination,
            subtitle="Kiko: hola",
            width=360,
            height=640,
            toolchain=self.tools,
        )
        self.assertEqual(result, destination.resolve())
        self.assertEqual(result.read_bytes(), b"mp4")
        command = [str(part) for part in run.call_args.args[0]]
        video_filter = command[command.index("-vf") + 1]
        self.assertIn("pad=360:640", video_filter)
        self.assertIn("color=0x2E1065", video_filter)
        self.assertIn("drawtext=", video_filter)
        self.assertIn("Kiko\\: hola", video_filter)

    @mock.patch("kiko_studio.video_engine._run")
    def test_synthetic_video_is_explicit_test_pattern(self, run: mock.Mock) -> None:
        destination = self.root / "synthetic.mp4"

        def produce(command: list[str]) -> subprocess.CompletedProcess[str]:
            Path(command[-1]).write_bytes(b"synthetic")
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = produce
        generate_synthetic_test_video(destination, duration=1, toolchain=self.tools)
        command = [str(part) for part in run.call_args.args[0]]
        self.assertTrue(any(item.startswith("testsrc2=") for item in command))
        self.assertTrue(any(item.startswith("sine=") for item in command))

    def test_clear_degradation_when_tools_are_missing(self) -> None:
        engine = VideoEngine(Toolchain(None, None))
        self.assertFalse(engine.available)
        self.assertEqual(engine.backend, "unavailable")
        self.assertFalse(engine.capabilities["vertical_export"])
        with self.assertRaisesRegex(ToolUnavailableError, "ffprobe.*PATH"):
            engine.analyze(self.source)
        with self.assertRaisesRegex(ToolUnavailableError, "ffmpeg.*PATH"):
            engine.detect_silences(self.source)

    def test_native_capabilities_are_explicit(self) -> None:
        engine = VideoEngine(Toolchain(None, None, native=True))
        self.assertEqual(engine.backend, "avfoundation")
        self.assertTrue(engine.capabilities["vertical_export"])
        self.assertTrue(engine.capabilities["subtitles"])
        self.assertFalse(engine.capabilities["silence_detection"])
        self.assertFalse(engine.capabilities["synthetic_audio"])

    @mock.patch("kiko_studio.native_video.probe")
    def test_native_probe_fallback_without_ffprobe(self, probe: mock.Mock) -> None:
        probe.return_value = {
            "duration": 4.5,
            "width": 1080,
            "height": 1920,
            "has_audio": False,
            "video_codec": "h264",
            "audio_codec": None,
        }
        info = analyze_media(self.source, toolchain=Toolchain(None, None, native=True))
        self.assertEqual(info.resolution, (1080, 1920))
        self.assertEqual(info.duration, 4.5)
        self.assertFalse(info.has_audio)

    @mock.patch("kiko_studio.native_video.export_vertical")
    def test_native_export_fallback_supports_trim(self, native_export: mock.Mock) -> None:
        destination = self.root / "native.mp4"

        def produce(source: Path, output: Path, *args: object) -> None:
            output.write_bytes(b"native-mp4")

        native_export.side_effect = produce
        result = export_vertical(
            self.source,
            destination,
            width=360,
            height=640,
            start_time=1.0,
            end_time=2.5,
            toolchain=Toolchain(None, None, native=True),
        )
        self.assertEqual(result.read_bytes(), b"native-mp4")
        self.assertEqual(native_export.call_args.args[-2:], (1.0, 2.5))

    @mock.patch("kiko_studio.video_engine._run")
    def test_ffmpeg_export_applies_trim(self, run: mock.Mock) -> None:
        destination = self.root / "trimmed.mp4"

        def produce(command: list[str]) -> subprocess.CompletedProcess[str]:
            Path(command[-1]).write_bytes(b"mp4")
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = produce
        export_vertical(
            self.source,
            destination,
            width=360,
            height=640,
            start_time=1.25,
            end_time=3.0,
            toolchain=self.tools,
        )
        command = [str(part) for part in run.call_args.args[0]]
        self.assertEqual(command[command.index("-ss") + 1], "1.25")
        self.assertEqual(command[command.index("-t") + 1], "1.75")

    @mock.patch("kiko_studio.video_engine.analyze_media")
    @mock.patch("kiko_studio.video_engine._run")
    def test_compose_timeline_builds_one_ordered_crossfade_mix(
        self, run: mock.Mock, analyze: mock.Mock
    ) -> None:
        second = self.root / "Second.mp4"
        music = self.root / "music.m4a"
        sound = self.root / "sound.wav"
        second.write_bytes(b"clip2")
        music.write_bytes(b"music")
        sound.write_bytes(b"sound")
        analyze.side_effect = lambda path, **_: MediaInfo(Path(path), 5, 640, 360, True)

        def produce(command: list[str]) -> subprocess.CompletedProcess[str]:
            Path(command[-1]).write_bytes(b"timeline")
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = produce
        destination = self.root / "timeline.mp4"
        result = compose_timeline(
            {
                "clips": [
                    {"path": self.source, "start": 0.5, "end": 3.0},
                    {"path": second, "start": 1.0, "end": 4.0, "volume": 0.8},
                ],
                "transition": {"type": "wipeleft", "duration": 0.4},
                "subtitles": [{"text": "Hola: Kiko", "start": 0.2, "end": 1.8}],
                "subtitle_style": {
                    "template": "caption",
                    "font_size": 34,
                    "text_color": "#FFEEAA",
                    "background_color": "0x111111DD",
                    "position": "top",
                },
                "dialogue_volume": 0.5,
                "music": {"path": music, "volume": 0.15, "loop": True},
                "music_volume": 0.5,
                "sounds": [{"path": sound, "start": 1.2, "volume": 0.5}],
                "labels": [{
                    "text": "PASABA POR", "start": 0.5, "end": 1.0,
                    "full_screen": True, "background_color": "#E84588",
                }],
                "sfx_volume": 0.5,
                "width": 360,
                "height": 640,
                "framing": "fill",
            },
            destination,
            toolchain=self.tools,
        )
        self.assertEqual(result.read_bytes(), b"timeline")
        command = [str(value) for value in run.call_args.args[0]]
        self.assertLess(command.index(str(self.source.resolve())), command.index(str(second.resolve())))
        graph = command[command.index("-filter_complex") + 1]
        self.assertIn("xfade=transition=wipeleft:duration=0.4", graph)
        self.assertIn("force_original_aspect_ratio=increase", graph)
        self.assertIn("crop=360:640:(iw-ow)/2:(ih-oh)/2", graph)
        self.assertIn("acrossfade=d=0.4", graph)
        self.assertIn("loudnorm=I=-16:LRA=11:TP=-1.5", graph)
        self.assertIn("volume=0.5[a0]", graph)
        self.assertIn("fontcolor=0xFFEEAA:fontsize=34", graph)
        self.assertIn("boxcolor=0x111111DD", graph)
        self.assertIn("y=h*0.08", graph)
        self.assertIn("volume=0.075", graph)
        self.assertIn("volume=0.25", graph)
        self.assertIn("enable='between(t,0.2,1.8)'", graph)
        self.assertIn("drawbox=x=0:y=0:w=iw:h=ih:color=0xE84588:t=fill", graph)
        self.assertIn("text='PASABA POR'", graph)
        self.assertIn("amix=inputs=3", graph)
        self.assertIn("alimiter=limit=0.95", graph)

    @mock.patch("kiko_studio.video_engine.analyze_media")
    @mock.patch("kiko_studio.video_engine._run")
    def test_keyword_highlight_colors_the_last_subtitle_word(
        self, run: mock.Mock, analyze: mock.Mock
    ) -> None:
        analyze.return_value = MediaInfo(self.source, 3, 640, 360, True)

        def produce(command: list[str]) -> subprocess.CompletedProcess[str]:
            Path(command[-1]).write_bytes(b"highlighted")
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = produce
        compose_timeline(
            {
                "clips": [{"path": self.source}],
                "subtitles": [{"text": "plantilla de prompt", "start": 0.2, "end": 1.8}],
                "subtitle_style": {
                    "template": "minimal",
                    "font_size": 66,
                    "text_color": "#FFFFFF",
                    "position": "bottom",
                    "highlight_keywords": True,
                    "highlight_color": "#FFE66D",
                },
                "width": 360,
                "height": 640,
            },
            self.root / "highlighted.mp4",
            toolchain=self.tools,
        )
        command = [str(value) for value in run.call_args.args[0]]
        graph = command[command.index("-filter_complex") + 1]
        self.assertIn("text='plantilla de'", graph)
        self.assertIn("fontcolor=0xFFFFFF:fontsize=66", graph)
        self.assertIn("text='prompt'", graph)
        self.assertIn("fontcolor=0xFFE66D:fontsize=66", graph)

    @mock.patch("kiko_studio.video_engine.analyze_media")
    @mock.patch("kiko_studio.native_video.compose_timeline")
    def test_native_timeline_falls_back_to_hard_cuts(
        self, native_compose: mock.Mock, analyze: mock.Mock
    ) -> None:
        second = self.root / "Second.mp4"
        image = self.root / "overlay.png"
        second.write_bytes(b"clip2")
        image.write_bytes(b"png")
        analyze.side_effect = lambda path, **_: MediaInfo(Path(path), 2, 360, 640, False)
        destination = self.root / "native-timeline.mp4"

        def produce(plan: dict[str, object], output: Path) -> None:
            self.assertEqual(plan["transition_duration"], 0.0)
            self.assertEqual(plan["transition"], {"type": "cut", "duration": 0.0})
            self.assertEqual(plan["duration"], 4.0)
            self.assertEqual(plan["subtitle_style"]["template"], "kiko")
            self.assertEqual(plan["framing"], "fill")
            self.assertEqual(plan["labels"][0]["text"], "IDEA CLAVE")
            self.assertEqual(Path(plan["images"][0]["path"]), image.resolve())
            output.write_bytes(b"native timeline")

        native_compose.side_effect = produce
        compose_timeline(
            {
                "clips": [{"path": self.source}, {"path": second}],
                "transition_duration": 0.25,
                "framing": "fill",
                "labels": [{"text": "IDEA CLAVE", "start": 0.1, "end": 0.8}],
                "images": [{"path": image, "start": 0.2, "end": 0.9}],
            },
            destination,
            toolchain=Toolchain(None, None, native=True),
        )
        self.assertEqual(destination.read_bytes(), b"native timeline")

    @mock.patch("kiko_studio.video_engine.shutil.which")
    def test_tool_detection_reports_each_binary(self, which: mock.Mock) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}" if name == "ffmpeg" else None
        tools = detect_toolchain()
        self.assertEqual(tools.ffmpeg, Path("/usr/bin/ffmpeg"))
        self.assertIsNone(tools.ffprobe)
        self.assertEqual(tools.missing, ("ffprobe",))

    def test_backend_reports_transition_degradation(self) -> None:
        self.assertIn("dissolve", VideoEngine(self.tools).supported_transitions)
        self.assertEqual(VideoEngine(Toolchain(None, None, native=True)).supported_transitions, ("cut",))
        self.assertTrue(VideoEngine(Toolchain(None, None, native=True)).capabilities["framing_fill"])

    def test_native_hex_color_parser_accepts_hash_and_alpha(self) -> None:
        self.assertEqual(native_video.normalize_hex_color("#FFE66D"), "FFE66D")
        self.assertEqual(native_video.normalize_hex_color("0x25104BDD"), "25104BDD")
        self.assertEqual(native_video.normalize_hex_color("0Xabcdef"), "ABCDEF")
        with self.assertRaises(native_video.NativeVideoError):
            native_video.normalize_hex_color("yellow")

    @mock.patch("kiko_studio.native_video._run")
    def test_native_timeline_serializes_colors_without_prefix(self, run: mock.Mock) -> None:
        captured: dict[str, object] = {}

        def inspect(command: str, descriptor: Path, destination: Path) -> dict[str, bool]:
            captured.update(__import__("json").loads(descriptor.read_text(encoding="utf-8")))
            return {"ok": True}

        run.side_effect = inspect
        native_video.compose_timeline(
            {
                "clips": [],
                "subtitle_style": {
                    "text_color": "#FFE66D",
                    "background_color": "0x25104BDD",
                },
            },
            self.root / "colors.mp4",
        )
        style = captured["subtitle_style"]
        self.assertEqual(style["text_color"], "FFE66D")
        self.assertEqual(style["background_color"], "25104BDD")

    @mock.patch("kiko_studio.video_engine.analyze_media")
    def test_timeline_rejects_unknown_framing(self, analyze: mock.Mock) -> None:
        analyze.return_value = MediaInfo(self.source, 2, 640, 360, False)
        with self.assertRaisesRegex(VideoEngineError, "framing.*fit.*fill"):
            compose_timeline(
                {"clips": [{"path": self.source}], "framing": "stretch"},
                self.root / "bad.mp4",
                toolchain=self.tools,
            )


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe not installed")
class VideoEngineIntegrationTests(unittest.TestCase):
    def test_generate_analyze_and_export_playable_video(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = generate_synthetic_test_video(root / "source.mp4", duration=0.5)
            info = analyze_media(source)
            self.assertGreater(info.duration, 0)
            self.assertEqual(info.resolution, (360, 640))
            self.assertTrue(info.has_audio)
            exported = export_vertical(source, root / "vertical.mp4", width=360, height=640)
            final_info = analyze_media(exported)
            self.assertEqual(final_info.resolution, (360, 640))
            self.assertGreater(final_info.duration, 0)


@unittest.skipUnless(os.environ.get("KIKO_RUN_NATIVE_MEDIA_TESTS") == "1", "native media test is opt-in")
class NativeTimelineIntegrationTests(unittest.TestCase):
    def test_two_real_synthetic_clips_become_one_timeline(self) -> None:
        tools = Toolchain(None, None, native=True)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first = generate_synthetic_test_video(root / "first.mp4", duration=0.6, width=320, height=180, toolchain=tools)
            second = generate_synthetic_test_video(root / "second.mp4", duration=0.7, width=320, height=180, toolchain=tools)
            music = root / "music.aiff"
            subprocess.run(["/usr/bin/say", "-o", str(music), "Kiko"], check=True)
            output = compose_timeline(
                {
                    "clips": [{"path": first, "start": 0.1}, {"path": second, "end": 0.5}],
                    "transition": {"type": "dissolve", "duration": 0.2},
                    "subtitles": [{"text": "Kiko", "start": 0.1, "end": 0.6}],
                    "subtitle_style": {
                        "template": "caption",
                        "font_size": 24,
                        "text_color": "#FFF1AA",
                        "background_color": "#25104BDD",
                        "position": "top",
                    },
                    "dialogue_volume": 0.8,
                    "music": {"path": music, "volume": 0.12, "loop": True},
                    "sounds": [{"path": music, "start": 0.25, "volume": 0.2}],
                    "width": 180,
                    "height": 320,
                    "framing": "fill",
                },
                root / "batch.mp4",
                toolchain=tools,
            )
            info = analyze_media(output, toolchain=tools)
            self.assertEqual(info.resolution, (180, 320))
            self.assertAlmostEqual(info.duration, 1.0, delta=0.15)
            self.assertTrue(info.has_audio)


if __name__ == "__main__":
    unittest.main()
