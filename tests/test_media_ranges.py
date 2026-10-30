import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from kiko_studio.app import Handler, create_server


class MediaRangeTests(unittest.TestCase):
    """El <video> del panel solo puede adelantar si el servidor responde rangos de bytes (206)."""

    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        base = Path(self.temporal.name)
        self.contenido = bytes(range(256)) * 4
        self.video = base / "toma.mp4"
        self.video.write_bytes(self.contenido)
        self.server = create_server("127.0.0.1", 0, base / "kiko.sqlite3")
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/media/toma/output"
        self.parche = patch.object(Handler.state, "media_path", return_value=(self.video, "toma.mp4"))
        self.parche.start()

    def tearDown(self):
        self.parche.stop()
        self.server.shutdown()
        self.server.server_close()
        Handler.state.store.close()
        self.temporal.cleanup()

    def pedir(self, rango=None):
        return urlopen(Request(self.url, headers={"Range": rango} if rango else {}))

    def test_completo_anuncia_rangos(self):
        respuesta = self.pedir()
        self.assertEqual(respuesta.status, 200)
        self.assertEqual(respuesta.headers["Accept-Ranges"], "bytes")
        self.assertEqual(respuesta.read(), self.contenido)

    def test_rango_intermedio_y_final(self):
        respuesta = self.pedir("bytes=100-199")
        self.assertEqual(respuesta.status, 206)
        self.assertEqual(respuesta.headers["Content-Range"], "bytes 100-199/1024")
        self.assertEqual(respuesta.read(), self.contenido[100:200])
        self.assertEqual(self.pedir("bytes=-24").read(), self.contenido[-24:])
        self.assertEqual(self.pedir("bytes=1000-").read(), self.contenido[1000:])

    def test_rango_fuera_del_archivo(self):
        with self.assertRaises(HTTPError) as error:
            self.pedir("bytes=5000-")
        self.assertEqual(error.exception.code, 416)


if __name__ == "__main__":
    unittest.main()
