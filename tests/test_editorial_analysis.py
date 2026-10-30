import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from kiko_studio.editorial_analysis import (
    MediaMetadata,
    TranscriptionAvailability,
    TranscriptionUnavailableError,
    build_editorial_brief,
    detect_transcription_backends,
    generate_contact_sheet,
    inspect_media,
    transcribe_local,
)


def metadata(name, created, duration=10.0):
    return MediaMetadata(
        path="/clips/" + name,
        filename=name,
        size_bytes=100,
        modified_at=created,
        created_at=created,
        duration_seconds=duration,
        width=1080,
        height=1920,
        orientation="portrait",
        rotation_degrees=90,
        has_audio=True,
        video_codec="hvc1",
        audio_codec="aac ",
        nominal_fps=30.0,
        extraction_backend="avfoundation",
    )


class EditorialBriefTests(unittest.TestCase):
    def test_metadata_only_brief_never_claims_transcription(self):
        brief = build_editorial_brief(
            [
                metadata("IMG_8263.MOV", "2026-10-25T11:01:00+00:00", 8),
                metadata("IMG_8262.MOV", "2026-10-25T11:00:00+00:00", 5),
            ]
        )
        self.assertEqual([item["clip"] for item in brief.chronology], ["IMG_8262.MOV", "IMG_8263.MOV"])
        self.assertEqual(brief.source_basis, "metadata_only")
        self.assertEqual(brief.transcript_status, "not_attempted_no_supplied_text")
        self.assertTrue(all(item["text_source"] == "none" for item in brief.script))
        self.assertEqual(brief.chronology[1]["start"], 5.0)

    def test_supplied_text_is_labeled_and_preserved(self):
        brief = build_editorial_brief(
            [metadata("IMG_8262.MOV", "2026-10-25T11:00:00+00:00")],
            supplied_text="Este texto fue aportado por Kiko.",
            title="Libreto",
        )
        self.assertEqual(brief.title, "Libreto")
        self.assertEqual(brief.script[0]["text"], "Este texto fue aportado por Kiko.")
        self.assertEqual(brief.script[0]["text_source"], "supplied_text")
        self.assertIn("not_machine_transcription", brief.transcript_status)


class BackendTests(unittest.TestCase):
    @patch("kiko_studio.editorial_analysis._run_helper")
    @patch("kiko_studio.editorial_analysis.shutil.which")
    @patch("kiko_studio.editorial_analysis.Path.glob", return_value=[])
    def test_detection_is_honest_when_nothing_is_ready(self, glob, which, helper):
        which.return_value = None
        helper.return_value = {
            "authorization": "not_determined",
            "recognizer_available": True,
            "on_device": True,
        }
        states = {item.backend: item for item in detect_transcription_backends()}
        self.assertFalse(states["whisper_cli"].ready)
        self.assertFalse(states["macos_speech"].ready)
        self.assertEqual(states["macos_speech"].authorization, "not_determined")

    @patch("kiko_studio.editorial_analysis.detect_transcription_backends")
    def test_transcription_refuses_to_invent_when_unavailable(self, detect):
        detect.return_value = [
            TranscriptionAvailability("whisper_cli", False, False, True, "not_applicable", "missing"),
            TranscriptionAvailability("macos_speech", True, False, True, "denied", "denied"),
        ]
        with tempfile.NamedTemporaryFile(suffix=".mov") as video:
            with self.assertRaises(TranscriptionUnavailableError):
                transcribe_local(video.name)

    @patch("kiko_studio.editorial_analysis._run_helper")
    def test_metadata_mapping_from_avfoundation(self, helper):
        helper.return_value = {
            "duration": 12.25,
            "width": 1080,
            "height": 1920,
            "rotation": 90,
            "fps": 29.97,
            "has_audio": True,
            "video_codec": "hvc1",
            "audio_codec": "aac ",
        }
        with tempfile.NamedTemporaryFile(suffix=".mov") as video:
            result = inspect_media(video.name)
        self.assertEqual(result.duration_seconds, 12.25)
        self.assertEqual(result.orientation, "portrait")
        self.assertTrue(result.has_audio)
        self.assertEqual(result.extraction_backend, "avfoundation")

    @patch("kiko_studio.editorial_analysis._run_helper")
    def test_contact_sheet_requires_real_output(self, helper):
        helper.return_value = {
            "frame_count": 2,
            "timestamps": [1.0, 3.0],
            "width": 400,
            "height": 300,
        }
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mov"
            source.write_bytes(b"video")
            output = Path(directory) / "sheet.jpg"
            with self.assertRaisesRegex(Exception, "no generó"):
                generate_contact_sheet(source, output, columns=2, rows=1)

    @patch("kiko_studio.editorial_analysis.subprocess.run")
    @patch("kiko_studio.editorial_analysis._compile_analyzer_helper", return_value=Path("/tmp/analyzer"))
    @patch("kiko_studio.editorial_analysis.detect_transcription_backends")
    def test_speech_analyzer_keeps_word_timestamps(self, detect, compile_helper, run):
        detect.return_value = [
            TranscriptionAvailability("speech_analyzer", True, True, True, "not_required", "ready"),
        ]
        run.return_value = SimpleNamespace(returncode=0, stderr="", stdout=json.dumps({
            "locale": "es_CO",
            "text": "Estás en Brasil.",
            "segments": [{
                "start": 0.4, "end": 1.9, "text": "Estás en Brasil.",
                "words": [
                    {"start": 0.4, "end": 0.8, "text": "Estás"},
                    {"start": 0.85, "end": 1.0, "text": "en"},
                    {"start": 1.35, "end": 1.9, "text": "Brasil."},
                    {"start": 1.9, "end": 1.9, "text": " "},
                ],
            }],
        }))
        with tempfile.NamedTemporaryFile(suffix=".mov") as video:
            result = transcribe_local(video.name)
        words = result.segments[0].words
        self.assertEqual([word.text for word in words], ["Estás", "en", "Brasil."])
        self.assertEqual((words[2].start, words[2].end), (1.35, 1.9))
        self.assertEqual(asdict(result.segments[0])["words"][0], {"start": 0.4, "end": 0.8, "text": "Estás"})


if __name__ == "__main__":
    unittest.main()
