from datetime import datetime, timezone
from pathlib import Path
import json
import tempfile
import unittest

from multiagent_core import (
    EditClip,
    EditPlan,
    EditPlanStatus,
    EditProject,
    EditProjectStatus,
    EditRepository,
    MockProvider,
    MultiAgentCollaborator,
    ProfessionalEditPlanner,
    SQLiteStore,
    SoundCue,
    SubtitleCue,
    TimelinePlacement,
    Transition,
)


class EditPlannerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = SQLiteStore(Path(self.temp.name) / "edit.sqlite")
        self.repository = EditRepository(self.store)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    @staticmethod
    def project():
        project_id = "project-1"
        clips = [
            EditClip(project_id, "Zulu", "z.mp4", 2, id="script-1", script_order=1),
            EditClip(project_id, "Alpha", "a.mp4", 3, id="script-0", script_order=0),
            EditClip(project_id, "Newer", "n.mp4", 1, id="newer",
                     recorded_at=datetime(2026, 1, 2, tzinfo=timezone.utc)),
            EditClip(project_id, "Older", "o.mp4", 1, id="older",
                     recorded_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
            EditClip(project_id, "beta", "b.mp4", 1, id="beta"),
            EditClip(project_id, "Alpha", "aa.mp4", 1, id="alpha"),
        ]
        return EditProject("Launch", clips, id=project_id, script="Intro, detail, close")

    def test_deterministic_fallback_is_explicit_and_reproducible(self):
        project = self.project()
        planner = ProfessionalEditPlanner(self.repository)
        first = planner.plan(project, collaborate=False)
        second = planner.plan(project, collaborate=False)
        expected = ["script-0", "script-1", "older", "newer", "alpha", "beta"]
        self.assertEqual([item.clip_id for item in first.placements], expected)
        self.assertEqual([item.clip_id for item in second.placements], expected)
        self.assertEqual(first.source, "deterministic_metadata_sort")
        self.assertFalse(first.evidence[0].data["semantic_understanding"])
        self.assertEqual(first.duration_seconds, 9)

    def test_models_reject_invalid_timeline_and_cues(self):
        project = self.project()
        overlap = EditPlan(project.id, [
            TimelinePlacement("script-0", 0, 0, 3),
            TimelinePlacement("script-1", 2, 0, 2),
        ])
        with self.assertRaisesRegex(ValueError, "overlap"):
            overlap.validate(project)
        too_late = EditPlan(
            project.id, [TimelinePlacement("script-0", 0, 0, 3)],
            subtitles=[SubtitleCue(2.5, 4, "late")],
        )
        with self.assertRaisesRegex(ValueError, "exceeds"):
            too_late.validate(project)
        bad_transition = EditPlan(project.id, [
            TimelinePlacement("script-0", 0, 0, 3),
            TimelinePlacement("script-1", 3, 0, 2),
            TimelinePlacement("older", 5, 0, 1),
        ], transitions=[Transition("script-0", "older")])
        with self.assertRaisesRegex(ValueError, "adjacent"):
            bad_transition.validate(project)
        invented_sound = EditPlan(
            project.id, [TimelinePlacement("script-0", 0, 0, 3)],
            sounds=[SoundCue(0, "not-declared.wav", 1)],
        )
        with self.assertRaisesRegex(ValueError, "declared"):
            invented_sound.validate(project)

    def test_repository_round_trip_and_strict_state_machine(self):
        project = self.project()
        plan = ProfessionalEditPlanner(self.repository).plan(project, collaborate=False)
        planning = self.repository.transition_project(
            project.id, EditProjectStatus.PLANNING, reason="planning started", actor="editor"
        )
        self.assertEqual(planning.status, EditProjectStatus.PLANNING)
        restored = self.repository.get_plan(plan.id)
        self.assertEqual([p.clip_id for p in restored.placements], [p.clip_id for p in plan.placements])
        proposed = self.repository.transition_plan(
            plan.id, EditPlanStatus.PROPOSED, reason="human requested review", actor="editor"
        )
        approved = self.repository.transition_plan(
            proposed.id, EditPlanStatus.APPROVED, reason="timeline checked", actor="editor"
        )
        self.assertEqual(approved.status, EditPlanStatus.APPROVED)
        self.assertGreaterEqual(len(self.repository.events(plan.id)), 3)
        with self.assertRaisesRegex(ValueError, "invalid plan transition"):
            self.repository.transition_plan(
                plan.id, EditPlanStatus.DRAFT, reason="rewind", actor="editor"
            )

    def test_multiagent_plan_is_parsed_and_validated(self):
        project = self.project()
        integrated = json.dumps({
            "clip_order": ["beta", "alpha", "older", "newer", "script-0", "script-1"],
            "subtitles": [], "transitions": [], "sounds": [],
        })

        def response(prompt):
            return integrated if prompt.startswith("Produce the final") else "independent evidence"

        providers = [MockProvider(response), MockProvider(response)]
        providers[0].name, providers[1].name = "codex-sim", "claude-sim"
        collaborator = MultiAgentCollaborator(providers, self.store)
        plan = ProfessionalEditPlanner(self.repository, collaborator).plan(project)
        self.assertEqual(plan.status, EditPlanStatus.PROPOSED)
        self.assertEqual(plan.source, "multiagent_validated_json")
        self.assertEqual(plan.placements[0].clip_id, "beta")
        self.assertIsNotNone(plan.collaboration_round_id)
        self.assertEqual(self.store.get_collaboration_round(plan.collaboration_round_id).status, "completed")

    def test_invalid_multiagent_output_falls_back_without_semantic_claim(self):
        project = self.project()

        def response(prompt):
            return '{"clip_order":["invented"]}' if prompt.startswith("Produce the final") else "proposal"

        providers = [MockProvider(response), MockProvider(response)]
        collaborator = MultiAgentCollaborator(providers, self.store)
        plan = ProfessionalEditPlanner(self.repository, collaborator).plan(project)
        self.assertEqual(plan.status, EditPlanStatus.DRAFT)
        self.assertEqual(plan.source, "deterministic_metadata_sort")
        self.assertTrue(any(item.category == "validation" for item in plan.evidence))
        self.assertFalse(plan.evidence[0].data["semantic_understanding"])

    def test_editorial_direction_is_shared_with_collaborating_agents(self):
        project = self.project()
        project.metadata["style_pack"] = "ia-demostrativa"
        project.metadata["style_direction"] = "Abre con el resultado y explica el proceso en pasos."
        prompt = ProfessionalEditPlanner._collaboration_prompt(project)
        self.assertIn('"style_pack": "ia-demostrativa"', prompt)
        self.assertIn("Abre con el resultado", prompt)


if __name__ == "__main__":
    unittest.main()
