"""Editor semántico desde el panel: revisar tomas → libreto → planificar → revisar → vista previa → render.

La lógica editorial vive en remotion/ (libreto, planificador, montaje, IA validada, Remotion). Este módulo solo
la orquesta para Kiko Studio: lanza cada paso en segundo plano, traduce sus líneas «@@progreso» a la barra
del panel, guarda cada edición en SQLite y prepara una vista del plan para revisarlo antes de renderizar.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from multiagent_core import SQLiteStore
from kiko_studio.skills import motor as motor_skills

REMOTION = Path(__file__).resolve().parents[1] / "remotion"
EDITOR = REMOTION / "scripts" / "editor.py"
PREFIJO_PROGRESO = "@@progreso "
PREFIJO_REVISION = "@@revision "
PALABRAS_MINIMAS_LIBRETO = 5
# Cambios que acepta «editar»: los del panel de revisión y las herramientas de las skills.
CAMBIOS_PERMITIDOS = {"quitar", "textos", "agregar_textos", "montaje", "ajustes", "skills", "skills_base",
                      "recomendaciones_aplicadas", "iconos", "sin_sonido", "agregar_eventos", "recursos_nuevos",
                      "quitar_frases", "recuperar_frases", "zoom_frases", "quitar_zoom", "corregir"}

Progreso = Callable[..., None]  # (progress_id, percent, stage, message, status="running")

NOMBRES = {
    "mapa_pais": "Mapa", "trofeo": "Copa", "teclado": "Teclado", "llamada": "Llamada", "moneda": "Moneda",
    "icono": "Ícono", "texto_cinetico": "Texto grande", "imagen": "Imagen", "sonido": "Sonido",
}
COLORES_KIKO = {"morado": "#2E1065", "violeta": "#7C3AED", "amarillo": "#FFD400"}


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SemanticEditor:
    def __init__(self, store: SQLiteStore, data_dir: Path, progreso: Progreso) -> None:
        self.store = store
        self.exports = data_dir / "exports" / "semantic"
        self.progreso = progreso
        self.render_lock = threading.Lock()  # un render a la vez: Remotion ya usa todos los núcleos
        self._revisiones: dict[tuple[str, float], dict] = {}
        with self.store.transaction(immediate=True) as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS semantic_edits(
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, video_id TEXT NOT NULL,
                    name TEXT NOT NULL, workdir TEXT NOT NULL, status TEXT NOT NULL,
                    output_path TEXT, qc TEXT NOT NULL DEFAULT '{}', error TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_semantic_edits_project ON semantic_edits(project_id, created_at);
                CREATE TABLE IF NOT EXISTS semantic_brand(
                    project_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            columnas = {fila["name"] for fila in con.execute("PRAGMA table_info(semantic_edits)").fetchall()}
            for columna, tipo in {"video_ids": "TEXT", "vista_path": "TEXT", "vista_inicio": "REAL",
                                  "srt_path": "TEXT", "thumb_path": "TEXT"}.items():
                if columna not in columnas:
                    con.execute(f"ALTER TABLE semantic_edits ADD COLUMN {columna} {tipo}")

    # --- Estado -------------------------------------------------------------------------------

    def disponible(self) -> dict:
        listo = EDITOR.is_file() and (REMOTION / "node_modules" / "remotion").is_dir()
        return {"ready": listo, "detail": "Remotion instalado" if listo else "Falta instalar remotion/ (npm install)"}

    def listar(self) -> list[dict]:
        with self.store.lock:
            filas = self.store.connection.execute(
                "SELECT * FROM semantic_edits ORDER BY created_at DESC LIMIT 30"
            ).fetchall()
        return [self._fila(fila) for fila in filas]

    def _fila(self, fila) -> dict:
        item = dict(fila)
        item["qc"] = json.loads(item.get("qc") or "{}")
        item["video_ids"] = json.loads(item.get("video_ids") or "[]") or [item["video_id"]]
        base = f"/media/semantic/{item['id']}"
        item["output_url"] = f"{base}/output" if item.get("output_path") else None
        item["vista_url"] = f"{base}/vista" if item.get("vista_path") else None
        item["srt_url"] = f"{base}/srt" if item.get("srt_path") else None
        item["miniatura_url"] = f"{base}/miniatura" if item.get("thumb_path") else None
        for privado in ("workdir", "output_path", "vista_path", "srt_path", "thumb_path"):
            item.pop(privado, None)
        return item

    def _obtener(self, edit_id: str) -> dict:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT * FROM semantic_edits WHERE id=?", (edit_id,)).fetchone()
        if not fila:
            raise ValueError("La edición semántica no existe")
        return dict(fila)

    def _actualizar(self, edit_id: str, **campos) -> None:
        campos["updated_at"] = _ahora()
        columnas = ", ".join(f"{nombre}=?" for nombre in campos)
        with self.store.transaction(immediate=True) as con:
            con.execute(f"UPDATE semantic_edits SET {columnas} WHERE id=?", (*campos.values(), edit_id))

    def media(self, edit_id: str, tipo: str = "output") -> tuple[Path, str]:
        columna = {"output": "output_path", "vista": "vista_path", "srt": "srt_path", "miniatura": "thumb_path"}.get(tipo)
        if not columna:
            raise ValueError("Archivo no disponible")
        ruta = Path(self._obtener(edit_id).get(columna) or "").resolve()
        if self.exports.resolve() not in ruta.parents or not ruta.is_file():
            raise ValueError("El archivo todavía no está disponible")
        return ruta, ruta.name

    # --- Marca por proyecto -----------------------------------------------------------------------

    def marca(self, project_id: str) -> dict:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT data FROM semantic_brand WHERE project_id=?", (project_id,)).fetchone()
        datos = json.loads(fila["data"]) if fila else {}
        return {"colores": {**COLORES_KIKO, **datos.get("colores", {})}, "logo_asset_id": datos.get("logo_asset_id"),
                "marca_de_agua": bool(datos.get("marca_de_agua")),
                "cierre": {"texto": datos.get("cierre", {}).get("texto", ""), "duracion": datos.get("cierre", {}).get("duracion", 2.5)}}

    def guardar_marca(self, project_id: str, body: dict) -> dict:
        colores = {clave: valor for clave, valor in (body.get("colores") or {}).items()
                   if clave in COLORES_KIKO and isinstance(valor, str) and len(valor) == 7 and valor.startswith("#")}
        cierre = body.get("cierre") or {}
        datos = {
            "colores": colores, "logo_asset_id": body.get("logo_asset_id") or None,
            "marca_de_agua": bool(body.get("marca_de_agua")),
            "cierre": {"texto": str(cierre.get("texto", "")).strip()[:80],
                       "duracion": max(1.0, min(5.0, float(cierre.get("duracion") or 2.5)))},
        }
        with self.store.transaction(immediate=True) as con:
            con.execute(
                "INSERT INTO semantic_brand(project_id,data,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (project_id, json.dumps(datos, ensure_ascii=False), _ahora()),
            )
        return self.marca(project_id)

    # --- Revisión de tomas y libreto ------------------------------------------------------------

    def revisar(self, video: dict) -> dict:
        """Formato, audio y silencio inicial de una toma (en caché mientras el archivo no cambie)."""
        ruta = Path(video["imported_path"])
        clave = (str(ruta), ruta.stat().st_mtime)
        if clave not in self._revisiones:
            salida = self._ejecutar(["revisar", "--clip", str(ruta)], "", recoger=PREFIJO_REVISION)
            self._revisiones[clave] = json.loads(salida or "{}")
        return {"video_id": video["id"], "name": video["original_name"], **self._revisiones[clave]}

    @staticmethod
    def leer_libreto(archivo: Path, nombre: str) -> str:
        """Convierte un libreto .docx/.rtf/.doc/.odt a texto con textutil (macOS); .txt y .md se leen directo."""
        if Path(nombre).suffix.lower() in {".docx", ".doc", ".rtf", ".odt"}:
            proceso = subprocess.run(["textutil", "-convert", "txt", "-stdout", str(archivo)], capture_output=True, text=True)
            if proceso.returncode != 0:
                raise ValueError("No pude leer el libreto; guárdalo como .docx, .rtf o .txt")
            return proceso.stdout.strip()
        if Path(nombre).suffix.lower() in {".txt", ".md", ""}:
            return archivo.read_text(encoding="utf-8", errors="replace").strip()
        raise ValueError("Sube el libreto como .txt, .md, .docx o .rtf")

    # --- Pasos (en segundo plano) ------------------------------------------------------------------

    def planificar(self, videos: list[dict], *, libreto: str, recursos: list[dict], ia: str,
                   skills: dict | None = None, objetivo: str = "") -> dict:
        if ia not in {"auto", "claude", "codex", "gemini", "no"}:
            raise ValueError("Opción de IA no válida")
        if not videos:
            raise ValueError("Elige al menos una toma")
        if len({v["project_id"] for v in videos}) != 1:
            raise ValueError("Todas las tomas deben ser del mismo proyecto")
        if len(libreto.split()) < PALABRAS_MINIMAS_LIBRETO:
            raise ValueError("El libreto es obligatorio: pega o sube el texto que dices en las tomas")
        if not self.disponible()["ready"]:
            raise RuntimeError(self.disponible()["detail"])
        edit_id = str(uuid4())
        nombre = f"kiko-{edit_id[:8]}"
        carpeta = REMOTION / "trabajo" / nombre
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / "libreto.txt").write_text(libreto, encoding="utf-8")
        (carpeta / "recursos.json").write_text(json.dumps(recursos, ensure_ascii=False), encoding="utf-8")
        if skills:
            (carpeta / "skills.json").write_text(json.dumps(skills, ensure_ascii=False), encoding="utf-8")
        titulo = videos[0]["original_name"] + (f" + {len(videos) - 1} tomas" if len(videos) > 1 else "")
        with self.store.transaction(immediate=True) as con:
            con.execute(
                "INSERT INTO semantic_edits(id,project_id,video_id,video_ids,name,workdir,status) VALUES(?,?,?,?,?,?,?)",
                (edit_id, videos[0]["project_id"], videos[0]["id"], json.dumps([v["id"] for v in videos]), titulo, nombre, "planning"),
            )
        argumentos = ["planificar", "--clip", *[v["imported_path"] for v in videos], "--nombre", nombre, "--ia", ia,
                      "--libreto", str(carpeta / "libreto.txt"), "--recursos", str(carpeta / "recursos.json")]
        if skills:
            argumentos += ["--skills", str(carpeta / "skills.json")]
        if objetivo.strip():
            argumentos += ["--objetivo", " ".join(objetivo.split())[:600]]
        self._en_segundo_plano(edit_id, argumentos, "planned")
        return self._fila(self._obtener(edit_id))

    def editar(self, edit_id: str, cambios: dict) -> dict:
        fila = self._obtener(edit_id)
        if fila["status"] in {"planning", "rendering", "previewing"}:
            raise ValueError("Espera a que termine el paso en curso")
        self._editar_plan(self._plan(fila), cambios)
        self._plan_cambiado(edit_id)
        return self.vista(edit_id)

    def simular(self, edit_id: str, cambios: dict) -> tuple[dict, dict]:
        """Prueba cambios en una copia del plan: (plan actual, plan como quedaría). El plan real no se toca."""
        ruta = self._plan(self._obtener(edit_id))
        with tempfile.TemporaryDirectory() as temporal:
            copia = Path(temporal) / ruta.parent.name / ruta.name
            copia.parent.mkdir()
            shutil.copy2(ruta, copia)
            self._editar_plan(copia, cambios)
            return json.loads(ruta.read_text(encoding="utf-8")), json.loads(copia.read_text(encoding="utf-8"))

    def leer_plan(self, edit_id: str) -> dict:
        return json.loads(self.ruta_plan(edit_id).read_text(encoding="utf-8"))

    def ruta_plan(self, edit_id: str) -> Path:
        return self._plan(self._obtener(edit_id))

    def restaurar_plan(self, edit_id: str, copia: Path) -> dict:
        """Vuelve el plan a una copia guardada antes de un cambio (deshacer)."""
        fila = self._obtener(edit_id)
        if fila["status"] in {"planning", "rendering", "previewing"}:
            raise ValueError("Espera a que termine el paso en curso")
        shutil.copy2(copia, self._plan(fila))
        self._plan_cambiado(edit_id)
        return self.vista(edit_id)

    def _editar_plan(self, ruta: Path, cambios: dict) -> None:
        if not isinstance(cambios, dict) or set(cambios) - CAMBIOS_PERMITIDOS:
            raise ValueError("Cambios no válidos")
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as archivo:
            json.dump(cambios, archivo, ensure_ascii=False)
        try:
            self._ejecutar(["editar", "--plan", str(ruta), "--cambios", archivo.name], "")
        except RuntimeError as exc:
            raise ValueError(str(exc)) from None
        finally:
            Path(archivo.name).unlink(missing_ok=True)

    def _plan_cambiado(self, edit_id: str) -> None:
        # El plan cambió: la vista previa y el video anteriores ya no lo representan.
        self._actualizar(edit_id, status="planned", output_path=None, vista_path=None, srt_path=None, thumb_path=None,
                         qc="{}", error=None)

    def vista_previa(self, edit_id: str, *, inicio: str, marca: dict | None) -> dict:
        return self._render(edit_id, marca, previa=inicio or "auto")

    def render(self, edit_id: str, *, marca: dict | None) -> dict:
        return self._render(edit_id, marca, previa=None)

    def _render(self, edit_id: str, marca: dict | None, previa: str | None) -> dict:
        fila = self._obtener(edit_id)
        if fila["status"] in {"planning", "rendering", "previewing"}:
            raise ValueError("Esta edición ya se está procesando")
        if not self.render_lock.acquire(blocking=False):
            raise ValueError("Ya hay otro video renderizándose; espera a que termine")
        try:
            argumentos = ["render", "--plan", str(self._plan(fila))]
            if marca:
                ruta_marca = REMOTION / "trabajo" / fila["workdir"] / "marca.json"
                ruta_marca.write_text(json.dumps(marca, ensure_ascii=False), encoding="utf-8")
                argumentos += ["--marca", str(ruta_marca)]
            if previa:
                argumentos += ["--vista-previa", previa]
            self._actualizar(edit_id, status="previewing" if previa else "rendering", error=None)
            self._en_segundo_plano(edit_id, argumentos, "planned" if previa else "ready",
                                   al_terminar=self._guardar_render, liberar=True)
        except Exception:
            self.render_lock.release()  # si el hilo no llegó a arrancar, nadie más liberaría el candado
            raise
        return self._fila(self._obtener(edit_id))

    def _guardar_render(self, edit_id: str, argumentos: list[str]) -> dict:
        fila = self._obtener(edit_id)
        nombre = fila["workdir"]
        self.exports.mkdir(parents=True, exist_ok=True)
        if "--vista-previa" in argumentos:
            destino = self.exports / f"{nombre}_vista.mp4"
            shutil.copy2(REMOTION / "out" / f"{nombre}_vista.mp4", destino)
            vista = json.loads((REMOTION / "trabajo" / nombre / "vista.json").read_text(encoding="utf-8"))
            return {"vista_path": str(destino), "vista_inicio": vista["inicio"]}
        campos = {}
        for sufijo, columna in ((".mp4", "output_path"), (".srt", "srt_path"), (".jpg", "thumb_path")):
            origen = REMOTION / "out" / f"{nombre}{sufijo}"
            if origen.is_file():
                shutil.copy2(origen, self.exports / origen.name)
                campos[columna] = str(self.exports / origen.name)
        qc = json.loads((REMOTION / "trabajo" / nombre / "qc.json").read_text(encoding="utf-8"))
        campos["qc"] = json.dumps({"aprobado": qc["aprobado"], "duracion_s": qc["duracion_s"],
                                   "loudness_lufs": qc["loudness_lufs"]}, ensure_ascii=False)
        return campos

    def _en_segundo_plano(self, edit_id: str, argumentos: list[str], estado_final: str, *,
                          al_terminar: Callable[[str, list[str]], dict] | None = None, liberar: bool = False) -> None:
        """Corre un paso largo en un hilo: el panel sigue usable y consulta el progreso por el id de la edición."""
        def trabajo() -> None:
            try:
                self._ejecutar(argumentos, edit_id)
                campos = al_terminar(edit_id, argumentos) if al_terminar else {}
                self._actualizar(edit_id, status=estado_final, error=None, **campos)
            except Exception as exc:  # el error llega al panel con el mensaje del editor
                self._actualizar(edit_id, status="failed", error=str(exc)[:500])
                self.progreso(edit_id, 0, "failed", str(exc)[:300], "failed")
            finally:
                if liberar:
                    self.render_lock.release()

        threading.Thread(target=trabajo, name=f"semantic-{edit_id[:8]}", daemon=True).start()

    def _plan(self, fila: dict) -> Path:
        ruta = REMOTION / "trabajo" / fila["workdir"] / "plan_edicion.json"
        if not ruta.is_file():
            raise ValueError("No se encuentra el plan de esta edición")
        return ruta

    def _ejecutar(self, argumentos: list[str], progress_id: str, *, recoger: str | None = None) -> str | None:
        """Corre un paso del editor y reenvía su progreso; los errores llegan con el mensaje del editor."""
        ultimas: list[str] = []
        recogido = None
        con_descargas = argumentos[0] != "revisar"
        with subprocess.Popen(
            [sys.executable, str(EDITOR), *argumentos, *(["--sin-descargas"] if con_descargas else [])], cwd=REMOTION,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        ) as proceso:
            for linea in proceso.stdout:
                if linea.startswith(PREFIJO_PROGRESO):
                    porcentaje, etapa, mensaje = linea[len(PREFIJO_PROGRESO):].rstrip("\n").split("|", 2)
                    self.progreso(progress_id, int(porcentaje), etapa, mensaje, "complete" if etapa == "complete" else "running")
                elif recoger and linea.startswith(recoger):
                    recogido = linea[len(recoger):].strip()
                elif linea.strip():
                    ultimas = (ultimas + [linea.rstrip()])[-12:]
        if proceso.returncode != 0:
            detalle = next((l for l in reversed(ultimas) if not l.startswith(("Traceback", "  "))), "error desconocido")
            raise RuntimeError(detalle[:500])
        return recogido

    # --- Vista para el panel ------------------------------------------------------------------

    def vista(self, edit_id: str) -> dict:
        fila = self._obtener(edit_id)
        item = self._fila(fila)
        ruta = REMOTION / "trabajo" / fila["workdir"] / "plan_edicion.json"
        if not ruta.is_file():
            return item
        plan = json.loads(ruta.read_text(encoding="utf-8"))
        montaje = plan.get("montaje", {})
        sugerencia = plan.get("sugerencias_montaje") or {}
        fuente = plan.get("palabras_fuente") or plan["palabras"]
        guia = plan.get("libreto")
        item.update({
            "duracion": plan["duracion"],
            "duracion_original": round(sum(max((p["fin"] for p in fuente if p.get("clip", 0) == k), default=0)
                                           for k in {p.get("clip", 0) for p in fuente}), 1),
            "palabras": len(plan["palabras"]),
            "tomas": len(plan.get("fuente", {}).get("originales") or [1]),
            "ia": plan.get("ia", {}),
            "transcripcion": " ".join(p["texto"] for p in plan["palabras"]),
            # Palabras de las tomas originales ([texto, inicio, fin, toma]): el panel mueve los cortes palabra a
            # palabra y reproduce cada corte desde el original sin volver a renderizar.
            "palabras_fuente": [[p["texto"], p["inicio"], p["fin"], p.get("clip", 0)] for p in fuente],
            "libreto": ({"cobertura": guia["cobertura"], "faltan": guia["faltan"], "avisos": guia["avisos"],
                         "fuera_del_libreto": guia["fuera_del_libreto"],
                         "repetidas": [{"n": l["n"], "texto": l["texto"], "veces": len(l["otras_tomas"]) + 1}
                                       for l in guia["lineas"] if l.get("otras_tomas")],
                         "lineas": len(guia["lineas"])} if guia else None),
            "montaje": {
                "eleccion": montaje.get("eleccion"),
                "segmentos": [{"desde_i": a, "hasta_i": b, "toma": fuente[a].get("clip", 0) + 1}
                              for a, b in montaje.get("segmentos", [])],
                "tramos": [{"desde": t["desde"], "hasta": t["hasta"], "salida": t["salida"], "texto": t["texto"],
                            "toma": t.get("clip", 0) + 1} for t in montaje.get("tramos", [])],
                "eliminados": montaje.get("eliminados", []),
            },
            "repeticiones": sugerencia.get("repeticiones", []),
            "opciones_montaje": {clave: valor["descripcion"] for clave, valor in sugerencia.get("opciones", {}).items()},
            "eventos": [self._evento(e) for e in plan["eventos"]],
            "correcciones": plan.get("correcciones", []),
            "descartados": plan.get("descartados", []),
            "recursos": plan.get("recursos", []),
            "musica": plan.get("musica", {}),
            "camara": [z.get("motivo", "") for z in plan.get("camara", {}).get("zoom", [])],
            "objetivo": plan.get("objetivo", ""),
            "director": plan.get("director"),
            "skills": self._skills(plan.get("skills") or {}),
        })
        return item

    @staticmethod
    def _skills(skills: dict) -> list[dict]:
        """Las skills con que se arma esta edición, con sus ajustes en palabras (los que no son por defecto)."""
        resumen = []
        for skill_id, skill in skills.items():
            cambiados = [p for p in skill.get("parametros", []) if skill["ajustes"].get(p["clave"]) != p["defecto"]]
            resumen.append({
                "id": skill_id, "nombre": skill.get("nombre", skill_id), "activa": skill.get("activa", True),
                "ajustes": skill["ajustes"],
                "detalles": [motor_skills.resumen_ajuste(skill, p["clave"], skill["ajustes"][p["clave"]]) for p in cambiados],
            })
        return resumen

    @staticmethod
    def _evento(evento: dict) -> dict:
        params = evento.get("params", {})
        detalle = (params.get("nombre") if evento["componente"] in {"mapa_pais", "llamada"}
                   else params.get("recurso") if evento["componente"] in {"imagen", "sonido"} else params.get("icono"))
        return {
            "id": evento["id"], "componente": evento["componente"],
            "nombre": NOMBRES.get(evento["componente"], evento["componente"]) + (f" · {detalle}" if detalle else ""),
            "inicio": evento["inicio"], "fin": evento["fin"], "dice": evento["ancla"]["texto"],
            "texto": params.get("texto"), "texto_editable": evento["componente"] in {"texto_cinetico", "trofeo"},
            "ajuste_inicio": params.get("ajuste_inicio", 0), "duracion_manual": params.get("duracion"),
            "sonido": ", ".join(sorted({s["archivo"].split("/")[-1].rsplit(".", 1)[0] for s in evento.get("sonidos", [])})),
            "justificacion": evento.get("justificacion", ""), "fuente": evento.get("fuente", ""),
            "verificar": evento.get("verificar"),
        }
