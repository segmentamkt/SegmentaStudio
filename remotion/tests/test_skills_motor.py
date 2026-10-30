"""Pruebas de las skills en el motor: cada una cambia de verdad su parte del plan o del render."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))
sys.path.insert(0, str(RAIZ.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import director  # noqa: E402
import editor  # noqa: E402
import montaje  # noqa: E402
import skills as habilidades  # noqa: E402
from kiko_studio.skills import CATALOGO  # noqa: E402
from planificador import Candidato, candidatos_locales, construir_plan  # noqa: E402
from test_planificador import palabras_de  # noqa: E402


def skills_por_defecto(**cambios) -> dict:
    """Las 11 skills con sus valores de fábrica, como las entrega Kiko Studio; `cambios` = {id: {...}}."""
    base = {s["id"]: {"nombre": s["nombre"], "descripcion": s["descripcion"], "activa": True,
                      "instrucciones": s["instrucciones"], "ajustes": {p["clave"]: p["defecto"] for p in s["parametros"]},
                      "director_ajusta": True, "parametros": s["parametros"], "recursos": []} for s in CATALOGO}
    for skill_id, cambio in cambios.items():
        base[skill_id].update({k: v for k, v in cambio.items() if k != "ajustes"})
        base[skill_id]["ajustes"].update(cambio.get("ajustes", {}))
    return json.loads(json.dumps(base))


TEXTO = "Viajé a Japón en 2019 con 500 dólares y después a Brasil. Allí gané la copa."


class EfectosYRecortesTests(unittest.TestCase):
    def plan(self, skills: dict, extra: list | None = None) -> dict:
        palabras = palabras_de(TEXTO)
        candidatos = candidatos_locales(palabras) + (extra or [])
        return construir_plan(palabras, candidatos, {"tipo": "voz_guia"}, ia={}, correcciones=[], descartes_ia=[],
                              efectos=editor._efectos(skills))

    def test_sin_skills_todo_sigue_como_siempre(self):
        self.assertIn("mapa_pais", {e["componente"] for e in self.plan({})["eventos"]})

    def test_solo_los_graficos_permitidos_y_lo_del_libreto_siempre(self):
        skills = skills_por_defecto(efectos={"ajustes": {"componentes": ["texto_cinetico"]}})
        pedido = Candidato("icono", 0, 0, {"icono": "plane", "sin_etiqueta": True}, "Indicación del libreto", fuente="libreto")
        plan = self.plan(skills, [pedido])
        componentes = {e["componente"] for e in plan["eventos"]}
        self.assertNotIn("mapa_pais", componentes)
        self.assertIn("icono", componentes)  # el libreto manda
        self.assertTrue(any(editor.MOTIVO_SKILL in d["motivo"] for d in plan["descartados"]))
        apagada = self.plan(skills_por_defecto(efectos={"activa": False}))
        self.assertEqual([e for e in apagada["eventos"] if e["componente"] != "sonido"], [])

    def test_densidad_baja_limita_los_automaticos(self):
        todos = [e for e in self.plan(skills_por_defecto())["eventos"] if e["componente"] != "sonido"]
        pocos = [e for e in self.plan(skills_por_defecto(efectos={"ajustes": {"densidad": "baja"}}))["eventos"]
                 if e["componente"] != "sonido"]
        self.assertGreater(len(todos), 1)
        self.assertEqual(len(pocos), 1)  # 3 por minuto en un video de pocos segundos: uno

    def test_muletillas_y_recortes_apagados(self):
        palabras = palabras_de("Hola eh este es mmm el mensaje.")
        segmentos, quitadas = montaje.sin_muletillas(palabras, [[0, len(palabras) - 1]])
        self.assertEqual(quitadas, ["eh", "mmm"])
        self.assertEqual([[palabras[a].texto, palabras[b].texto] for a, b in segmentos],
                         [["Hola", "Hola"], ["este", "es"], ["el", "mensaje."]])
        alineacion = {"segmentos": [[0, 1]]}
        self.assertEqual(editor._segmentos(palabras, alineacion, skills_por_defecto())[0], [[0, 1]])
        completas, eleccion = editor._segmentos(palabras, alineacion, skills_por_defecto(recortes={"activa": False}))
        self.assertEqual((completas, eleccion), ([[0, len(palabras) - 1]], "original"))

    def test_el_aire_de_los_cortes_sale_de_la_skill(self):
        palabras = palabras_de("Uno dos tres cuatro cinco seis.")
        normal, _ = montaje.tramos_de(palabras, [[0, 1], [4, 5]])
        amplio, _ = montaje.tramos_de(palabras, [[0, 1], [4, 5]], **editor._aire(
            skills_por_defecto(recortes={"ajustes": {"aire_inicial": 0.5}})))
        self.assertLess(amplio[0]["desde"], normal[0]["desde"] + 1e-9)


class RenderTests(unittest.TestCase):
    def test_filtro_de_color_y_retoques(self):
        self.assertEqual(editor.filtro_css(skills_por_defecto()), "")
        calido = editor.filtro_css(skills_por_defecto(filtros={"ajustes": {"preset": "calido", "intensidad": 100}},
                                                      retoques={"ajustes": {"brillo": 10}}))
        self.assertIn("sepia(0.300)", calido)
        self.assertIn("brightness(1.133)", calido)  # 1,03 del filtro × 1,10 del retoque
        self.assertEqual(editor.filtro_css(skills_por_defecto(filtros={"activa": False, "ajustes": {"preset": "bn"}})), "")

    def test_estilo_del_render(self):
        estilo = editor._estilo(skills_por_defecto(
            subtitulos={"activa": False}, edicion={"ajustes": {"zoom_lento": True}},
            superposiciones={"ajustes": {"rotulo": "@kikoorator", "segundos_rotulo": 3}},
            retoques={"ajustes": {"nitidez": 40, "vineta": 50}}, audio_fx={"ajustes": {"volumen": 60}}), "prueba")
        self.assertFalse(estilo["subtitulos"]["activos"])
        self.assertTrue(estilo["camara"]["zoom_lento"])
        self.assertEqual((estilo["camara"]["nitidez"], estilo["camara"]["vineta"]), (0.4, 0.5))
        self.assertEqual(estilo["superposiciones"]["rotulo"], {"texto": "@kikoorator", "hasta": 3})
        self.assertEqual(estilo["audio"]["sfx_volumen"], 0.6)

    def test_efectos_de_audio_apagados_quitan_los_sonidos(self):
        plan = {"skills": skills_por_defecto(audio_fx={"activa": False}),
                "eventos": [{"sonidos": [{"archivo": "audio/sfx/pop.wav", "inicio": 1.0}]}]}
        self.assertEqual(editor._sonidos(plan, "prueba"), [])
        self.assertEqual(len(editor._sonidos({**plan, "skills": skills_por_defecto()}, "prueba")), 1)


class DirectorTests(unittest.TestCase):
    hechos = {"imagen": {"brillo": 0.14, "contraste": 0.13, "calidez": -0.01, "nitidez": 0.024, "rostro_en": 1.0,
                         "rostro_tamano": 0.05},
              "audio": {"loudness_lufs": -22.0, "pico_dbtp": -3.0},
              "contenido": {"tomas": 1, "lineas_repetidas": 2, "dicho_fuera_del_libreto": 1, "muletillas": 0,
                            "graficos_posibles": {"mapa_pais": 1, "texto_cinetico": 2}, "palabras_por_minuto": 160}}

    def setUp(self):
        self.hechos = {**self.hechos, "observaciones": director.observaciones(self.hechos["imagen"], self.hechos["audio"],
                                                                                self.hechos["contenido"])}

    def test_observa_lo_medido(self):
        self.assertIn("Imagen oscura", self.hechos["observaciones"])
        self.assertIn("rostro pequeño en el cuadro (plano abierto)", self.hechos["observaciones"])

    def test_recomienda_segun_la_toma_y_el_objetivo(self):
        recs = {r["skill"]: r for r in director.recomendaciones_locales(
            self.hechos, skills_por_defecto(), "Reel emotivo para ganar seguidores")}
        self.assertEqual(recs["retoques"]["ajustes"], {"brillo": 10})
        self.assertTrue(recs["edicion"]["ajustes"]["zoom_lento"])
        self.assertEqual(recs["filtros"]["ajustes"]["preset"], "calido")
        self.assertIn("superposiciones", recs)
        self.assertIn("Brillo: 10 %", recs["retoques"]["resumen_ajustes"])

    def test_la_ia_no_puede_inventar_ajustes_ni_tocar_lo_bloqueado(self):
        skills = skills_por_defecto(retoques={"director_ajusta": False})
        recs = director.validar([
            {"skill": "filtros", "usar": True, "motivo": "cálido", "ajustes": {"preset": "neón", "intensidad": 300}},
            {"skill": "retoques", "usar": True, "motivo": "más brillo", "ajustes": {"brillo": 15}},
            {"skill": "inventada", "usar": True},
            {"skill": "filtros", "usar": False},  # repetida: se ignora
        ], skills, fuente="ia:claude-cli")
        self.assertEqual([r["skill"] for r in recs], ["filtros", "retoques"])
        self.assertEqual(recs[0]["ajustes"], {"intensidad": 100})  # el preset inválido se descarta, el rango se acota
        self.assertEqual(recs[1]["ajustes"], {})
        self.assertFalse(recs[1]["cambia"])

    def test_aplicar_recomendaciones_valida_los_valores(self):
        skills = skills_por_defecto()
        nuevas = habilidades.aplicar(skills, {"filtros": {"activa": True, "ajustes": {"preset": "cine"}}})
        self.assertEqual(nuevas["filtros"]["ajustes"]["preset"], "cine")
        self.assertEqual(skills["filtros"]["ajustes"]["preset"], "natural")  # no toca el original
        with self.assertRaises(ValueError):
            habilidades.aplicar(skills, {"filtros": {"ajustes": {"preset": "neón"}}})

    def test_el_prompt_lleva_objetivo_hechos_y_limites(self):
        texto = director.seccion_prompt("Reel emotivo", self.hechos, skills_por_defecto())
        self.assertIn("Reel emotivo", texto)
        self.assertIn("Imagen oscura", texto)
        self.assertIn("preset=\"natural\" (natural|calido|frio|cine|vivo|vintage|bn)", texto)


if __name__ == "__main__":
    unittest.main()
