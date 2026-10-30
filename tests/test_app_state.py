import tempfile
import unittest
from pathlib import Path

from kiko_studio.app import CLOUD_DIRECTOR, EDITORIAL_STYLES, State, provider_executables, provider_status
from multiagent_core import MockProvider


class AppStateTests(unittest.TestCase):
    def test_edit_progress_reports_stage_and_clamps_percentage(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            queued = state.get_edit_progress("job-1")
            self.assertEqual(queued["status"], "queued")
            state.set_edit_progress("job-1", 120, "rendering", "Renderizando")
            progress = state.get_edit_progress("job-1")
            self.assertEqual(progress["percent"], 100)
            self.assertEqual(progress["stage"], "rendering")
            self.assertEqual(progress["message"], "Renderizando")
            state.store.close()

    def test_cloud_director_is_connected_and_blocks_incomplete_renders(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            self.assertEqual(state.dashboard()["cloud_director"], CLOUD_DIRECTOR)
            rejected = state._cloud_release_gate(
                {
                    "file_exists": True, "playable": True, "duration_seconds": 20,
                    "width": 1080, "height": 1920, "has_audio": True,
                    "caption_count": 0, "effect_count": 0,
                },
                {
                    "captions_required": True, "effects_required": True,
                    "portrait_required": True, "min_duration_seconds": .25,
                },
            )
            self.assertFalse(rejected["passed"])
            self.assertEqual(len(rejected["failures"]), 2)
            approved = state._cloud_release_gate(
                {
                    "file_exists": True, "playable": True, "duration_seconds": 20,
                    "width": 1080, "height": 1920, "has_audio": True,
                    "caption_count": 8, "effect_count": 2,
                },
                {
                    "captions_required": True, "effects_required": True,
                    "portrait_required": True, "min_duration_seconds": .25,
                },
            )
            self.assertTrue(approved["passed"])
            state.store.close()

    def test_trend_creative_package_and_reversible_style(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            project_id = state.dashboard()["projects"][0]["id"]
            result = state.add_trend({
                "project_id": project_id,
                "title": "Referencia autorizada",
                "url": "https://example.com/reference",
                "creator": "Kiko",
                "platform": "Instagram",
                "topic": "IA aplicada",
            })
            self.assertTrue(result["idea"]["hook"])
            self.assertEqual(len(result["idea"]["ideas"]), 3)
            style = state.apply_style({
                "project_id": project_id,
                "key": "subtitle_style",
                "value": "blanco sobre morado",
                "rationale": "preferencia confirmada",
            })
            self.assertEqual(style["preferences"]["subtitle_style"], "blanco sobre morado")
            restored = state.revert_style(style["correction_id"], project_id)
            self.assertEqual(restored["preferences"], {})
            state.store.close()

    def test_provider_panel_has_no_api_routes(self):
        names = {item["name"] for item in provider_status()}
        self.assertTrue({"Codex", "Claude", "Gemini"}.issubset(names))
        self.assertFalse(any("API" in name for name in names))

    def test_local_provider_bridges_are_resolved_without_api_keys(self):
        executables = provider_executables()
        self.assertIn("gemini", executables)
        self.assertTrue(executables["gemini"].endswith("/.tools/antigravity/agy"))

    def test_editorial_styles_are_selectable_and_validated(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            dashboard = state.dashboard()
            self.assertEqual(dashboard["editorial_styles"], EDITORIAL_STYLES)
            self.assertGreaterEqual(len(dashboard["editorial_styles"]), 5)
            self.assertTrue(all(style.get("preview", {}).get("layout") for style in dashboard["editorial_styles"]))
            self.assertTrue(all(style.get("preview", {}).get("caption") for style in dashboard["editorial_styles"]))
            settings = state._validate_edit_settings({"style_pack": "ia-demostrativa"})
            self.assertEqual(settings["style_pack"], "ia-demostrativa")
            intimate = next(
                style for style in dashboard["editorial_styles"]
                if style["id"] == "reflexion-intima"
            )
            self.assertEqual(intimate["settings"]["subtitle_position"], "center")
            self.assertEqual(intimate["settings"]["sfx_preset"], "none")
            cues = state._subtitle_cues(
                "Una idea humana que merece una pausa emocional", 8, max_words=3
            )
            self.assertTrue(all(len(cue.text.split()) <= 3 for cue in cues))
            demo = next(
                style for style in dashboard["editorial_styles"]
                if style["id"] == "demo-visual-dividida"
            )
            demo_settings = state._validate_edit_settings({
                "style_pack": demo["id"], **demo["settings"],
            })
            self.assertTrue(demo_settings["highlight_keywords"])
            self.assertEqual(demo_settings["overlay_width_percent"], 0.95)
            overlays = state._overlay_images(
                [Path("uno.png"), Path("dos.png")], 20, demo_settings
            )
            self.assertEqual(
                [(item["start"], item["end"]) for item in overlays],
                [(0.0, 10.0), (10.0, 20.0)],
            )
            self.assertTrue(all(item["position"] == "top" for item in overlays))
            branded = next(
                style for style in dashboard["editorial_styles"]
                if style["id"] == "storytelling-marca-pop"
            )
            branded_settings = state._validate_edit_settings({
                "style_pack": branded["id"], **branded["settings"],
            })
            cards = state._overlay_labels(["PASABA POR", "SIENDO"], 12, branded_settings)
            self.assertTrue(all(card["full_screen"] for card in cards))
            self.assertTrue(all(card["background_color"] == "#E84588" for card in cards))
            self.assertTrue(all(card["position"] == "center" for card in cards))
            with self.assertRaisesRegex(ValueError, "Estilo editorial"):
                state._validate_edit_settings({"style_pack": "copia-inexistente"})
            state.store.close()

    def test_project_archive_is_recoverable_and_keeps_records(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            project = state.create_project("Campana temporal", "Probar eliminación reversible")
            with state.store.transaction(immediate=True) as con:
                con.execute(
                    """INSERT INTO videos(id,project_id,original_name,imported_path,status,metadata)
                       VALUES(?,?,?,?,?,?)""",
                    ("video-guardado", project["id"], "toma.mov", "/tmp/toma.mov", "imported", "{}"),
                )
            archived = state.archive_project(project["id"])
            self.assertTrue(archived["recoverable"])
            self.assertNotIn(project["id"], {p["id"] for p in state.dashboard()["projects"]})
            trash = {p["id"]: p for p in state.dashboard()["archived_projects"]}
            self.assertEqual(trash[project["id"]]["video_count"], 1)
            state.restore_project(project["id"])
            self.assertIn(project["id"], {p["id"] for p in state.dashboard()["projects"]})
            with state.store.lock:
                kept = state.store.connection.execute(
                    "SELECT COUNT(*) count FROM videos WHERE project_id=?", (project["id"],)
                ).fetchone()["count"]
            self.assertEqual(kept, 1)
            state.store.close()

    def test_video_archive_is_recoverable_and_hidden_from_editor(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            project_id = state.dashboard()["projects"][0]["id"]
            with state.store.transaction(immediate=True) as con:
                con.execute(
                    """INSERT INTO videos(id,project_id,original_name,imported_path,status,metadata)
                       VALUES(?,?,?,?,?,?)""",
                    ("video-temporal", project_id, "borrable.mov", "/tmp/borrable.mov", "ready", "{}"),
                )
            archived = state.archive_video("video-temporal")
            self.assertTrue(archived["recoverable"])
            dashboard = state.dashboard()
            self.assertNotIn("video-temporal", {video["id"] for video in dashboard["videos"]})
            self.assertIn("video-temporal", {video["id"] for video in dashboard["archived_videos"]})
            state.restore_video("video-temporal")
            self.assertIn("video-temporal", {video["id"] for video in state.dashboard()["videos"]})
            state.store.close()

    def test_speech_windows_remove_internal_dead_time_and_builtin_sfx_exists(self):
        class Segment:
            def __init__(self, start, end, text):
                self.start, self.end, self.text = start, end, text

        segments = [Segment(.5, .8, "hola"), Segment(.9, 1.1, "mundo"), Segment(2.4, 2.8, "Kiko")]
        windows = State._speech_windows(segments, 0, 3, .65)
        self.assertEqual(len(windows), 2)
        self.assertGreaterEqual(windows[1][0] - windows[0][1], .99)
        sound = State._builtin_sound("soft")
        self.assertTrue(sound.is_file())
        self.assertGreater(sound.stat().st_size, 100)

    def test_timed_subtitles_split_phrase_segments_before_plan_validation(self):
        class Segment:
            def __init__(self, start, end, text):
                self.start, self.end, self.text = start, end, text

        cues = State._timed_subtitle_cues(
            [Segment(0, 2, "esta herramienta funciona automáticamente para editar videos profesionales")],
            window_start=0,
            window_end=2,
            timeline_start=0,
            max_words=4,
            max_characters=42,
            style="impact",
        )
        self.assertGreater(len(cues), 1)
        self.assertTrue(all(len(cue.text) <= 42 for cue in cues))
        self.assertTrue(all(len(cue.text.split()) <= 4 for cue in cues))

    def test_chat_persists_verified_multiagent_response(self):
        with tempfile.TemporaryDirectory() as folder:
            state = State(Path(folder) / "kiko.sqlite3")
            providers = [MockProvider("Plan integrado"), MockProvider("Revisión clara")]
            providers[0].name = "codex-cli"
            providers[1].name = "claude-cli"
            result = state.send_chat_message(
                {"message": "Quiero un reel breve y directo"}, providers=providers
            )
            self.assertEqual(result["message"]["content"], "Plan integrado")
            self.assertEqual(
                result["message"]["metadata"]["participants"], ["Codex", "Claude"]
            )
            history = state.chat_history()
            self.assertEqual([item["role"] for item in history], ["user", "assistant"])
            self.assertEqual(history[0]["content"], "Quiero un reel breve y directo")
            state.store.close()


if __name__ == "__main__":
    unittest.main()
