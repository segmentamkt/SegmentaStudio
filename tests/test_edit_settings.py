from pathlib import Path
import tempfile
import unittest

from multiagent_core import (
    EditClip,
    EditPlan,
    EditProject,
    EditRepository,
    EditSettings,
    MusicSettings,
    PacingFramingSettings,
    ProfessionalEditPlanner,
    SFXSettings,
    SQLiteStore,
    SoundCue,
    SubtitleCue,
    SubtitleSettings,
    TimelinePlacement,
    Transition,
    TransitionSettings,
)


class EditSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = SQLiteStore(Path(self.temp.name) / "settings.sqlite")
        self.repository = EditRepository(self.store)
        self.settings = EditSettings(
            subtitles=SubtitleSettings(
                language="es", style="brand-bold", max_characters_per_line=36,
                max_lines=2, position="bottom", burn_in=True,
            ),
            transitions=TransitionSettings(
                default_kind="crossfade", default_duration=0.25,
                allowed_kinds=("cut", "crossfade"),
            ),
            music=MusicSettings(enabled=True, asset="theme.wav", volume=0.2),
            sfx=SFXSettings(enabled=True, allowed_assets=("click.wav",), default_volume=0.8),
            pacing_framing=PacingFramingSettings(
                pacing="dynamic", target_shot_seconds=2.0,
                aspect_ratio="9:16", framing="center_crop", safe_area_percent=0.1,
            ),
        )
        project_id = "styled-project"
        self.project = EditProject(
            "Vertical promo",
            [
                EditClip(project_id, "one", "one.mp4", 3, id="one", script_order=0),
                EditClip(project_id, "two", "two.mp4", 2, id="two", script_order=1),
            ],
            id=project_id, settings=self.settings,
        )

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_project_and_plan_persist_full_settings_snapshot(self):
        plan = ProfessionalEditPlanner(self.repository).plan(self.project, collaborate=False)
        restored_project = self.repository.get_project(self.project.id)
        restored_plan = self.repository.get_plan(plan.id)
        self.assertEqual(restored_project.settings, self.settings)
        self.assertEqual(restored_plan.settings, self.settings)
        self.assertEqual(restored_plan.settings.pacing_framing.aspect_ratio, "9:16")
        self.assertEqual(restored_plan.settings.music.asset, "theme.wav")

    def test_settings_govern_cues_and_transitions(self):
        plan = EditPlan(
            self.project.id,
            [TimelinePlacement("one", 0, 0, 3), TimelinePlacement("two", 3, 0, 2)],
            settings=self.settings,
            subtitles=[SubtitleCue(0, 1, "Hola", language="es", style="brand-bold")],
            transitions=[Transition("one", "two", "crossfade", 0.25)],
            sounds=[
                SoundCue(0, "theme.wav", 5, 0.2, "music"),
                SoundCue(1, "click.wav", 0.2, 0.8, "effect"),
            ],
        )
        plan.validate(self.project)
        self.repository.save_project(self.project)
        self.repository.save_plan(plan)
        self.assertEqual(self.repository.get_plan(plan.id).sounds[0].asset, "theme.wav")

    def test_disabled_or_undeclared_style_elements_are_rejected(self):
        default_project = EditProject(
            "Plain", [EditClip("plain", "one", "one.mp4", 2, id="one")], id="plain"
        )
        subtitle_disabled = EditSettings(subtitles=SubtitleSettings(enabled=False))
        plan = EditPlan(
            default_project.id, [TimelinePlacement("one", 0, 0, 2)],
            settings=subtitle_disabled, subtitles=[SubtitleCue(0, 1, "invented")],
        )
        with self.assertRaisesRegex(ValueError, "enabled"):
            plan.validate(default_project)
        bad_sfx = EditPlan(
            self.project.id, [TimelinePlacement("one", 0, 0, 3)],
            settings=self.settings, sounds=[SoundCue(0, "unknown.wav", 1)],
        )
        with self.assertRaisesRegex(ValueError, "declared"):
            bad_sfx.validate(self.project)
        long_subtitle = EditPlan(
            self.project.id, [TimelinePlacement("one", 0, 0, 3)],
            settings=self.settings,
            subtitles=[SubtitleCue(0, 1, "x" * 37, language="es", style="brand-bold")],
        )
        with self.assertRaisesRegex(ValueError, "line limits"):
            long_subtitle.validate(self.project)

    def test_invalid_style_values_fail_early(self):
        with self.assertRaises(ValueError):
            SubtitleSettings(max_lines=True)
        with self.assertRaises(ValueError):
            MusicSettings(enabled=True)
        with self.assertRaises(ValueError):
            TransitionSettings(default_kind="cut", default_duration=0.5)
        with self.assertRaises(ValueError):
            PacingFramingSettings(aspect_ratio="vertical")


if __name__ == "__main__":
    unittest.main()
