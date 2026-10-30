"""Pruebas del planificador semántico sin audio: palabras con tiempos sintéticos."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import ia  # noqa: E402
from planificador import Palabra, candidatos_locales, construir_plan  # noqa: E402
from subtitulos import cortes_sintacticos_malos, tarjetas_subtitulos  # noqa: E402

GUION = (
    "Imagina que estás en Brasil, celebrando que tu equipo es campeón de fútbol. "
    "Corres al teclado a escribirlo y te llaman por teléfono. "
    "Era tu amigo, lanzaron una moneda para ver quién pagaba la fiesta."
)


def palabras_de(texto: str, ritmo: float = 0.36) -> list[Palabra]:
    resultado, t = [], 0.0
    for i, token in enumerate(texto.split()):
        resultado.append(Palabra(i, token, round(t, 3), round(t + ritmo - 0.04, 3)))
        t += ritmo + (0.3 if token.endswith((".", ",")) else 0)
    return resultado


def plan_de(texto: str, **kwargs) -> dict:
    palabras = palabras_de(texto, **kwargs)
    fuente = {"tipo": "voz_guia", "original": None, "inicio_clip": 0.0}
    return construir_plan(palabras, candidatos_locales(palabras), fuente, ia={"estado": "desactivada"},
                          correcciones=[], descartes_ia=[])


def componentes(plan: dict) -> list[tuple[str, str]]:
    return [(e["componente"], e["ancla"]["texto"]) for e in plan["eventos"]]


class GuionDePruebaTests(unittest.TestCase):
    def test_reproduce_el_plan_aprobado(self):
        plan = plan_de(GUION)
        self.assertEqual(componentes(plan), [
            ("mapa_pais", "Brasil"), ("trofeo", "campeón"), ("teclado", "teclado"),
            ("llamada", "llaman"), ("moneda", "lanzaron una moneda"),
        ])
        mapa, trofeo, teclado, llamada, moneda = plan["eventos"]
        self.assertEqual(mapa["params"]["pais"], "BRA")
        self.assertEqual(trofeo["params"]["sobre_mapa"], "BRA")
        self.assertEqual(mapa["grupo"], trofeo["grupo"])
        self.assertEqual(llamada["params"]["nombre"], "Amigo")
        self.assertEqual(len(teclado["params"]["pulsaciones"]), 4)
        palabras = {p["texto"].strip(",."): p for p in plan["palabras"]}
        self.assertEqual(moneda["params"]["aterriza"], palabras["moneda"]["fin"])
        self.assertEqual(plan["camara"]["zoom"][-1]["motivo"], "Remate sobre «fiesta»")

    def test_nunca_se_solapan_grupos_distintos(self):
        eventos = plan_de(GUION)["eventos"]
        for a, b in zip(eventos, eventos[1:]):
            if a["grupo"] and a["grupo"] == b["grupo"]:
                continue
            self.assertLessEqual(a["fin"], b["inicio"])

    def test_el_telefono_no_duplica_la_llamada(self):
        descartados = plan_de(GUION)["descartados"]
        self.assertFalse(any(d["componente"] == "icono" and "teléfono" in d["ancla"] for d in descartados))


class DesambiguacionTests(unittest.TestCase):
    def test_me_llamo_es_un_nombre(self):
        self.assertEqual(componentes(plan_de("Hola, me llamo Federico y hoy hablamos de edición.")), [])

    def test_lo_que_llamamos_no_es_una_llamada(self):
        self.assertEqual(componentes(plan_de("A veces lo que llamamos prudencia es miedo disfrazado.")), [])

    def test_teclado_musical_no_es_teclado_de_computador(self):
        self.assertEqual(componentes(plan_de("Aprendí a tocar el teclado musical en casa de mi abuela.")),
                         [("icono", "teclado")])

    def test_moneda_como_dinero_no_se_lanza(self):
        plan = plan_de("La moneda perdió valor frente al dólar este año.")
        self.assertEqual(plan["eventos"][0]["componente"], "icono")
        self.assertEqual(plan["eventos"][0]["params"]["icono"], "coins")

    def test_chile_en_minuscula_no_es_un_pais(self):
        self.assertFalse(any(c == "mapa_pais" for c, _ in componentes(plan_de("Le puse chile a la sopa."))))

    def test_alias_de_paises(self):
        plan = plan_de("Viajamos a EE. UU. el verano pasado.")
        self.assertEqual(plan["eventos"][0]["params"]["pais"], "USA")

    def test_cifras_relevantes_y_su_verificacion(self):
        plan = plan_de("La inflación llegó al 12 % y un amigo perdió dos empleos.")
        textos = [e["params"]["texto"] for e in plan["eventos"] if e["componente"] == "texto_cinetico"]
        self.assertEqual(textos, ["12 %"])
        self.assertIn("económico", plan["eventos"][0]["verificar"])

    def test_equipo_real_pide_verificar(self):
        plan = plan_de("Mi papá dice que Millonarios fue campeón ese año.")
        trofeo = next(e for e in plan["eventos"] if e["componente"] == "trofeo")
        self.assertIn("Millonarios", trofeo["verificar"])

    def test_inteligencia_artificial_sin_robots(self):
        plan = plan_de("Hoy uso inteligencia artificial para editar.")
        self.assertEqual(plan["eventos"][0]["params"]["icono"], "cpu")

    def test_repeticiones_se_descartan(self):
        plan = plan_de("Brasil es enorme. Brasil tiene playas.")
        self.assertEqual([c for c, _ in componentes(plan)].count("mapa_pais"), 1)
        self.assertTrue(any("Repetido" in d["motivo"] for d in plan["descartados"]))


class SubtitulosTests(unittest.TestCase):
    def test_no_cortan_en_palabra_funcional_ni_parten_complementos(self):
        plan = plan_de(GUION)
        claves = {i for e in plan["eventos"] for i in range(e["ancla"]["i0"], e["ancla"]["i1"] + 1)}
        tarjetas = tarjetas_subtitulos(plan["palabras"], plan["duracion"], claves)
        self.assertEqual(cortes_sintacticos_malos(tarjetas), [])
        textos = [" ".join(p["texto"] for p in t["palabras"]) for t in tarjetas]
        self.assertIn("ES CAMPEÓN DE FÚTBOL", textos)

    def test_frases_casi_todas_funcionales_no_terminan_en_funcional(self):
        palabras = [{"i": p.i, "texto": p.texto, "inicio": p.inicio, "fin": p.fin}
                    for p in palabras_de("¿Sabe qué fue lo que hizo mal? No es más que el miedo disfrazado.")]
        tarjetas = tarjetas_subtitulos(palabras, 10.0, set())
        self.assertEqual(cortes_sintacticos_malos(tarjetas), [])

    def test_no_parten_un_ancla_de_varias_palabras(self):
        # Cuatro palabras antes del final del ancla: el límite de largo no puede partirla.
        plan = plan_de("Allá descubrí que la inteligencia artificial ya edita videos.")
        claves = {i for e in plan["eventos"] for i in range(e["ancla"]["i0"], e["ancla"]["i1"] + 1)}
        finales = {e["ancla"]["i1"] for e in plan["eventos"]}
        textos = [" ".join(p["texto"] for p in t["palabras"])
                  for t in tarjetas_subtitulos(plan["palabras"], plan["duracion"], claves, finales)]
        self.assertTrue(any("INTELIGENCIA ARTIFICIAL" in texto for texto in textos), textos)


class ValidacionIATests(unittest.TestCase):
    def test_rechaza_lo_que_no_puede_verificar(self):
        palabras = palabras_de("Trabajo con antropic desde Bogotá en un proyecto.")
        respuesta = {
            "eventos": [
                {"componente": "mapa_pais", "i0": 4, "i1": 4, "params": {"pais": "COL"}, "justificacion": "Bogotá"},
                {"componente": "icono", "i0": 7, "i1": 7, "params": {"icono": "no-existe"}},
                {"componente": "holograma", "i0": 0, "i1": 0, "params": {}},
                {"componente": "texto_cinetico", "i0": 2, "i1": 2, "params": {"texto": "100 MILLONES"}},
            ],
            "correcciones": [{"i": 2, "a": "Anthropic"}, {"i": 0, "a": "Descanso"}, {"i": 4, "a": "Bogotá,"}],
        }
        nuevos, _, correcciones, rechazos = ia.validar(respuesta, palabras, [], "ia:prueba")
        self.assertEqual([c.componente for c in nuevos], ["mapa_pais", "texto_cinetico"])
        self.assertEqual(nuevos[1].params["texto"], "ANTROPIC")  # el texto sale de lo dicho, no de la IA
        self.assertEqual(len(rechazos), 2)
        # «Bogotá,» es igual al original: no es corrección. La puntuación nunca se duplica («amo,,»).
        self.assertEqual([c["a"] for c in correcciones], ["Anthropic"])
        nuevos, _, correcciones, _ = ia.validar({"correcciones": [{"i": 4, "a": "Bogota,"}]},
                                                 palabras_de("Trabajo con antropic desde Bogotá, en un proyecto."), [], "ia:prueba")
        self.assertEqual(correcciones[0]["a"], "Bogota,")


if __name__ == "__main__":
    unittest.main()
