"""Pruebas del montaje (cortes y reordenamiento) y del paso «rehacer»."""

import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import editor  # noqa: E402
import montaje  # noqa: E402
from planificador import candidatos_locales, construir_plan  # noqa: E402
from test_planificador import GUION, palabras_de  # noqa: E402


class TramosTests(unittest.TestCase):
    def test_cortes_en_silencio_y_en_fotogramas_exactos(self):
        palabras = palabras_de("uno dos tres. cuatro cinco seis. siete ocho nueve.")
        tramos, duracion = montaje.tramos_de(palabras, [[6, 8], [0, 2]])
        for tramo in tramos:
            for valor in (tramo["desde"], tramo["hasta"], tramo["salida"]):
                self.assertAlmostEqual(valor * 30, round(valor * 30), places=6)
        # El segundo tramo empieza donde termina el primero en el video final.
        self.assertAlmostEqual(tramos[1]["salida"], tramos[0]["hasta"] - tramos[0]["desde"])
        self.assertAlmostEqual(duracion, sum(t["hasta"] - t["desde"] for t in tramos), places=3)
        # El corte no se come la palabra: cae entre el final de la anterior y el inicio de la primera.
        self.assertGreaterEqual(tramos[0]["desde"] + 1 / 30, palabras[5].fin)
        self.assertLessEqual(tramos[0]["desde"], palabras[6].inicio + 1 / 30)

    def test_aplicar_reordena_y_conserva_el_origen(self):
        palabras = palabras_de("uno dos tres. cuatro cinco seis. siete ocho nueve.")
        tramos, _ = montaje.tramos_de(palabras, [[6, 8], [0, 2]])
        final, origen = montaje.aplicar(palabras, tramos)
        self.assertEqual([p.texto for p in final], ["siete", "ocho", "nueve.", "uno", "dos", "tres."])
        self.assertEqual(origen[0], 6)
        self.assertEqual(origen[3], 0)
        self.assertTrue(all(b.inicio >= a.inicio for a, b in zip(final, final[1:])))
        self.assertEqual([e["texto"] for e in montaje.eliminados(palabras, [[6, 8], [0, 2]])], ["cuatro cinco seis."])

    def test_rango_invalido_se_rechaza(self):
        with self.assertRaises(ValueError):
            montaje.tramos_de(palabras_de("uno dos"), [[0, 5]])


class RehacerTests(unittest.TestCase):
    def test_quitar_una_frase_conserva_los_demas_eventos(self):
        palabras = palabras_de(GUION)
        plan = construir_plan(palabras, candidatos_locales(palabras), {"tipo": "voz_guia", "original": None, "inicio_clip": 0.0},
                              ia={"estado": "desactivada"}, correcciones=[], descartes_ia=[])
        tramos, _ = montaje.tramos_de(palabras, [[0, len(palabras) - 1]])
        plan.update({"palabras_fuente": plan["palabras"],
                     "montaje": {"segmentos": [[0, len(palabras) - 1]], "tramos": tramos, "eliminados": []}})
        # Se quita «Corres al teclado a escribirlo y te llaman por teléfono.» (palabras 13–21).
        inicio_frase = next(p.i for p in palabras if p.texto == "Corres")
        fin_frase = next(p.i for p in palabras if p.texto == "teléfono.")
        plan["montaje"]["segmentos"] = [[0, inicio_frase - 1], [fin_frase + 1, len(palabras) - 1]]
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "prueba" / "plan_edicion.json"
            ruta.parent.mkdir()
            ruta.write_text(json.dumps(plan, ensure_ascii=False))
            with patch.object(editor, "ENTREGA", Path(directorio) / "entrega"), patch("builtins.print"):
                editor.rehacer(argparse.Namespace(plan=ruta, sin_descargas=True))
            nuevo = json.loads(ruta.read_text())
        componentes = [e["componente"] for e in nuevo["eventos"]]
        self.assertEqual(componentes, ["mapa_pais", "trofeo", "moneda"])
        self.assertEqual({d["componente"] for d in nuevo["descartados"] if "montaje" in d["motivo"]}, {"teclado", "llamada"})
        moneda = nuevo["eventos"][-1]
        palabra_moneda = next(p for p in nuevo["palabras"] if p["texto"] == "moneda")
        self.assertEqual(moneda["params"]["aterriza"], palabra_moneda["fin"])
        self.assertTrue(any("Corte de montaje" in z["motivo"] for z in nuevo["camara"]["zoom"]))
        self.assertLess(nuevo["duracion"], plan["duracion"])
        self.assertEqual(nuevo["montaje"]["eliminados"][0]["palabras"], [inicio_frase, fin_frase])



TOMA_CON_REPETICION = (
    "En la Biblia hay un hombre que no robó nada. "
    "Cuando vuelve el amo, revisa a sus siervos, el castiga al tercero por no haber hecho nada con lo que le dieron. "
    "que eso me hace pensar cuántas personas hacen lo mismo con su vida. "
    "Gente con ideas que nunca desarrollan. "
    "Me hace pensar cuántas personas hacen lo mismo con su vida. "
    "Al tercero lo reprenden por no haber hecho nada con lo que le dieron. "
    "Así que piénselo."
)


def _plan_en_disco(directorio: str, texto: str) -> Path:
    palabras = palabras_de(texto)
    plan = construir_plan(palabras, candidatos_locales(palabras), {"tipo": "voz_guia", "original": None, "inicio_clip": 0.0},
                          ia={"estado": "desactivada"}, correcciones=[], descartes_ia=[])
    tramos, _ = montaje.tramos_de(palabras, [[0, len(palabras) - 1]])
    plan.update({"palabras_fuente": plan["palabras"], "sugerencias_montaje": montaje.detectar_repeticiones(palabras),
                 "montaje": {"segmentos": [[0, len(palabras) - 1]], "tramos": tramos, "eliminados": []}})
    ruta = Path(directorio) / "toma" / "plan_edicion.json"
    ruta.parent.mkdir()
    ruta.write_text(json.dumps(plan, ensure_ascii=False))
    return ruta


class RepeticionesTests(unittest.TestCase):
    def test_detecta_la_toma_repetida_y_propone_dos_montajes(self):
        palabras = palabras_de(TOMA_CON_REPETICION)
        sugerencia = montaje.detectar_repeticiones(palabras)
        self.assertEqual(len(sugerencia["repeticiones"]), 2)
        def texto(segmentos):
            return " ".join(p.texto for a, b in segmentos for p in palabras[a:b + 1])
        limpia = texto(sugerencia["opciones"]["usar_ultima"]["segmentos"])
        # La versión posterior ocupa el lugar de la primera; el arranque «que eso» se descarta.
        self.assertIn("revisa a sus siervos, Al tercero lo reprenden", limpia)
        self.assertIn("dieron. Me hace pensar", limpia)
        self.assertNotIn("que eso", limpia)
        self.assertEqual(limpia.count("Me hace pensar"), 1)
        sin_repetir = texto(sugerencia["opciones"]["quitar_repeticion"]["segmentos"])
        self.assertIn("el castiga al tercero", sin_repetir)
        self.assertNotIn("lo reprenden", sin_repetir)

    def test_un_estribillo_corto_no_es_una_repeticion(self):
        palabras = palabras_de("No lo hizo por miedo. Tampoco lo hizo por pereza. Lo hizo por amor a su familia.")
        self.assertIsNone(montaje.detectar_repeticiones(palabras))


class EditarTests(unittest.TestCase):
    def test_aplica_la_revision_completa(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = _plan_en_disco(directorio, GUION)
            plan = json.loads(ruta.read_text())
            teclado = next(e["id"] for e in plan["eventos"] if e["componente"] == "teclado")
            cambios = Path(directorio) / "cambios.json"
            cambios.write_text(json.dumps({"quitar": [teclado], "agregar_textos": ["quién pagaba la fiesta"]}))
            with patch("builtins.print"):
                editor.editar(argparse.Namespace(plan=ruta, cambios=cambios, sin_descargas=True))
            nuevo = json.loads(ruta.read_text())
        componentes = [e["componente"] for e in nuevo["eventos"]]
        self.assertNotIn("teclado", componentes)
        agregado = next(e for e in nuevo["eventos"] if e["fuente"] == "usuario")
        self.assertEqual(agregado["params"]["texto"], "QUIÉN PAGABA LA FIESTA")
        self.assertTrue(any(d["motivo"] == "Quitado en la revisión." for d in nuevo["descartados"]))

    def test_frase_que_no_se_dijo_se_rechaza(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = _plan_en_disco(directorio, GUION)
            cambios = Path(directorio) / "cambios.json"
            cambios.write_text(json.dumps({"agregar_textos": ["compren mi curso"]}))
            with self.assertRaises(SystemExit), patch("builtins.print"):
                editor.editar(argparse.Namespace(plan=ruta, cambios=cambios, sin_descargas=True))

    def test_elige_una_sugerencia_de_montaje(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = _plan_en_disco(directorio, TOMA_CON_REPETICION)
            cambios = Path(directorio) / "cambios.json"
            cambios.write_text(json.dumps({"montaje": "usar_ultima"}))
            with patch("builtins.print"):
                editor.editar(argparse.Namespace(plan=ruta, cambios=cambios, sin_descargas=True))
            nuevo = json.loads(ruta.read_text())
        self.assertEqual(nuevo["montaje"]["eleccion"], "usar_ultima")
        self.assertGreater(len(nuevo["montaje"]["tramos"]), 1)
        self.assertEqual(" ".join(p["texto"] for p in nuevo["palabras"]).count("Me hace pensar"), 1)


if __name__ == "__main__":
    unittest.main()
