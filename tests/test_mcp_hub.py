import sys
import shlex
import tempfile
import unittest
from pathlib import Path

from kiko_studio.app import State
from kiko_studio.mcp_hub import probe_stdio, validate_connection
from kiko_studio.mcp_server import call_creative, call_media


FAKE_MCP = r'''import json, sys
for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        print(json.dumps({"jsonrpc":"2.0","id":message["id"],"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1"}}}), flush=True)
    elif message.get("method") == "tools/list":
        print(json.dumps({"jsonrpc":"2.0","id":message["id"],"result":{"tools":[{"name":"buscar_archivo","description":"Busca dentro del proyecto","inputSchema":{"type":"object"}}]}}), flush=True)
'''


class MCPHubTests(unittest.TestCase):
    def test_connection_is_tested_before_activation_and_shared(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            server = root / "fake_mcp.py"
            server.write_text(FAKE_MCP)
            state = State(root / "kiko.sqlite3")
            item = state.save_mcp_connection({
                "name": "Archivos seguros", "transport": "stdio",
                "command": sys.executable, "arguments": str(server),
                "agents": ["codex", "claude", "gemini"],
            })
            self.assertEqual(item["status"], "untested")
            with self.assertRaisesRegex(ValueError, "Prueba la conexión"):
                state.toggle_mcp_connection(item["id"], True)
            tested = state.test_mcp_connection(item["id"])
            self.assertEqual(tested["tools"][0]["name"], "buscar_archivo")
            state.toggle_mcp_connection(item["id"], True)
            self.assertEqual(
                state.shared_mcp_manifest("gemini")[0]["tools"][0]["name"],
                "buscar_archivo",
            )
            state.store.close()

    def test_http_urls_cannot_embed_credentials(self):
        with self.assertRaisesRegex(ValueError, "sin credenciales"):
            validate_connection({
                "name": "inseguro", "transport": "http",
                "url": "https://usuario:clave@example.com/mcp", "agents": ["codex"],
            })

    def test_bundled_media_and_creative_servers_expose_real_tools(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "kiko.sqlite3"
            state = State(database)
            state.create_project("MCP", "Validar herramientas locales")
            state.store.close()
            arguments = (
                f"-m kiko_studio.mcp_server --profile creative "
                f"--database {shlex.quote(str(database))}"
            )
            tools = probe_stdio(sys.executable, arguments)
            self.assertEqual(len(tools), 4)
            self.assertIn("kiko_recommend_style", {tool["name"] for tool in tools})
            summary = call_media(database, "kiko_storage_summary", {})
            self.assertGreaterEqual(summary["projects"], 1)
            recommendation = call_creative(
                "kiko_recommend_style", {"topic": "Una historia de marca nostálgica"}
            )
            self.assertEqual(recommendation["style_id"], "storytelling-marca-pop")


if __name__ == "__main__":
    unittest.main()
