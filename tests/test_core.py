from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from multiagent_core import (
    AICostController,
    AIRouter,
    BudgetExceeded,
    DryRunProvider,
    LocalCommandProvider,
    MockProvider,
    OpenAIProvider,
    ProviderResult,
    ProviderExecution,
    ProviderUnavailable,
    SQLiteStore,
    Task,
    TaskQueue,
    TaskStatus,
    Usage,
)


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = SQLiteStore(Path(self.temp.name) / "core.sqlite")

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_queue_dependencies_priority_and_completion(self):
        queue = TaskQueue(self.store)
        first = queue.enqueue(Task("research", priority=1))
        dependent = queue.enqueue(Task("write", priority=100, dependencies=[first.id]))
        first_claim = queue.claim_next("w1")
        self.assertEqual(first_claim.id, first.id)
        queue.complete(
            first.id, {"ok": True}, worker_id="w1", lease_token=first_claim.lease_token
        )
        claimed = queue.claim_next("w2")
        self.assertEqual(claimed.id, dependent.id)
        self.assertEqual(claimed.attempts, 1)

    def test_retry_then_permanent_failure_and_blocked_dependency(self):
        queue = TaskQueue(self.store, retry_base_seconds=2)
        parent = queue.enqueue(Task("parent", max_attempts=2))
        child = queue.enqueue(Task("child", dependencies=[parent.id]))
        now = datetime.now(timezone.utc)
        first_claim = queue.claim_next("w", now=now)
        retry = queue.fail(
            parent.id, "temporary", worker_id="w", lease_token=first_claim.lease_token, now=now
        )
        self.assertEqual(retry.status, TaskStatus.RETRY_WAIT)
        self.assertEqual(retry.available_at, now + timedelta(seconds=2))
        second_claim = queue.claim_next("w", now=retry.available_at)
        failed = queue.fail(
            parent.id, "permanent", worker_id="w", lease_token=second_claim.lease_token,
            now=retry.available_at,
        )
        self.assertEqual(failed.status, TaskStatus.FAILED)
        self.assertIsNone(queue.claim_next("w", now=retry.available_at))
        self.assertEqual(self.store.get_task(child.id).status, TaskStatus.BLOCKED)

    def test_stale_lease_recovery(self):
        queue = TaskQueue(self.store)
        task = queue.enqueue(Task("work", max_attempts=2))
        now = datetime.now(timezone.utc)
        queue.claim_next("dead-worker", lease_seconds=1, now=now)
        self.assertEqual(queue.recover_stale(now=now + timedelta(minutes=5)), 1)
        recovered = self.store.get_task(task.id)
        self.assertEqual(recovered.status, TaskStatus.RETRY_WAIT)
        self.assertIsNone(recovered.worker_id)

    def test_stale_worker_cannot_complete_after_reclaim(self):
        queue = TaskQueue(self.store, retry_base_seconds=0)
        task = queue.enqueue(Task("work", max_attempts=3))
        now = datetime.now(timezone.utc)
        stale = queue.claim_next("worker", lease_seconds=1, now=now)
        queue.recover_stale(now=now + timedelta(seconds=2))
        current = queue.claim_next("worker", now=now + timedelta(seconds=2))

        with self.assertRaises(PermissionError):
            queue.complete(
                task.id, {"late": True}, worker_id="worker", lease_token=stale.lease_token
            )
        completed = queue.complete(
            task.id, {"ok": True}, worker_id="worker", lease_token=current.lease_token
        )
        self.assertEqual(completed.status, TaskStatus.SUCCEEDED)
        self.assertGreater(current.lease_token, stale.lease_token)

    def test_router_local_first_cache_and_telemetry(self):
        controller = AICostController(self.store)
        remote = MockProvider("remote")
        remote.requires_network = True
        remote.name = "remote"
        local = MockProvider(lambda text: text.upper())
        router = AIRouter([remote, local], cost_controller=controller)
        result = router.generate("hola")
        cached = router.generate("hola")
        self.assertEqual(result.content, "HOLA")
        self.assertTrue(cached.cached)
        self.assertEqual(len(local.calls), 1)
        self.assertEqual(len(controller.telemetry()), 1)

    def test_budget_enforcement(self):
        controller = AICostController(self.store, daily_budget_usd=0.5)
        controller.record(ProviderResult("x", "paid", "m", Usage(cost_usd=0.4)))
        with self.assertRaises(BudgetExceeded):
            controller.check_budget(0.2)

    def test_scoped_budgets_and_project_cache_isolation(self):
        controller = AICostController(self.store, project_budgets_usd={"p1": 0.5})
        controller.record(ProviderResult("x", "paid", "m", Usage(cost_usd=0.4)), {"project_id": "p1"})
        with self.assertRaises(BudgetExceeded):
            controller.check_budget(0.2, project_id="p1")
        provider = MockProvider("ok")
        router = AIRouter([provider], cost_controller=controller)
        router.generate("same", project_id="p1")
        router.generate("same", project_id="p2")
        self.assertEqual(len(provider.calls), 2)

    def test_providers_are_safe_and_replaceable(self):
        with patch.dict(os.environ, {}, clear=True):
            openai = OpenAIProvider()
            self.assertFalse(openai.is_available())
            with self.assertRaises(ProviderUnavailable):
                openai.generate("secret")
        with self.assertRaises(ValueError):
            LocalCommandProvider([sys.executable, "-c", "print('x')"])
        local = LocalCommandProvider(
            [sys.executable, "-c", "import sys; print(sys.stdin.read().upper())"],
            allowed_executables=[sys.executable],
        )
        self.assertEqual(local.generate("hello").content.strip(), "HELLO")
        self.assertEqual(DryRunProvider().generate("never sent").metadata["would_send"], "never sent")

    def test_provider_diagnostics_do_not_claim_execution(self):
        provider = LocalCommandProvider(
            [sys.executable, "-c", "print('x')"], allowed_executables=[sys.executable]
        )
        diagnostics = provider.diagnose()
        self.assertTrue(diagnostics.installed)
        self.assertIsNone(diagnostics.authenticated)
        self.assertFalse(diagnostics.executed)
        evidence = ProviderExecution(
            provider_id="python-local", capability="text", diagnostics=diagnostics
        ).as_dict()
        self.assertFalse(evidence["diagnostics"]["executed"])
        self.assertEqual(evidence["status_code"], "SKIPPED_PRECONDITION")


if __name__ == "__main__":
    unittest.main()
