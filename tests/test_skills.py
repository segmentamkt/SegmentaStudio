import tempfile
import unittest
from pathlib import Path

from multiagent_core import SQLiteStore
from kiko_studio.skills import CATALOGO, SkillStore, motor


class SkillStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        self.base = Path(self.temporal.name)
        self.store = SQLiteStore(self.base / "kiko.sqlite3")
        self.skills = SkillStore(self.store, self.base / "data")

    def tearDown(self):
        self.store.close()
        self.temporal.cleanup()

    def archivo(self, nombre: str, contenido: bytes = b"x" * 2048) -> Path:
        ruta = self.base / nombre
        ruta.write_bytes(contenido)
        return ruta

    def test_catalogo_completo_con_director_y_valores_validos(self):
        ids = [s["id"] for s in self.skills.listar()]
        self.assertEqual(ids, ["director", "sonido", "efectos", "recortes", "edicion", "filtros", "generador",
                               "superposiciones", "audio_fx", "subtitulos", "retoques"])
        for skill in CATALOGO:
            for parametro in skill["parametros"]:
                motor.validar_valor(parametro, parametro["defecto"], [])
        self.assertTrue(all(s["activa"] and not s["personalizada"] for s in self.skills.listar()))

    def test_guardar_valida_y_restablecer(self):
        filtros = self.skills.guardar("filtros", {"activa": False, "instrucciones": "Look cálido de atardecer",
                                                  "ajustes": {"preset": "calido", "intensidad": 140}})
        self.assertFalse(filtros["activa"])
        self.assertEqual((filtros["ajustes"]["preset"], filtros["ajustes"]["intensidad"]), ("calido", 100))
        self.assertTrue(filtros["personalizada"])
        with self.assertRaisesRegex(ValueError, "no es una opción"):
            self.skills.guardar("filtros", {"ajustes": {"preset": "neón"}})
        with self.assertRaisesRegex(ValueError, "no es un ajuste"):
            self.skills.guardar("filtros", {"ajustes": {"inventado": 1}})
        with self.assertRaisesRegex(ValueError, "vacías"):
            self.skills.guardar("filtros", {"instrucciones": "   "})
        original = self.skills.restablecer("filtros")
        self.assertTrue(original["activa"])
        self.assertEqual(original["ajustes"]["preset"], "natural")
        self.assertEqual(original["instrucciones"], original["instrucciones_por_defecto"])

    def test_recursos_con_licencia_y_tipo_de_la_skill(self):
        with self.assertRaisesRegex(ValueError, "no usa recursos"):
            self.skills.importar_recurso("filtros", "font", "letra.ttf", self.archivo("letra.ttf"), "Propia")
        with self.assertRaisesRegex(ValueError, "licencia"):
            self.skills.importar_recurso("subtitulos", "font", "letra.ttf", self.archivo("letra.ttf"), " ")
        subtitulos = self.skills.importar_recurso("subtitulos", "font", "Montserrat.ttf", self.archivo("m.ttf"), "OFL")
        fuente = subtitulos["recursos_cargados"][0]
        self.assertEqual((fuente["tipo"], fuente["licencia"]), ("font", "OFL"))
        elegida = self.skills.guardar("subtitulos", {"ajustes": {"fuente": fuente["id"]}})
        self.assertEqual(elegida["ajustes"]["fuente"], fuente["id"])
        with self.assertRaisesRegex(ValueError, "no existe"):
            self.skills.guardar("subtitulos", {"ajustes": {"fuente": "otro-id"}})
        ruta, nombre = self.skills.media(fuente["id"])
        self.assertEqual(nombre, "Montserrat.ttf")
        # Al quitar el recurso elegido, el ajuste vuelve al valor por defecto.
        self.assertEqual(self.skills.borrar_recurso(fuente["id"])["ajustes"]["fuente"], "")
        self.assertFalse(ruta.exists())

    def test_documentos_dan_conocimiento_y_todo_llega_al_motor(self):
        texto = "Mi público son emprendedores de 25 a 35 años. Tono cercano.".encode()
        self.skills.importar_recurso("director", "document", "publico.txt", self.archivo("publico.txt", texto), "Propia")
        self.skills.guardar("efectos", {"ajustes": {"densidad": "baja"}, "director_ajusta": False})
        motor_skills = self.skills.para_motor()["skills"]
        self.assertIn("emprendedores", motor_skills["director"]["recursos"][0]["texto"])
        self.assertEqual(motor_skills["efectos"]["ajustes"]["densidad"], "baja")
        self.assertFalse(motor_skills["efectos"]["director_ajusta"])
        self.assertEqual(set(motor_skills["sonido"]), {"nombre", "descripcion", "activa", "instrucciones", "ajustes",
                                                      "director_ajusta", "parametros", "recursos"})


if __name__ == "__main__":
    unittest.main()
