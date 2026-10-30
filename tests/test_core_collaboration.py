import os
from pathlib import Path
import tempfile
import unittest

from multiagent_core import (
    AuthorizedAppProvider,
    ClaudeCLIProvider,
    CodexCLIProvider,
    GeminiCLIProvider,
    MultiAgentCollaborator,
    ProviderUnavailable,
    SQLiteStore,
    detect_cli_providers,
)


FAKE_CLI = """#!/usr/bin/env python3
import json
import os
import sys
import time

prompt = sys.stdin.read()
if not prompt and len(sys.argv) > 1:
    prompt = sys.argv[-1]
if os.environ.get("FAKE_SLEEP"):
    time.sleep(float(os.environ["FAKE_SLEEP"]))
if os.environ.get("FAKE_FAIL"):
    print("simulated auth failure", file=sys.stderr)
    raise SystemExit(7)
label = os.environ.get("FAKE_LABEL", "unknown")
if prompt.startswith("Review the independent"):
    text = "review:" + label
elif prompt.startswith("Produce the final"):
    text = "integrated:" + label
else:
    text = "proposal:" + label
print(json.dumps({"result": text}))
"""


class CollaborationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fake = self.root / "fake-ai"
        self.fake.write_text(FAKE_CLI)
        self.fake.chmod(0o700)
        self.store = SQLiteStore(self.root / "evidence.sqlite")

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def providers(self):
        return [
            CodexCLIProvider(executable=str(self.fake), environment={"FAKE_LABEL": "codex"}),
            ClaudeCLIProvider(executable=str(self.fake), environment={"FAKE_LABEL": "claude"}),
            GeminiCLIProvider(executable=str(self.fake), environment={"FAKE_LABEL": "gemini"}),
        ]

    def test_detection_does_not_execute_or_claim_authentication(self):
        detected = detect_cli_providers(executables={
            "codex": str(self.fake), "claude": str(self.fake), "gemini": str(self.fake),
        })
        self.assertEqual([item.name for item in detected], [
            "codex-cli", "claude-cli", "gemini-cli",
        ])
        for provider in detected:
            diagnostic = provider.diagnose()
            self.assertTrue(diagnostic.installed)
            self.assertIsNone(diagnostic.authenticated)
            self.assertFalse(diagnostic.executed)

    def test_authorized_app_requires_explicit_authorization(self):
        calls = []
        blocked = AuthorizedAppProvider(
            "connected-gemini", lambda prompt: calls.append(prompt) or "answer",
            authorized=False,
        )
        self.assertFalse(blocked.is_available())
        with self.assertRaisesRegex(ProviderUnavailable, "not authorized"):
            blocked.generate("private request")
        self.assertEqual(calls, [])
        allowed = AuthorizedAppProvider(
            "connected-gemini", lambda prompt: "answer:" + prompt,
            authorized=True,
        )
        result = allowed.generate("requested")
        self.assertEqual(result.content, "answer:requested")
        self.assertTrue(result.metadata["executed"])

    def test_cli_timeout_and_nonzero_exit_are_real_errors(self):
        timed = CodexCLIProvider(
            executable=str(self.fake), timeout_seconds=0.01,
            environment={"FAKE_SLEEP": "0.2"},
        )
        with self.assertRaisesRegex(ProviderUnavailable, "timed out"):
            timed.generate("work")
        failed = ClaudeCLIProvider(
            executable=str(self.fake), environment={"FAKE_FAIL": "1"},
        )
        with self.assertRaisesRegex(ProviderUnavailable, "exited 7"):
            failed.generate("work")

    def test_independent_review_integration_and_persistent_evidence(self):
        collaboration = MultiAgentCollaborator(self.providers(), self.store)
        result = collaboration.run("Design a durable local agent system")

        self.assertEqual(result.status, "completed")
        self.assertEqual(result.content, "integrated:codex")
        self.assertEqual(len(result.contributions), 3)
        self.assertTrue(all(item.succeeded for item in result.contributions))
        self.assertEqual(len(result.reviews), 3)
        self.assertTrue(all(item.succeeded for item in result.reviews))

        restored = self.store.get_collaboration_round(result.id)
        self.assertEqual(restored.status, "completed")
        self.assertEqual(restored.content, "integrated:codex")
        self.assertEqual(len(self.store.collaboration_attempts(result.id)), 7)
        phases = [item.phase for item in self.store.collaboration_attempts(result.id)]
        self.assertEqual(phases.count("independent"), 3)
        self.assertEqual(phases.count("review"), 3)
        self.assertEqual(phases.count("integration"), 1)

    def test_failed_provider_is_persisted_not_counted_as_success(self):
        providers = self.providers()
        providers[2] = GeminiCLIProvider(
            executable=str(self.fake), environment={"FAKE_FAIL": "1"},
        )
        result = MultiAgentCollaborator(providers, self.store).run("Solve this", min_contributors=2)
        self.assertEqual(result.status, "completed")
        failed = [item for item in result.contributions if not item.succeeded]
        self.assertEqual(len(failed), 1)
        self.assertIn("exited 7", failed[0].error)
        persisted = self.store.collaboration_attempts(result.id)
        evidence = [item for item in persisted if item.id == failed[0].id][0]
        self.assertEqual(evidence.status, "failed")
        self.assertIsNone(evidence.result)

    def test_insufficient_contributors_never_invents_integration(self):
        provider = GeminiCLIProvider(
            executable=str(self.fake), environment={"FAKE_FAIL": "1"},
        )
        result = MultiAgentCollaborator([provider], self.store).run("Solve", min_contributors=1)
        self.assertEqual(result.status, "insufficient_contributors")
        self.assertIsNone(result.integration)
        self.assertIsNone(result.content)


if __name__ == "__main__":
    unittest.main()
