import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from multiagent_core import SQLiteStore
from kiko_studio import semantic_editor
from kiko_studio.semantic_editor import SemanticEditor

# Editor falso: imita las salidas de remotion/scripts/editor.py sin transcribir ni renderizar.
EDITOR_FALSO = r'''
import json, sys
from pathlib import Path
raiz = Path(__file__).resolve().parents[1]
paso, args = sys.argv[1], sys.argv[2:]
def valor(nombre):
    return args[args.index(nombre) + 1]
if paso == "revisar":
    print("@@revision " + json.dumps({"revision": [{"id": "audio", "nivel": "ok", "mensaje": "Volumen correcto."}]}), flush=True)
elif paso == "planificar":
    clips = args[args.index("--clip") + 1:args.index("--nombre")]
    if any("falla" in c for c in clips):
        sys.exit("La transcripción no trae marcas por palabra; no se inventan tiempos.")
    assert Path(valor("--libreto")).read_text().strip(), "sin libreto"
    print("@@progreso 40|analyzing|Comparando con el libreto…", flush=True)
    carpeta = raiz / "trabajo" / valor("--nombre"); carpeta.mkdir(parents=True, exist_ok=True)
    plan = {"duracion": 9.0, "fuente": {"originales": clips},
            "palabras": [{"i": 0, "texto": "Hola", "inicio": 0, "fin": 0.5}],
            "palabras_fuente": [{"i": 0, "texto": "Hola", "inicio": 0, "fin": 0.5, "clip": 0}],
            "ia": {"estado": "desactivada"}, "montaje": {"segmentos": [[0, 0]], "tramos": [], "eliminados": []},
            "libreto": {"cobertura": 1.0, "faltan": [], "avisos": [], "fuera_del_libreto": [], "lineas": [{"n": 0, "texto": "Hola", "otras_tomas": []}]},
            "correcciones": [], "descartados": [], "recursos": json.loads(Path(valor("--recursos")).read_text()),
            "eventos": [{"id": "c0", "componente": "texto_cinetico", "inicio": 0, "fin": 1,
                         "ancla": {"i0": 0, "i1": 0, "texto": "Hola"}, "params": {"texto": "HOLA"},
                         "sonidos": [{"archivo": "audio/sfx/impacto.wav"}], "justificacion": "prueba", "fuente": "libreto"}],
            "camara": {"zoom": []},
            "objetivo": valor("--objetivo") if "--objetivo" in args else "",
            "skills": json.loads(Path(valor("--skills")).read_text())["skills"] if "--skills" in args else {}}
    (carpeta / "plan_edicion.json").write_text(json.dumps(plan))
    print("@@progreso 100|complete|Plan listo.", flush=True)
elif paso == "editar":
    ruta = Path(valor("--plan")); plan = json.loads(ruta.read_text())
    cambios = json.loads(Path(valor("--cambios")).read_text())
    plan["eventos"] = [e for e in plan["eventos"] if e["id"] not in cambios.get("quitar", [])]
    ruta.write_text(json.dumps(plan))
elif paso == "render":
    ruta = Path(valor("--plan")); nombre = ruta.parent.name; salida = raiz / "out"; salida.mkdir(exist_ok=True)
    if "--marca" in args:
        assert json.loads(Path(valor("--marca")).read_text())["colores"]
    print("@@progreso 55|rendering|Renderizando fotograma 10 de 20…", flush=True)
    if "--vista-previa" in args:
        (salida / f"{nombre}_vista.mp4").write_bytes(b"vista")
        (ruta.parent / "vista.json").write_text(json.dumps({"inicio": 0.0, "duracion": 12}))
    else:
        (salida / f"{nombre}.mp4").write_bytes(b"mp4"); (salida / f"{nombre}.srt").write_text("1\n")
        (salida / f"{nombre}.jpg").write_bytes(b"jpg")
        (ruta.parent / "qc.json").write_text(json.dumps({"aprobado": {"duracion": True}, "duracion_s": 9.0, "loudness_lufs": -14.0}))
'''

LIBRETO = "Hola, este es el libreto completo del video de prueba."


class SemanticEditorTests(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        base = Path(self.temporal.name)
        remotion = base / "remotion"
        (remotion / "scripts").mkdir(parents=True)
        (remotion / "node_modules" / "remotion").mkdir(parents=True)
        (remotion / "scripts" / "editor.py").write_text(EDITOR_FALSO)
        self.parches = [patch.object(semantic_editor, "REMOTION", remotion),
                        patch.object(semantic_editor, "EDITOR", remotion / "scripts" / "editor.py")]
        for parche in self.parches:
            parche.start()
        self.store = SQLiteStore(base / "kiko.sqlite3")
        self.progreso = []
        self.editor = SemanticEditor(self.store, base / "data", lambda *args: self.progreso.append(args))
        toma = base / "toma.mov"
        toma.write_bytes(b"mov")
        self.video = {"id": "v1", "project_id": "p1", "original_name": "toma.mov", "imported_path": str(toma)}

    def tearDown(self):
        for parche in self.parches:
            parche.stop()
        self.store.close()
        self.temporal.cleanup()

    def esperar(self, edit_id, *ocupados):
        for _ in range(200):
            estado = self.editor.vista(edit_id)["status"]
            if estado not in ocupados:
                return estado
            time.sleep(0.02)
        self.fail("el paso en segundo plano no terminó")

    def test_flujo_completo_en_segundo_plano(self):
        recursos = [{"nombre": "biblia.png", "tipo": "image", "ruta": "/x/biblia.png", "licencia": "propia"}]
        creado = self.editor.planificar([self.video, {**self.video, "id": "v2"}], libreto=LIBRETO, recursos=recursos, ia="no")
        self.assertEqual(creado["status"], "planning")  # responde al instante; el trabajo sigue en un hilo
        self.assertEqual(self.esperar(creado["id"], "planning"), "planned")
        plan = self.editor.vista(creado["id"])
        self.assertEqual(plan["video_ids"], ["v1", "v2"])
        self.assertEqual(plan["libreto"]["cobertura"], 1.0)
        self.assertEqual(plan["recursos"][0]["nombre"], "biblia.png")
        self.assertIn((creado["id"], 40, "analyzing", "Comparando con el libreto…", "running"), self.progreso)

        marca = {"colores": {"morado": "#111111"}, "logo": None, "marca_de_agua": False, "cierre": None}
        self.editor.vista_previa(creado["id"], inicio="auto", marca=marca)
        self.assertEqual(self.esperar(creado["id"], "previewing"), "planned")
        self.assertTrue(self.editor.vista(creado["id"])["vista_url"].endswith("/vista"))

        self.assertEqual(self.editor.editar(creado["id"], {"quitar": ["c0"]})["eventos"], [])
        self.assertIsNone(self.editor.vista(creado["id"])["vista_url"])  # el plan cambió: la vista previa ya no sirve

        self.editor.render(creado["id"], marca=marca)
        self.assertEqual(self.esperar(creado["id"], "rendering"), "ready")
        listo = self.editor.vista(creado["id"])
        self.assertTrue(listo["qc"]["aprobado"]["duracion"])
        for tipo, contenido in (("output", b"mp4"), ("srt", b"1\n"), ("miniatura", b"jpg")):
            ruta, _ = self.editor.media(creado["id"], tipo)
            self.assertEqual(ruta.read_bytes(), contenido)

    def test_objetivo_y_skills_llegan_al_motor(self):
        skills = {"version": 1, "skills": {"filtros": {
            "nombre": "Filtros de color", "activa": True, "ajustes": {"preset": "calido", "intensidad": 60},
            "parametros": [{"clave": "preset", "etiqueta": "Filtro", "tipo": "opcion", "defecto": "natural",
                            "opciones": [["natural", "Natural"], ["calido", "Cálido"]]},
                           {"clave": "intensidad", "etiqueta": "Intensidad", "tipo": "rango", "defecto": 60,
                            "min": 0, "max": 100, "unidad": " %"}], "recursos": []}}}
        creado = self.editor.planificar([self.video], libreto=LIBRETO, recursos=[], ia="no", skills=skills,
                                        objetivo="Reel emotivo para ganar seguidores")
        self.esperar(creado["id"], "planning")
        plan = self.editor.vista(creado["id"])
        self.assertEqual(plan["objetivo"], "Reel emotivo para ganar seguidores")
        self.assertEqual(plan["skills"][0]["detalles"], ["Filtro: Cálido"])  # solo lo que no es por defecto

    def test_el_libreto_es_obligatorio(self):
        with self.assertRaisesRegex(ValueError, "libreto es obligatorio"):
            self.editor.planificar([self.video], libreto="  ", recursos=[], ia="no")

    def test_el_error_del_editor_llega_al_panel(self):
        self.video["imported_path"] = "/clips/falla.mov"
        creado = self.editor.planificar([self.video], libreto=LIBRETO, recursos=[], ia="no")
        self.assertEqual(self.esperar(creado["id"], "planning"), "failed")
        self.assertIn("no se inventan tiempos", self.editor.vista(creado["id"])["error"])

    def test_revisar_toma_y_marca_por_proyecto(self):
        revision = self.editor.revisar(self.video)
        self.assertEqual(revision["revision"][0]["nivel"], "ok")
        marca = self.editor.guardar_marca("p1", {"colores": {"amarillo": "#00FF00", "morado": "rojo"},
                                                  "marca_de_agua": True, "cierre": {"texto": "Sígueme", "duracion": 9}})
        self.assertEqual(marca["colores"]["amarillo"], "#00FF00")
        self.assertEqual(marca["colores"]["morado"], "#2E1065")  # un color inválido no se guarda
        self.assertEqual(marca["cierre"]["duracion"], 5.0)

    def test_rechaza_cambios_desconocidos_y_opciones_de_ia(self):
        creado = self.editor.planificar([self.video], libreto=LIBRETO, recursos=[], ia="no")
        self.esperar(creado["id"], "planning")
        with self.assertRaises(ValueError):
            self.editor.editar(creado["id"], {"borrar_todo": True})
        with self.assertRaises(ValueError):
            self.editor.planificar([self.video], libreto=LIBRETO, recursos=[], ia="api-key")

    def test_no_sirve_archivos_fuera_de_las_exportaciones(self):
        creado = self.editor.planificar([self.video], libreto=LIBRETO, recursos=[], ia="no")
        self.esperar(creado["id"], "planning")
        with self.store.transaction(immediate=True) as con:
            con.execute("UPDATE semantic_edits SET output_path=? WHERE id=?", ("/etc/hosts", creado["id"]))
        with self.assertRaises(ValueError):
            self.editor.media(creado["id"])


if __name__ == "__main__":
    unittest.main()
