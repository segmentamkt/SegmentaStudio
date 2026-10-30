"""Pruebas del libreto: alineación con lo dicho, tomas repetidas, varias tomas e indicaciones."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import libreto  # noqa: E402
import montaje  # noqa: E402
from planificador import Palabra, eventos_de_libreto  # noqa: E402
from test_planificador import palabras_de  # noqa: E402


def tomas(*textos: str) -> list[Palabra]:
    """Varias grabaciones seguidas: cada una empieza en 0 s y conserva su número de archivo."""
    palabras = []
    for clip, texto in enumerate(textos):
        for p in palabras_de(texto):
            palabras.append(Palabra(len(palabras), p.texto, p.inicio, p.fin, clip))
    return palabras


class AlineacionTests(unittest.TestCase):
    def test_corrige_con_el_libreto_sin_inventar_palabras(self):
        palabras = palabras_de("Trabajo con antropic desde Bogotá. Cuando vuelve el amor, revisa todo.")
        guia = libreto.leer("Trabajo con Anthropic desde Bogotá.\nCuando vuelve el amo, revisa todo.")
        alineado = libreto.alinear(guia, palabras)
        cambios = {(c["de"], c["a"]) for c in alineado["correcciones"]}
        self.assertIn(("antropic", "Anthropic"), cambios)
        self.assertIn(("amor,", "amo,"), cambios)
        self.assertEqual(alineado["faltan"], [])

    def test_un_sinonimo_dicho_se_respeta(self):
        palabras = palabras_de("El amo castiga al tercero.")
        alineado = libreto.alinear(libreto.leer("El amo reprende al tercero."), palabras)
        self.assertNotIn("reprende", [c["a"] for c in alineado["correcciones"]])

    def test_numeros_en_letras_y_en_cifras_coinciden(self):
        palabras = palabras_de("En Mateo 25 Jesús cuenta una parábola.")
        alineado = libreto.alinear(libreto.leer("En Mateo veinticinco Jesús cuenta una parábola."), palabras)
        self.assertEqual(alineado["lineas"][0]["cobertura"], 1.0)

    def test_toma_repetida_usa_la_mas_reciente_y_marca_lo_sobrante(self):
        palabras = palabras_de(
            "Hoy hablamos de los talentos. El tercero entierra lo que le dieron por miedo. "
            "el castiga eh El tercero entierra lo que le dieron por miedo a perderlo. Así termina la historia."
        )
        guia = libreto.leer("Hoy hablamos de los talentos.\nEl tercero entierra lo que le dieron por miedo a perderlo.\nAsí termina la historia.")
        alineado = libreto.alinear(guia, palabras)
        segunda = alineado["lineas"][1]
        self.assertEqual(len(segunda["otras_tomas"]), 1)
        self.assertGreater(segunda["toma"][0], segunda["otras_tomas"][0][0])
        texto_final = " ".join(p.texto for a, b in alineado["segmentos"] for p in palabras[a:b + 1])
        self.assertEqual(texto_final.count("entierra"), 1)
        self.assertIn("a perderlo.", texto_final)

    def test_linea_que_falta_se_avisa(self):
        palabras = palabras_de("Primera idea del video. Tercera idea del video.")
        guia = libreto.leer("Primera idea del video.\nSegunda idea que olvidé decir por completo.\nTercera idea del video.")
        self.assertEqual([f["n"] for f in libreto.alinear(guia, palabras)["faltan"]], [1])


class VariasTomasTests(unittest.TestCase):
    def test_el_libreto_ordena_las_tomas_y_ningun_tramo_cruza_archivos(self):
        # Se grabó primero el final y después el comienzo.
        palabras = tomas("Y por eso hay que intentarlo siempre.", "Hoy les cuento una historia corta. Trata de un hombre con miedo.")
        guia = libreto.leer("Hoy les cuento una historia corta.\nTrata de un hombre con miedo.\nY por eso hay que intentarlo siempre.")
        alineado = libreto.alinear(guia, palabras)
        tramos, _ = montaje.tramos_de(palabras, alineado["segmentos"])
        self.assertEqual([t["clip"] for t in tramos], [1, 0])
        final, _ = montaje.aplicar(palabras, tramos)
        self.assertEqual(final[0].texto, "Hoy")
        self.assertEqual(final[-1].texto, "siempre.")
        self.assertTrue(all(b.inicio >= a.inicio for a, b in zip(final, final[1:])))

    def test_un_rango_que_cruza_archivos_se_parte(self):
        palabras = tomas("uno dos tres.", "cuatro cinco seis.")
        tramos, _ = montaje.tramos_de(palabras, [[0, len(palabras) - 1]])
        self.assertEqual([(t["clip"], t["palabras"]) for t in tramos], [(0, [0, 2]), (1, [3, 5])])
        self.assertTrue(any("Corte" in z["motivo"] for z in montaje.zoom_de_cortes(tramos, 10)))


class IndicacionesTests(unittest.TestCase):
    def test_indicaciones_se_vuelven_eventos_o_avisos(self):
        palabras = palabras_de("En la Biblia hay una historia. En Mateo 25 está la parábola. Brasil también aparece.")
        guia = libreto.leer(
            "En la Biblia hay una historia. [IMAGEN biblia.png] [ICONO no-existe]\n"
            "En Mateo 25 está la parábola. [TEXTO \"MATEO 25\"] [SONIDO golpe]\n"
            "Brasil también aparece. [MAPA Brasil] [SIN GRÁFICO] [BAILE]"
        )
        recursos = {"biblia": {"nombre": "biblia.png", "tipo": "image", "archivo": "recursos/p/biblia.png"}}
        eventos, avisos, sin_grafico = eventos_de_libreto(libreto.alinear(guia, palabras), palabras, recursos)
        componentes = {(e.componente, e.fuente) for e in eventos}
        self.assertIn(("imagen", "libreto"), componentes)
        self.assertIn(("texto_cinetico", "libreto"), componentes)
        self.assertIn(("mapa_pais", "libreto"), componentes)
        texto = next(e for e in eventos if e.componente == "texto_cinetico")
        self.assertEqual(texto.params["texto"], "MATEO 25")
        self.assertEqual([palabras[i].texto for i in range(texto.i0, texto.i1 + 1)], ["Mateo", "25"])
        self.assertEqual(len(sin_grafico), 1)
        self.assertEqual(len(avisos), 3)  # ícono inexistente, sonido no subido, indicación desconocida
        self.assertTrue(all(e.prioridad == 9 for e in eventos))

    def test_imagen_con_descripcion_para_generarla(self):
        guia = libreto.leer('La Biblia. [IMAGEN biblia-antigua "Biblia antigua con luz de vela"] [IMAGEN logo.png]')
        primera, segunda = guia[0].indicaciones
        self.assertEqual((primera["valor"], primera["descripcion"]), ("biblia-antigua", "Biblia antigua con luz de vela"))
        self.assertEqual((segunda["valor"], segunda["descripcion"]), ("logo.png", None))
        palabras = palabras_de("La Biblia.")
        recursos = {"bibliaantigua": {"nombre": "biblia-antigua.png", "tipo": "image", "archivo": "recursos/p/biblia-antigua.png"}}
        eventos, avisos, _ = eventos_de_libreto(libreto.alinear(guia, palabras), palabras, recursos)
        self.assertEqual([e.params["recurso"] for e in eventos], ["biblia-antigua.png"])
        self.assertIn("genérala con IA", avisos[0])


if __name__ == "__main__":
    unittest.main()
