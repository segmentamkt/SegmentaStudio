"""Chat de las skills: propuestas validadas y probadas en una copia del plan, aplicar y deshacer.

Usa el editor real (remotion/scripts/editor.py) sobre un plan de prueba y una IA simulada."""

from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from multiagent_core import SQLiteStore
from multiagent_core.providers import MockProvider
from kiko_studio import semantic_editor
from kiko_studio.semantic_editor import SemanticEditor
from kiko_studio.skill_chat import SkillChat
from kiko_studio.skills import SkillStore

REMOTION = Path(__file__).resolve().parents[1] / "remotion"
sys.path.insert(0, str(REMOTION / "scripts"))
sys.path.insert(0, str(REMOTION / "tests"))

from planificador import candidatos_locales, construir_plan  # noqa: E402
from test_planificador import palabras_de  # noqa: E402

TEXTO = "Hoy abrimos la Biblia en Mateo 25. El siervo enterró su talento por miedo. Dios quiere que multipliques lo que te dio."


class SkillChatTests(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        base = Path(self.temporal.name)
        trabajo = base / "remotion"
        self.parche = patch.object(semantic_editor, "REMOTION", trabajo)
        self.parche.start()
        self.store = SQLiteStore(base / "kiko.sqlite3")
        self.skills = SkillStore(self.store, base / "data")
        self.semantic = SemanticEditor(self.store, base / "data", lambda *args: None)
        palabras = palabras_de(TEXTO)
        plan = construir_plan(palabras, candidatos_locales(palabras), {"tipo": "voz_guia", "original": None, "inicio_clip": 0.0},
                              ia={"estado": "desactivada"}, correcciones=[], descartes_ia=[])
        plan.update(palabras_fuente=[dict(p) for p in plan["palabras"]], skills=self.skills.para_motor()["skills"],
                    montaje={"segmentos": [[0, len(palabras) - 1]], "tramos": [], "eliminados": [], "eleccion": "original"})
        carpeta = trabajo / "trabajo" / "kiko-prueba"
        carpeta.mkdir(parents=True)
        (carpeta / "plan_edicion.json").write_text(json.dumps(plan, ensure_ascii=False))
        self.edit_id = "e1"
        with self.store.transaction(immediate=True) as con:
            con.execute("INSERT INTO semantic_edits(id,project_id,video_id,video_ids,name,workdir,status) VALUES(?,?,?,?,?,?,?)",
                        (self.edit_id, "p1", "v1", "[]", "toma.mov", "kiko-prueba", "planned"))
        self.respuestas = []
        self.ia = MockProvider(lambda prompt: self.respuestas.pop(0))
        self.chat = SkillChat(self.store, self.skills, self.semantic, imagenes=None, biblioteca=lambda proyecto: [],
                              proveedor=lambda preferido: self.ia)

    def tearDown(self):
        self.parche.stop()
        self.store.close()
        self.temporal.cleanup()

    def preguntar(self, skill: str, texto: str, respuesta: dict, edit: str | None = None) -> dict:
        self.respuestas.append(json.dumps(respuesta, ensure_ascii=False))
        edit = self.edit_id if edit is None else edit
        self.chat.enviar(skill, edit, texto)
        for _ in range(200):
            conversacion = self.chat.conversacion(skill, edit)
            if not conversacion["ocupada"]:
                return conversacion["items"][-1]
            time.sleep(0.05)
        self.fail("La skill no respondió")

    def eventos(self) -> dict:
        return {e["id"]: e for e in self.semantic.leer_plan(self.edit_id)["eventos"]}

    def test_propone_prueba_aplica_y_deshace(self):
        mensaje = self.preguntar("efectos", "Pon el ícono de la Biblia y un texto en «multipliques»", {
            "respuesta": "Te propongo dos gráficos.",
            "acciones": [{"herramienta": "agregar_grafico", "args": {"tipo": "icono", "frase": "la Biblia", "icono": "bible"}},
                         {"herramienta": "agregar_grafico", "args": {"tipo": "texto", "frase": "multipliques"}},
                         {"herramienta": "corregir_palabra", "args": {"dice": "Mateo", "correcta": "Mateo"}}]})
        self.assertEqual(mensaje["estado"], "lista")
        self.assertEqual([a["valida"] for a in mensaje["acciones"]], [True, True, False])
        self.assertIn("no tiene la herramienta", mensaje["acciones"][2]["error"])
        self.assertTrue(any("Ícono «bible»" in linea for linea in mensaje["detalle"]["resultado"]))
        self.assertIsNotNone(mensaje["detalle"]["inicio_vista"])
        prompt = self.ia.calls[0][0]
        for parte in ("Efectos visuales", "Mateo 25", "agregar_grafico", "Pon el ícono de la Biblia"):
            self.assertIn(parte, prompt)
        antes = set(self.eventos())  # nada se aplica solo
        conversacion = self.chat.aplicar(mensaje["id"])
        aplicada = conversacion["items"][-1]
        self.assertEqual(aplicada["estado"], "aplicada")
        self.assertTrue(aplicada["deshacible"])
        nuevos = [e for i, e in self.eventos().items() if i not in antes]
        self.assertEqual(sorted(e["componente"] for e in nuevos), ["icono", "texto_cinetico"])
        self.chat.deshacer(mensaje["id"])
        self.assertEqual(set(self.eventos()), antes)
        with self.assertRaisesRegex(ValueError, "no está aplicado"):
            self.chat.deshacer(mensaje["id"])

    def test_una_frase_que_no_existe_se_marca_al_probarla(self):
        mensaje = self.preguntar("recortes", "Corta lo del siervo", {
            "respuesta": "Listo.", "acciones": [{"herramienta": "quitar_frase", "args": {"frase": "El siervo enterró su talento por miedo."}},
                                                {"herramienta": "quitar_frase", "args": {"frase": "una frase inventada"}}]})
        self.assertEqual([a["valida"] for a in mensaje["acciones"]], [True, False])
        self.assertIn("No encuentro", mensaje["acciones"][1]["error"])
        self.assertTrue(any("El video pasa de" in linea for linea in mensaje["detalle"]["resultado"]))

    def test_ajustes_para_siempre_y_deshacer_sin_pisar_lo_posterior(self):
        mensaje = self.preguntar("filtros", "Ponle un look cálido a todo", {
            "respuesta": "Cálido para todos.", "acciones": [
                {"herramienta": "ajustar", "args": {"ajustes": {"preset": "calido", "intensidad": 70}, "alcance": "siempre"}}]})
        self.assertIn("Filtros", mensaje["acciones"][0]["descripcion"])
        self.chat.aplicar(mensaje["id"])
        self.assertEqual(self.skills.obtener("filtros")["ajustes"]["preset"], "calido")
        self.assertEqual(self.semantic.leer_plan(self.edit_id)["skills"]["filtros"]["ajustes"]["preset"], "calido")
        self.chat.deshacer(mensaje["id"])
        self.assertEqual(self.skills.obtener("filtros")["ajustes"]["preset"], "natural")
        self.assertFalse(self.skills.obtener("filtros")["personalizada"])

    def test_deshacer_respeta_el_orden(self):
        primero = self.preguntar("edicion", "Zoom en Dios quiere", {"respuesta": "Va.", "acciones": [
            {"herramienta": "zoom_en_frase", "args": {"frase": "Dios quiere", "intensidad": 12}}]})
        self.chat.aplicar(primero["id"])
        segundo = self.preguntar("edicion", "Quita el gancho", {"respuesta": "Va.", "acciones": [
            {"herramienta": "quitar_zoom", "args": {"cual": "gancho"}}]})
        conversacion = self.chat.aplicar(segundo["id"])
        estados = {m["id"]: m["deshacible"] for m in conversacion["items"] if m["rol"] == "skill"}
        self.assertEqual((estados[primero["id"]], estados[segundo["id"]]), (False, True))
        with self.assertRaisesRegex(ValueError, "deshaz primero"):
            self.chat.deshacer(primero["id"])
        self.chat.deshacer(segundo["id"])
        self.chat.deshacer(primero["id"])
        self.assertFalse(self.semantic.leer_plan(self.edit_id).get("zoom_frases"))

    def test_el_director_respeta_las_skills_bloqueadas_y_sin_video_solo_configura(self):
        self.skills.guardar("retoques", {"director_ajusta": False})
        mensaje = self.preguntar("director", "Sube el brillo", {"respuesta": "Subo el brillo.", "acciones": [
            {"herramienta": "ajustar", "args": {"skill": "retoques", "ajustes": {"brillo": 10}}}]})
        self.assertIn("no deja que el Director", mensaje["acciones"][0]["error"])
        sin_video = self.preguntar("efectos", "Quita el gráfico c0", {"respuesta": "Ok.", "acciones": [
            {"herramienta": "quitar_grafico", "args": {"id": "c0"}},
            {"herramienta": "ajustar", "args": {"ajustes": {"densidad": "baja"}}}]}, edit="")
        self.assertIn("elige un video", sin_video["acciones"][0]["error"])
        self.assertTrue(sin_video["acciones"][1]["valida"])
        self.assertIn("todos los videos", sin_video["acciones"][1]["descripcion"])

    def test_generar_y_poner_imagenes(self):
        pedidas = []
        self.chat.imagenes = type("Imagenes", (), {"generar": lambda _, proyecto, **datos: pedidas.append((proyecto, datos)) or [{"id": "img1"}]})()
        mensaje = self.preguntar("generador", "Haz una imagen del amo regresando", {"respuesta": "Te propongo generarla.", "acciones": [
            {"herramienta": "generar_imagen", "args": {"descripcion": "Un hombre regresa a casa al atardecer", "nombre": "amo-regresa"}},
            {"herramienta": "poner_imagen", "args": {"imagen": "no-existe.png", "frase": "Dios quiere"}}]})
        self.assertEqual([a["valida"] for a in mensaje["acciones"]], [True, False])
        self.assertIn("No encuentro la imagen", mensaje["acciones"][1]["error"])
        conversacion = self.chat.aplicar(mensaje["id"])
        self.assertEqual(pedidas, [("p1", {"descripcion": "Un hombre regresa a casa al atardecer", "nombre": "amo-regresa",
                                           "estilo": "foto", "proveedor": "auto"})])
        self.assertEqual(conversacion["items"][-1]["detalle"]["imagenes"], ["img1"])

    def test_sin_ia_o_con_texto_suelto(self):
        self.chat.proveedor = lambda preferido: None
        mensaje = self.preguntar("sonido", "¿Qué hiciste?", {})
        self.assertEqual(mensaje["estado"], "error")
        self.assertIn("No hay una IA conectada", mensaje["texto"])
        self.chat.proveedor = lambda preferido: self.ia
        self.respuestas[:] = ["Subí la música 2 dB porque la voz va rápida."]
        self.chat.enviar("sonido", self.edit_id, "¿Y la música?")
        for _ in range(100):
            if not self.chat.conversacion("sonido", self.edit_id)["ocupada"]:
                break
            time.sleep(0.05)
        ultimo = self.chat.conversacion("sonido", self.edit_id)["items"][-1]
        self.assertEqual((ultimo["estado"], ultimo["acciones"]), ("lista", []))
        self.assertIn("música", ultimo["texto"])


if __name__ == "__main__":
    unittest.main()
