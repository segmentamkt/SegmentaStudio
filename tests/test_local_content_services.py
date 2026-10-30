import tempfile
import unittest
from pathlib import Path

from kiko_studio.creative_service import CreativeService
from kiko_studio.style_learning import StyleLearningStore
from kiko_studio.trends import MetricEvidence, TrendRadar, TrendRecord


class TrendRadarTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "content.sqlite3"
        self.radar = TrendRadar(self.database)

    def tearDown(self):
        self.temp.cleanup()

    def test_manual_record_never_invents_metrics_and_persists(self):
        self.radar.register_manual(
            "kiko",
            title="IA para negocios",
            url="https://example.com/ia",
            creator="Fuente",
            platform="web",
            topic="IA aplicada",
        )
        record = TrendRadar(self.database).list_records("kiko")[0]
        self.assertEqual(record["public_metrics"], {})
        self.assertEqual(record["source_kind"], "manual")
        self.assertEqual(record["source_reference"], record["url"])

    def test_metric_requires_timestamp_and_evidence_url(self):
        valid = MetricEvidence(1200, "2026-10-25T00:00:00-05:00", "https://example.com/post")
        self.radar.register_manual(
            "kiko",
            title="Referencia",
            url="https://example.com/post",
            creator="Autor",
            platform="video",
            topic="marca",
            public_metrics={"views": valid},
        )
        self.assertEqual(
            self.radar.list_records("kiko")[0]["public_metrics"]["views"]["value"],
            1200,
        )
        with self.assertRaisesRegex(ValueError, "no se aceptan cifras sin evidencia"):
            self.radar.register_manual(
                "kiko",
                title="Inválida",
                url="https://example.com/invalid",
                creator="Autor",
                platform="video",
                topic="marca",
                public_metrics={"views": 999},
            )

    def test_authorized_import_is_atomic_and_project_scoped(self):
        records = [
            {
                "title": "A",
                "url": "https://example.com/a",
                "creator": "Autor",
                "platform": "YouTube",
                "topic": "ventas",
            },
            {
                "title": "B",
                "url": "not-a-url",
                "creator": "Autor",
                "platform": "YouTube",
                "topic": "ventas",
            },
        ]
        with self.assertRaises(ValueError):
            self.radar.import_records(
                "kiko",
                records,
                source_kind="official_export",
                source_reference="export-2026-10-25.json",
            )
        self.assertEqual(self.radar.list_records("kiko"), [])
        self.assertEqual(self.radar.list_records("otro"), [])


class CreativeServiceTests(unittest.TestCase):
    def test_generation_is_local_deterministic_and_preserves_source(self):
        trend = TrendRecord(
            title="Uso responsable de IA",
            url="https://example.com/source",
            creator="Fuente oficial",
            platform="web",
            topic="inteligencia artificial responsable",
            source_kind="manual",
            source_reference="https://example.com/source",
        )
        service = CreativeService()
        first = service.generate(trend)
        second = service.generate(trend)
        self.assertEqual(first, second)
        self.assertEqual(first.source_url, trend.url)
        self.assertEqual(first.generation_mode, "deterministic_local")
        self.assertEqual(len(first.ideas), 3)
        self.assertEqual(len(first.hooks), 3)
        self.assertIn("No mostrar cifras", first.recording_notes[-1])


class StyleLearningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "style.sqlite3"
        self.styles = StyleLearningStore(self.database)

    def tearDown(self):
        self.temp.cleanup()

    def test_observation_needs_confirmation_and_survives_reopen(self):
        identifiers = self.styles.record_comparison(
            "kiko",
            "original.mov",
            "editado.mp4",
            {"subtitle_color": "#FFFFFF", "cut_pace_seconds": 2.5},
            confidence=0.8,
        )
        self.assertEqual(self.styles.preferences("kiko"), {})
        self.styles.decide_observation(identifiers[0], confirm=True)
        reopened = StyleLearningStore(self.database)
        self.assertEqual(reopened.preferences("kiko"), {"subtitle_color": "#FFFFFF"})
        self.assertEqual(len(reopened.observations("kiko", "pending")), 1)

    def test_correction_is_reversible_without_losing_confirmed_value(self):
        observation = self.styles.record_observation(
            "kiko",
            "subtitle_color",
            "#FFFFFF",
            evidence={"edited_asset": "video-01.mp4"},
        )
        self.styles.decide_observation(observation, confirm=True)
        correction = self.styles.apply_correction(
            "kiko", "subtitle_color", "#7C3AED", rationale="Corrección confirmada por Kiko"
        )
        self.assertEqual(self.styles.preferences("kiko")["subtitle_color"], "#7C3AED")
        StyleLearningStore(self.database).revert_correction(correction)
        self.assertEqual(self.styles.preferences("kiko")["subtitle_color"], "#FFFFFF")

    def test_old_correction_cannot_overwrite_a_newer_one_on_revert(self):
        first = self.styles.apply_correction(
            "kiko", "zoom", "suave", rationale="Primera corrección"
        )
        self.styles.apply_correction(
            "kiko", "zoom", "ninguno", rationale="Segunda corrección"
        )
        with self.assertRaisesRegex(RuntimeError, "cambio posterior"):
            self.styles.revert_correction(first)

    def test_repeated_corrections_are_reported_but_not_auto_confirmed(self):
        self.styles.apply_correction(
            "kiko", "subtitle_position", "bottom", rationale="Video uno"
        )
        self.styles.apply_correction(
            "kiko", "subtitle_position", "top", rationale="Excepción"
        )
        self.styles.apply_correction(
            "kiko", "subtitle_position", "bottom", rationale="Video tres"
        )
        reopened = StyleLearningStore(self.database)
        self.assertEqual(
            reopened.correction_patterns("kiko"),
            [
                {
                    "key": "subtitle_position",
                    "value": "bottom",
                    "occurrences": 2,
                    "requires_confirmation": True,
                }
            ],
        )
        self.assertEqual(len(reopened.correction_history("kiko")), 3)


if __name__ == "__main__":
    unittest.main()
