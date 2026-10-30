from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from multiagent_core import AICostController, AIRouter, Coordinator, MockProvider, SQLiteStore, Task, TaskQueue
from kiko_studio.native_video import generate_test_video, probe


def run_project(project_id: str, prompt: str) -> dict:
    project = ROOT / "data" / "projects" / project_id
    project.mkdir(parents=True, exist_ok=True)
    store = SQLiteStore(project / "multiagent.sqlite3")
    queue = TaskQueue(store)
    provider = MockProvider(lambda value: value.upper(), model="deterministic-local-validator")
    router = AIRouter([provider], cost_controller=AICostController(store, daily_budget_usd=0, monthly_budget_usd=0))
    coordinator = Coordinator(queue, router)
    task = queue.enqueue(Task("ai.prompt", {"prompt": prompt}, metadata={"project_id": project_id, "title": "Validación local"}))
    result = coordinator.run_once(f"worker-{project_id}")
    telemetry = AICostController(store).telemetry()
    evidence = {"project_id": project_id, "database": str(Path(store.path).resolve()), "task_id": task.id,
                "status": result.status.value, "result": result.result, "telemetry": telemetry}
    store.close()
    return evidence


def main() -> None:
    started = datetime.now(timezone.utc)
    kiko = run_project("kiko-validation", "idea kiko")
    second = run_project("cafe-aurora-ficticio", "plan cafe aurora")
    video = ROOT / "data" / "exports" / "kiko_studio_prueba.mp4"
    generated = generate_test_video(video, duration=2)
    verified = probe(video)
    digest = hashlib.sha256(video.read_bytes()).hexdigest()
    evidence = {
        "started_at_utc": started.isoformat(), "finished_at_utc": datetime.now(timezone.utc).isoformat(),
        "core_projects": [kiko, second], "physical_isolation": kiko["database"] != second["database"],
        "video": {"generated": generated, "verified": verified, "bytes": video.stat().st_size, "sha256": digest},
        "paid_api_calls": 0, "note": "mock is a deterministic test double, not an external model",
    }
    log = ROOT / "logs" / "validacion_integracion.json"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

