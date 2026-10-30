"""Minimal MCP stdio server used by Kiko Studio integration checks."""

import json
import sys


for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        result = {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "kiko-test-mcp", "version": "1"},
        }
    elif message.get("method") == "tools/list":
        result = {
            "tools": [{
                "name": "eco_kiko",
                "description": "Herramienta inocua para verificar el hub MCP.",
                "inputSchema": {"type": "object", "properties": {}},
            }]
        }
    else:
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
