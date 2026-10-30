import json
import os
import struct
import sys
import tempfile
import time
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

from multiagent_core import SQLiteStore
from kiko_studio import image_generator
from kiko_studio.image_generator import ImageGenerator, nombre_de_archivo


def png(ruta: Path, ancho: int, alto: int) -> None:
    """PNG válido con ruido (pesa como una foto), sin depender de librerías de imagen."""
    def bloque(tipo: bytes, datos: bytes) -> bytes:
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))
    filas = b"".join(b"\x00" + os.urandom(3 * ancho) for _ in range(alto))
    ruta.write_bytes(b"\x89PNG\r\n\x1a\n" + bloque(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
                     + bloque(b"IDAT", zlib.compress(filas)) + bloque(b"IEND", b""))


# Codex falso: guarda la imagen en la carpeta de -C; falla si la descripción lo pide.
CODEX_FALSO = """#!{python}
import sys, shutil
args = sys.argv[1:]
prompt = args[-1]
if "falla" in prompt:
    sys.exit("error: el generador no respondió")
carpeta = args[args.index("-C") + 1]
shutil.copy("{muestra}" if "diminuta" not in prompt else "{diminuta}", carpeta + "/imagen.png")
print(carpeta + "/imagen.png")
"""
# Antigravity falso: responde enseguida y deja la imagen en la carpeta de su conversación.
AGY_FALSO = """#!{python}
import json, os, shutil, sys
conversacion = "conv-" + str(os.getpid())
carpeta = os.path.join(os.environ["KIKO_PRUEBA_BRAIN"], conversacion)
os.makedirs(carpeta, exist_ok=True)
shutil.copy("{muestra}", os.path.join(carpeta, "biblia_1.png"))
print(json.dumps({{"conversation_id": conversacion, "status": "SUCCESS", "response": "listo"}}))
"""


class ImageGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        base = Path(self.temporal.name)
        png(base / "muestra.png", 768, 512)
        png(base / "diminuta.png", 120, 80)
        rutas = {}
        for nombre, plantilla in (("codex", CODEX_FALSO), ("agy", AGY_FALSO)):
            ruta = base / nombre
            ruta.write_text(plantilla.format(python=sys.executable, muestra=base / "muestra.png",
                                             diminuta=base / "diminuta.png"))
            ruta.chmod(0o755)
            rutas[nombre] = ruta
        brain = base / "brain"
        self.parches = [
            patch.object(image_generator, "CODEX", rutas["codex"]),
            patch.object(image_generator, "CODEX_IMAGENES", base / "codex_generadas"),
            patch.object(image_generator, "ANTIGRAVITY_BRAIN", brain),
            patch.object(image_generator, "ESPERA_ANTIGRAVITY", 3),
            patch.dict(os.environ, {"KIKO_PRUEBA_BRAIN": str(brain)}),
        ]
        for parche in self.parches:
            parche.start()
        self.store = SQLiteStore(base / "kiko.sqlite3")
        self.recursos = []
        self.importados = []

        def importar(project_id, kind, nombre, temporal, licencia):
            self.importados.append((project_id, kind, nombre, Path(temporal).read_bytes()[:4], licencia))
            recurso = {"id": f"a{len(self.importados)}", "kind": kind, "name": nombre, "license": licencia}
            self.recursos.append(recurso)
            return recurso

        self.generador = ImageGenerator(self.store, base / "data", ejecutables=lambda: {"gemini": str(rutas["agy"])},
                                        importar=importar, recursos=lambda project_id: self.recursos)

    def tearDown(self):
        for parche in self.parches:
            parche.stop()
        self.store.close()
        self.temporal.cleanup()

    def esperar(self, image_id):
        for _ in range(300):
            fila = self.generador._obtener(image_id)
            if fila["status"] != "generating":
                return fila
            time.sleep(0.02)
        self.fail("la imagen no terminó de generarse")

    def generar(self, **opciones):
        datos = {"descripcion": "Biblia antigua abierta con luz de vela", "nombre": "Biblia Antigua.png", "estilo": "foto"}
        return self.generador.generar("p1", **{**datos, **opciones})

    def test_genera_con_codex_y_se_guarda_solo_al_aprobar(self):
        creada, = self.generar(proveedor="auto")
        self.assertEqual((creada["status"], creada["provider"], creada["nombre"]), ("generating", "codex", "biblia-antigua"))
        fila = self.esperar(creada["id"])
        self.assertEqual((fila["status"], fila["width"], fila["height"]), ("ready", 768, 512))
        self.assertEqual(self.importados, [])  # todavía es una propuesta
        recurso = self.generador.guardar(creada["id"])
        self.assertEqual(recurso["name"], "biblia-antigua.png")
        _, tipo, _, cabecera, licencia = self.importados[0]
        self.assertEqual((tipo, cabecera), ("image", b"\x89PNG"))
        self.assertIn("ChatGPT", licencia)
        self.assertEqual(self.generador.listar("p1"), [])  # guardada: sale de las propuestas

    def test_gemini_deja_la_imagen_en_su_conversacion(self):
        creada, = self.generar(proveedor="gemini")
        fila = self.esperar(creada["id"])
        self.assertEqual((fila["status"], fila["provider"]), ("ready", "gemini"))
        ruta, _ = self.generador.media(creada["id"])
        self.assertTrue(ruta.is_file())

    def test_si_codex_falla_auto_lo_intenta_con_gemini(self):
        creada, = self.generar(proveedor="auto", descripcion="una imagen que falla en codex")
        fila = self.esperar(creada["id"])
        self.assertEqual((fila["status"], fila["provider"]), ("ready", "gemini"))

    def test_las_dos_dan_dos_versiones_para_elegir(self):
        creadas = self.generar(proveedor="ambas")
        self.assertEqual(sorted(c["provider"] for c in creadas), ["codex", "gemini"])
        self.assertTrue(all(self.esperar(c["id"])["status"] == "ready" for c in creadas))

    def test_rechaza_imagenes_diminutas_y_errores_llegan_al_panel(self):
        diminuta, = self.generar(proveedor="codex", descripcion="una imagen diminuta de prueba")
        self.assertIn("muy pequeña", self.esperar(diminuta["id"])["error"])
        fallida, = self.generar(proveedor="codex", descripcion="esta falla siempre")
        fila = self.esperar(fallida["id"])
        self.assertEqual(fila["status"], "failed")
        self.assertIn("ChatGPT no generó la imagen", fila["error"])

    def test_nombres_repetidos_y_descartar(self):
        self.recursos.append({"id": "x", "kind": "image", "name": "Biblia_Antigua.jpg"})
        creada, = self.generar(proveedor="codex")
        self.esperar(creada["id"])
        with self.assertRaisesRegex(ValueError, "Ya hay un recurso"):
            self.generador.guardar(creada["id"])
        self.assertEqual(self.generador.guardar(creada["id"], "biblia-de-mesa")["name"], "biblia-de-mesa.png")
        otra, = self.generador.otra_version(creada["id"])
        self.esperar(otra["id"])
        ruta, _ = self.generador.media(otra["id"])
        self.generador.descartar(otra["id"])
        self.assertFalse(ruta.exists())
        with self.assertRaises(ValueError):
            self.generador.media(otra["id"])

    def test_valida_lo_que_pide_el_panel(self):
        with self.assertRaises(ValueError):
            self.generar(descripcion="x")
        with self.assertRaises(ValueError):
            self.generar(estilo="neón")
        with self.assertRaises(ValueError):
            self.generar(proveedor="claude")
        self.assertEqual(nombre_de_archivo("  Ñandú en Perú.PNG "), "nandu-en-peru")


if __name__ == "__main__":
    unittest.main()
