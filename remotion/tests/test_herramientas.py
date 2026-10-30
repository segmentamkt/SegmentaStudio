"""Pruebas de las herramientas que usan las skills desde su chat: cada cambio se aplica con `editar` y el plan
se recalcula como con cualquier revisión."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import editor  # noqa: E402
import montaje  # noqa: E402
from planificador import candidatos_locales, construir_plan  # noqa: E402
from test_planificador import palabras_de  # noqa: E402

TEXTO = ("Hola a todos, soy Kikoorator. Hoy abrimos la Biblia en Mateo 25. El siervo enterró su talento por miedo. "
         "Dios quiere que multipliques lo que te dio. Viajé a Japón y volví distinto.")


class HerramientasTests(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        self.base = Path(self.temporal.name)
        palabras = palabras_de(TEXTO)
        plan = construir_plan(palabras, candidatos_locales(palabras), {"tipo": "voz_guia", "original": None, "inicio_clip": 0.0},
                              ia={"estado": "desactivada"}, correcciones=[], descartes_ia=[])
        plan["palabras_fuente"] = [dict(p) for p in plan["palabras"]]
        plan["montaje"] = {"segmentos": [[0, len(palabras) - 1]], "eleccion": "original"}
        self.ruta = self.base / "kiko-prueba" / "plan_edicion.json"
        self.ruta.parent.mkdir()
        self.ruta.write_text(json.dumps(plan, ensure_ascii=False))
        editor._rehacer(self.ruta, copiar=False)
        self.original = self.plan()

    def tearDown(self):
        self.temporal.cleanup()

    def plan(self) -> dict:
        return json.loads(self.ruta.read_text(encoding="utf-8"))

    def editar(self, cambios: dict) -> dict:
        archivo = self.base / "cambios.json"
        archivo.write_text(json.dumps(cambios, ensure_ascii=False))
        editor.editar(argparse.Namespace(plan=self.ruta, cambios=archivo, sin_descargas=True))
        return self.plan()

    def nuevos(self, plan: dict) -> list[dict]:
        return [e for e in plan["eventos"] if e["fuente"] == "usuario"]

    def test_agregar_graficos_y_sonidos_en_una_frase(self):
        plan = self.editar({"agregar_eventos": [
            {"componente": "icono", "frase": "la Biblia", "icono": "bible"},
            {"componente": "texto_cinetico", "frase": "Dios quiere", "texto": "Dios quiere"},
            {"componente": "sonido", "frase": "por miedo", "sonido": "impacto"},
        ]})
        nuevos = {e["componente"]: e for e in self.nuevos(plan)}
        self.assertEqual(nuevos["icono"]["params"]["icono"], "bible")
        self.assertIn("<svg", nuevos["icono"]["params"]["svg"])
        self.assertEqual(nuevos["texto_cinetico"]["params"]["texto"], "DIOS QUIERE")
        self.assertEqual(nuevos["sonido"]["sonidos"][0]["archivo"], "audio/sfx/impacto.wav")
        self.assertEqual(len({e["id"] for e in plan["eventos"]}), len(plan["eventos"]))

    def test_lo_que_no_existe_se_rechaza_con_un_mensaje_claro(self):
        casos = [
            ({"agregar_eventos": [{"componente": "icono", "frase": "la Biblia", "icono": "no-existe"}]}, "no existe en Tabler"),
            ({"agregar_eventos": [{"componente": "texto_cinetico", "frase": "algo que nunca dije"}]}, "No encuentro"),
            ({"agregar_eventos": [{"componente": "mapa_pais", "frase": "Japón", "pais": "Narnia"}]}, "No reconozco el país"),
            ({"agregar_eventos": [{"componente": "sonido", "frase": "Japón", "sonido": "trompeta"}]}, "No hay un sonido"),
            ({"quitar": ["inventado"]}, "No hay un gráfico"),
            ({"quitar_zoom": ["z9"]}, "No hay un acercamiento"),
        ]
        for cambios, mensaje in casos:
            with self.subTest(cambios=cambios), self.assertRaises(SystemExit) as error:
                self.editar(cambios)
            self.assertIn(mensaje, str(error.exception))
        self.assertEqual(self.plan()["eventos"], self.original["eventos"])  # nada a medias

    def test_mapa_por_nombre_cambiar_icono_y_quitar_sonido(self):
        plan = self.editar({"agregar_eventos": [{"componente": "icono", "frase": "talento", "icono": "coins"}]})
        icono = self.nuevos(plan)[0]
        mapa = next(e for e in plan["eventos"] if e["componente"] == "mapa_pais")
        plan = self.editar({"iconos": {icono["id"]: "pig-money"}, "sin_sonido": [mapa["id"]]})
        eventos = {e["id"]: e for e in plan["eventos"]}
        self.assertEqual(eventos[icono["id"]]["params"]["icono"], "pig-money")
        self.assertEqual(eventos[mapa["id"]]["sonidos"], [])
        self.assertEqual(eventos[mapa["id"]]["params"]["pais"], "JPN")
        with self.assertRaises(SystemExit):
            self.editar({"iconos": {mapa["id"]: "map"}})  # un mapa no es un ícono

    def test_quitar_y_recuperar_una_frase(self):
        plan = self.editar({"quitar_frases": ["El siervo enterró su talento por miedo."]})
        self.assertNotIn("enterró", " ".join(p["texto"] for p in plan["palabras"]))
        self.assertLess(plan["duracion"], self.original["duracion"])
        self.assertEqual(plan["montaje"]["eleccion"], "manual")
        with self.assertRaisesRegex(SystemExit, "ya está en el video"):
            self.editar({"recuperar_frases": ["Viajé a Japón"]})
        plan = self.editar({"recuperar_frases": ["enterró su talento"]})
        self.assertIn("enterró su talento", " ".join(p["texto"] for p in plan["palabras"]))
        plan = self.editar({"recuperar_frases": ["El siervo", "por miedo"]})
        self.assertEqual(plan["montaje"]["segmentos"], self.original["montaje"]["segmentos"])

    def test_agregar_rango_respeta_el_orden_del_montaje(self):
        palabras = palabras_de("uno dos tres cuatro cinco seis siete ocho")
        self.assertEqual(montaje.agregar_rango(palabras, [[0, 1], [5, 7]], 3, 3), [[0, 1], [3, 3], [5, 7]])
        self.assertEqual(montaje.agregar_rango(palabras, [[0, 1], [3, 7]], 2, 2), [[0, 7]])
        self.assertEqual(montaje.quitar_rango([[0, 7]], 2, 4), [[0, 1], [5, 7]])

    def test_acercamientos_pedidos_y_quitados(self):
        plan = self.editar({"zoom_frases": [{"frase": "multipliques lo que te dio", "intensidad": 12}],
                            "quitar_zoom": ["gancho"]})
        motivos = [z["motivo"] for z in plan["camara"]["zoom"]]
        self.assertIn("Acercamiento pedido en «multipliques lo que te dio»", motivos)
        self.assertFalse(any(m.startswith("Gancho") for m in motivos))
        pedido = next(z for z in plan["camara"]["zoom"] if z.get("id"))
        self.assertEqual(pedido["a"], 1.12)
        plan = self.editar({"quitar_zoom": [pedido["id"]]})
        self.assertFalse(any(z.get("id") for z in plan["camara"]["zoom"]))

    def test_corregir_una_palabra_cambia_lo_que_se_ve(self):
        plan = self.editar({"corregir": [{"dice": "Kikoorator", "correcta": "Kiko Orator"}]})
        self.assertIn("Kiko Orator.", [p["texto"] for p in plan["palabras"]])
        self.assertEqual(plan["correcciones"][-1]["de"], "Kikoorator.")
        with self.assertRaisesRegex(SystemExit, "No encuentro"):
            self.editar({"corregir": [{"dice": "Pedro", "correcta": "Pablo"}]})

    def test_poner_una_imagen_de_la_biblioteca(self):
        imagen = self.base / "sembrador.png"
        imagen.write_bytes(b"png")
        with patch.object(editor, "PUBLICO", self.base / "public"):
            plan = self.editar({"recursos_nuevos": [{"nombre": "sembrador.png", "tipo": "image", "ruta": str(imagen),
                                                     "licencia": "Generada con IA"}],
                                "agregar_eventos": [{"componente": "imagen", "frase": "multipliques", "recurso": "sembrador.png"}]})
        evento = self.nuevos(plan)[0]
        self.assertEqual(evento["params"]["recurso"], "sembrador.png")
        self.assertTrue((self.base / "public" / evento["params"]["archivo"]).is_file())


if __name__ == "__main__":
    unittest.main()
