import tempfile
import unittest
from pathlib import Path

from multiagent_core import AICostController, AIRouter, Coordinator, MockProvider, SQLiteStore, Task, TaskQueue, TaskStatus
from kiko_studio.native_video import generate_test_video, probe


class IntegrationTests(unittest.TestCase):
    def test_coordinator_routes_and_persists(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / "core.sqlite3"
            store = SQLiteStore(db)
            queue = TaskQueue(store)
            provider = MockProvider(lambda text: text.upper(), model="local-test")
            coordinator = Coordinator(queue, AIRouter([provider], cost_controller=AICostController(store, daily_budget_usd=0)))
            task = queue.enqueue(Task("ai.prompt", {"prompt": "kiko"}, metadata={"project_id": "project-a"}))
            result = coordinator.run_once()
            self.assertEqual(result.status, TaskStatus.SUCCEEDED)
            self.assertEqual(result.result["content"], "KIKO")
            store.close()
            reopened = SQLiteStore(db)
            self.assertEqual(reopened.get_task(task.id).result["content"], "KIKO")
            reopened.close()

    def test_real_mp4_is_playable(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.mp4"
            generated = generate_test_video(path, duration=0.5)
            verified = probe(path)
            self.assertEqual(generated["container"], "mp4")
            self.assertTrue(verified["playable"])
            self.assertGreater(verified["duration"], 0)


if __name__ == "__main__":
    unittest.main()

