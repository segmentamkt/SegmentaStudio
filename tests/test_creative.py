import tempfile
import unittest
from pathlib import Path

from kiko_studio.creative import CreativeStore, Trend, idea_from_trend


class CreativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = CreativeStore(Path(self.temp.name) / "creative.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_trend_and_idea_preserve_source(self):
        trend = Trend(
            title="IA aplicada a pequeñas empresas",
            url="https://example.com/reference",
            creator="Fuente oficial",
            platform="web",
            public_metrics={"views": 10},
            topic="automatización responsable",
        )
        self.store.add_trend("kiko", trend)
        self.assertEqual(self.store.list_trends("kiko")[0]["public_metrics"]["views"], 10)
        self.assertEqual(idea_from_trend(trend)["source_url"], trend.url)

    def test_unverified_source_is_rejected(self):
        with self.assertRaises(ValueError):
            Trend("x", "https://example.com", "x", "web", source="scraped").validate()

    def test_style_requires_confirmation_and_can_be_reverted(self):
        observation = self.store.record_style("kiko", "subtitle_color", "#ffffff")
        self.assertEqual(self.store.confirmed_style("kiko"), {})
        self.store.confirm_style(observation)
        self.assertEqual(self.store.confirmed_style("kiko"), {"subtitle_color": "#ffffff"})
        self.store.revert_style(observation)
        self.assertEqual(self.store.confirmed_style("kiko"), {})


if __name__ == "__main__":
    unittest.main()
