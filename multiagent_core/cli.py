from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import AICostController, AIRouter, Coordinator, DryRunProvider, SQLiteStore, Task, TaskQueue


def main() -> None:
    parser = argparse.ArgumentParser(description="MultiAgent Core local")
    parser.add_argument("--db", default="data/multiagent.sqlite3")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    enqueue = sub.add_parser("enqueue")
    enqueue.add_argument("kind")
    enqueue.add_argument("--payload", default="{}", help="JSON object")
    sub.add_parser("run-once")
    args = parser.parse_args()
    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    store = SQLiteStore(args.db)
    try:
        queue = TaskQueue(store)
        if args.command == "status":
            print(json.dumps([{"id": t.id, "kind": t.kind, "status": t.status.value} for t in store.list_tasks()], indent=2))
        elif args.command == "enqueue":
            payload = json.loads(args.payload)
            if not isinstance(payload, dict):
                raise SystemExit("--payload debe ser un objeto JSON")
            task = queue.enqueue(Task(args.kind, payload=payload))
            print(task.id)
        elif args.command == "run-once":
            cost = AICostController(store, daily_budget_usd=0, monthly_budget_usd=0, per_request_budget_usd=0)
            coordinator = Coordinator(queue, AIRouter([DryRunProvider()], cost_controller=cost))
            result = coordinator.run_once()
            print(json.dumps(None if result is None else {"id": result.id, "status": result.status.value, "result": result.result}, indent=2))
    finally:
        store.close()


if __name__ == "__main__":
    main()

