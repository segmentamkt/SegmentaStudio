"""Skills de edición de Kiko Studio: cada una con sus instrucciones, ajustes y recursos, editables en el panel.

El Director orquesta al resto: al planificar analiza la toma y el objetivo del creador y recomienda qué skills
usar y con qué ajustes; el creador acepta o no cada recomendación. Los ajustes llegan al motor de edición en
`skills.json` (ver remotion/scripts/skills.py, que también valida los valores).
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from multiagent_core import SQLiteStore

_RUTA_MOTOR = Path(__file__).resolve().parents[1] / "remotion" / "scripts" / "skills.py"
_spec = importlib.util.spec_from_file_location("kiko_motor_skills", _RUTA_MOTOR)
motor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(motor)

EXTENSIONES = {
    "image": {".png", ".jpg", ".jpeg", ".webp"},
    "sound": {".wav", ".mp3", ".m4a", ".aiff", ".aif"},
    "music": {".wav", ".mp3", ".m4a", ".aiff", ".aif"},
    "font": {".ttf", ".otf", ".woff", ".woff2"},
    "document": {".txt", ".md", ".docx", ".doc", ".rtf", ".odt"},
}
TIPOS_RECURSO = {"image": "Imagen", "sound": "Sonido", "music": "Música", "font": "Fuente", "document": "Documento"}
TEXTO_DOCUMENTO = 6000  # lo que se le pasa a la IA de cada documento de conocimiento

_SONIDOS = [("whoosh", "Entrada de mapas e imágenes (whoosh)"), ("pop", "Íconos (pop)"),
            ("impacto", "Textos grandes (impacto)"), ("ovacion", "Copa (ovación)"),
            ("clic", "Teclado (clics)"), ("vibracion", "Llamada (vibración)"), ("ping", "Moneda (ping)")]


def _p(clave, etiqueta, tipo, defecto, **extra) -> dict:
    return {"clave": clave, "etiqueta": etiqueta, "tipo": tipo, "defecto": defecto, **extra}


CATALOGO: list[dict] = [
    {
        "id": "director", "nombre": "Director", "icono": "🧠", "rol": "orquestador",
        "descripcion": "Analiza la toma (imagen, audio y contenido) y tu objetivo, y recomienda qué skills usar en "
                       "cada edición y con qué ajustes. Tú decides qué recomendaciones aplicar.",
        "momento": "Al planificar",
        "instrucciones": "Eres el director creativo de Kiko Orator, creador de videos verticales hablados en "
                         "español. Antes de editar analizas la toma y el objetivo del creador y recomiendas qué "
                         "skills usar y con qué ajustes. Prioriza que el mensaje se entienda, que los primeros 3 "
                         "segundos retengan y que el estilo sea coherente con la marca. Explica cada recomendación "
                         "en una frase concreta, basada en lo que mediste.",
        "parametros": [
            _p("nivel", "Cuánto cambia", "opcion", "equilibrado",
               opciones=[["conservador", "Conservador"], ["equilibrado", "Equilibrado"], ["audaz", "Audaz"]]),
            _p("proveedor", "IA preferida", "opcion", "auto",
               opciones=[["auto", "Automática"], ["claude", "Claude"], ["codex", "ChatGPT"], ["gemini", "Gemini"]]),
        ],
        "recursos": ["document"],
        "ayuda_recursos": "Guías de marca, público, tono o referencias: el Director las lee antes de recomendar.",
    },
    {
        "id": "sonido", "nombre": "Sonido", "icono": "🎚️", "momento": "Al renderizar",
        "descripcion": "Limpieza de la voz y música de fondo que baja sola cuando hablas.",
        "instrucciones": "Voz clara y cercana, sin ruido de fondo ni sonido metálico. La música acompaña sin "
                         "competir con la voz.",
        "parametros": [
            _p("limpieza", "Limpiar la voz (aislamiento, EQ, de-esser y compresor)", "bool", True),
            _p("aislamiento", "Aislamiento de voz", "rango", 65, min=0, max=100, paso=5, unidad=" %"),
            _p("musica", "Música de fondo", "bool", True),
            _p("nivel_musica", "Volumen de la música bajo la voz", "rango", -30, min=-36, max=-24, paso=1, unidad=" LUFS"),
            _p("pista", "Pista", "recurso", "", recurso_tipo="music", vacio="Apple Loops (por defecto)"),
        ],
        "recursos": ["music", "document"],
        "ayuda_recursos": "Música sin voz con licencia; elígela en «Pista». La música que pidas en un proyecto tiene prioridad.",
    },
    {
        "id": "efectos", "nombre": "Efectos visuales", "icono": "✨", "momento": "Al planificar",
        "descripcion": "Mapas, íconos, cifras y textos grandes que aparecen con lo que dices.",
        "instrucciones": "Ilustra solo lo que ayuda a entender: lugares, objetos concretos, cifras y la idea "
                         "central. Mejor pocos gráficos claros que muchos.",
        "parametros": [
            _p("componentes", "Gráficos permitidos", "multiple",
               ["mapa_pais", "trofeo", "teclado", "llamada", "moneda", "icono", "texto_cinetico"],
               opciones=[["mapa_pais", "Mapas"], ["trofeo", "Copa"], ["teclado", "Teclado"], ["llamada", "Llamada"],
                         ["moneda", "Moneda"], ["icono", "Íconos"], ["texto_cinetico", "Textos grandes"]]),
            _p("densidad", "Cantidad", "opcion", "alta",
               opciones=[["baja", "Pocos (hasta 3 por minuto)"], ["media", "Algunos (hasta 6 por minuto)"],
                         ["alta", "Todos los que encaje"]]),
            _p("separacion", "Aire entre gráficos", "rango", 0.25, min=0.25, max=1.5, paso=0.05, unidad=" s"),
        ],
        "recursos": ["image", "document"],
        "ayuda_recursos": "Referencias de estilo o guías para el Director. Lo que pide el libreto siempre se respeta.",
    },
    {
        "id": "recortes", "nombre": "Recortes", "icono": "✂️", "momento": "Al planificar",
        "descripcion": "Quita errores, repeticiones, silencios y muletillas, y cuida el aire de cada corte.",
        "instrucciones": "Corta todo lo que no esté en el libreto y deja solo la mejor toma de cada línea. "
                         "Los cortes deben sentirse naturales, sin comerse sílabas.",
        "parametros": [
            _p("aire", "Aire en cada corte", "rango", 0.08, min=0.02, max=0.3, paso=0.01, unidad=" s"),
            _p("aire_inicial", "Pausa antes de la primera palabra", "rango", 0.25, min=0, max=0.6, paso=0.05, unidad=" s"),
            _p("cola_final", "Cola después de la última palabra", "rango", 0.45, min=0.2, max=1.0, paso=0.05, unidad=" s"),
            _p("muletillas", "Quitar muletillas (eh, em, mmm)", "bool", False),
        ],
        "recursos": ["document"],
        "ayuda_recursos": "Notas para el Director sobre qué cortar. Si la desactivas, se usan las tomas completas.",
    },
    {
        "id": "edicion", "nombre": "Edición y ritmo", "icono": "🎬", "momento": "Al planificar",
        "descripcion": "Zoom en los cortes para disimular saltos y movimiento de cámara para dar ritmo.",
        "instrucciones": "Ritmo ágil sin marear: cada corte con un cambio de encuadre sutil.",
        "parametros": [
            _p("zoom_cortes", "Zoom en cada corte", "bool", True),
            _p("intensidad_zoom", "Intensidad del zoom", "rango", 6, min=2, max=15, paso=1, unidad=" %"),
            _p("zoom_lento", "Acercamiento lento durante cada tramo", "bool", False),
        ],
        "recursos": ["document"],
        "ayuda_recursos": "Referencias de ritmo o estilo de edición para el Director.",
    },
    {
        "id": "filtros", "nombre": "Filtros de color", "icono": "🎨", "momento": "Al renderizar",
        "descripcion": "El look de color de la cámara: cálido, frío, cine, vivo, vintage o blanco y negro.",
        "instrucciones": "El color acompaña el tono del mensaje sin alterar el tono de piel.",
        "parametros": [
            _p("preset", "Filtro", "opcion", "natural",
               opciones=[["natural", "Natural (sin filtro)"], ["calido", "Cálido"], ["frio", "Frío"], ["cine", "Cine"],
                         ["vivo", "Vivo"], ["vintage", "Vintage"], ["bn", "Blanco y negro"]]),
            _p("intensidad", "Intensidad", "rango", 60, min=0, max=100, paso=5, unidad=" %"),
        ],
        "recursos": ["image", "document"],
        "ayuda_recursos": "Fotos de referencia del look que buscas: el Director las tiene en cuenta al recomendar.",
    },
    {
        "id": "generador", "nombre": "Generador de imágenes", "icono": "🖼️", "momento": "Al generar imágenes",
        "descripcion": "Crea imágenes con ChatGPT o Gemini para el libreto. Sus instrucciones van en cada imagen.",
        "instrucciones": "Imágenes limpias, con un solo sujeto claro y luz cálida, sin texto. Que se entiendan en "
                         "un segundo dentro de un recuadro pequeño.",
        "parametros": [
            _p("proveedor", "IA", "opcion", "auto",
               opciones=[["auto", "Automática (ChatGPT o Gemini)"], ["ambas", "Las dos, para elegir"],
                         ["codex", "ChatGPT"], ["gemini", "Gemini"]]),
            _p("estilo", "Estilo", "opcion", "foto",
               opciones=[["foto", "Fotografía realista"], ["cine", "Cinematográfico"], ["ilustracion", "Ilustración"],
                         ["3d", "Render 3D"], ["acuarela", "Acuarela"]]),
            _p("usar_referencias", "Enviar mis imágenes de referencia a ChatGPT", "bool", True),
        ],
        "recursos": ["image", "document"],
        "ayuda_recursos": "Imágenes de referencia de estilo (hasta 3 se adjuntan a ChatGPT) y guías visuales.",
    },
    {
        "id": "superposiciones", "nombre": "Superposiciones", "icono": "🧩", "momento": "Al renderizar",
        "descripcion": "Marca de agua, rótulo con tu usuario al inicio y marcos o capas a pantalla completa.",
        "instrucciones": "Que la marca se vea sin tapar la cara ni los botones de las redes.",
        "parametros": [
            _p("posicion_marca", "Posición de la marca de agua", "opcion", "derecha",
               opciones=[["derecha", "Derecha, a media altura"], ["izquierda", "Izquierda, a media altura"],
                         ["abajo", "Abajo a la izquierda"]]),
            _p("opacidad_marca", "Opacidad de la marca de agua", "rango", 80, min=20, max=100, paso=5, unidad=" %"),
            _p("rotulo", "Rótulo al inicio (por ejemplo, @kikoorator)", "texto", "", max=40),
            _p("segundos_rotulo", "Duración del rótulo", "rango", 4, min=2, max=8, paso=0.5, unidad=" s"),
            _p("marco", "Capa a pantalla completa", "recurso", "", recurso_tipo="image", vacio="Ninguna"),
        ],
        "recursos": ["image", "document"],
        "ayuda_recursos": "PNG transparentes de 1080×1920 (marcos, texturas). El logo y la tarjeta final están en la plantilla de marca.",
    },
    {
        "id": "audio_fx", "nombre": "Efectos de audio", "icono": "🔊", "momento": "Al renderizar",
        "descripcion": "Los sonidos que acompañan a cada gráfico, sincronizados con la palabra.",
        "instrucciones": "Sonidos cortos y discretos que marcan el gráfico sin tapar la voz.",
        "parametros": [
            _p("volumen", "Volumen de los efectos", "rango", 100, min=0, max=100, paso=5, unidad=" %"),
            *[_p(clave, etiqueta, "recurso", "", recurso_tipo="sound", vacio="Sintetizado (por defecto)")
              for clave, etiqueta in _SONIDOS],
        ],
        "recursos": ["sound", "document"],
        "ayuda_recursos": "Tus propios efectos (WAV o MP3 cortos, con licencia): asígnalos a cada tipo de gráfico.",
    },
    {
        "id": "subtitulos", "nombre": "Subtítulos", "icono": "💬", "momento": "Al renderizar",
        "descripcion": "Tarjetas de 2 a 4 palabras con la palabra clave resaltada. El SRT se exporta siempre.",
        "instrucciones": "Subtítulos que se lean de un vistazo, cortados por sentido y nunca sobre la cara.",
        "parametros": [
            _p("mayusculas", "En mayúsculas", "bool", True),
            _p("resaltado", "Color de la palabra clave", "opcion", "marca",
               opciones=[["marca", "Color de la marca"], ["blanco", "Blanco"], ["verde", "Verde"], ["cian", "Cian"],
                         ["rosa", "Rosa"], ["naranja", "Naranja"]]),
            _p("tamano", "Tamaño", "rango", 100, min=80, max=125, paso=5, unidad=" %"),
            _p("posicion", "Posición", "opcion", "media",
               opciones=[["alta", "Más arriba"], ["media", "Debajo de la barbilla"], ["baja", "Más abajo"]]),
            _p("fuente", "Tipografía", "recurso", "", recurso_tipo="font", vacio="Inter (por defecto)"),
        ],
        "recursos": ["font", "document"],
        "ayuda_recursos": "Tipografías TTF, OTF o WOFF con licencia para usarlas en video.",
    },
    {
        "id": "retoques", "nombre": "Retoques", "icono": "🪄", "momento": "Al renderizar",
        "descripcion": "Brillo, contraste, nitidez, suavizado de piel y viñeta sobre la cámara.",
        "instrucciones": "Retoques sutiles: que se vea mejor sin que se note el retoque.",
        "parametros": [
            _p("brillo", "Brillo", "rango", 0, min=-20, max=20, paso=1, unidad=" %"),
            _p("contraste", "Contraste", "rango", 0, min=-20, max=20, paso=1, unidad=" %"),
            _p("nitidez", "Nitidez", "rango", 0, min=0, max=100, paso=5, unidad=" %"),
            _p("suavizado", "Suavizado de piel", "rango", 0, min=0, max=100, paso=5, unidad=" %"),
            _p("vineta", "Viñeta", "rango", 0, min=0, max=100, paso=5, unidad=" %"),
        ],
        "recursos": ["image", "document"],
        "ayuda_recursos": "Fotos de referencia del acabado que buscas, para el Director. Nitidez y suavizado hacen el render más lento.",
    },
]
POR_ID = {s["id"]: s for s in CATALOGO}


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _defectos(skill: dict) -> dict:
    return {p["clave"]: p["defecto"] for p in skill["parametros"]}


class SkillStore:
    def __init__(self, store: SQLiteStore, data_dir: Path) -> None:
        self.store = store
        self.carpeta = data_dir / "skills"
        with self.store.transaction(immediate=True) as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS skills(
                    skill_id TEXT PRIMARY KEY, activa INTEGER NOT NULL DEFAULT 1, instrucciones TEXT,
                    ajustes TEXT NOT NULL DEFAULT '{}', director_ajusta INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS skill_resources(
                    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
                    path TEXT NOT NULL, license TEXT NOT NULL, texto TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_skill_resources_skill ON skill_resources(skill_id, created_at);
                """
            )

    # --- Lectura ------------------------------------------------------------------------------

    def _guardada(self, skill_id: str) -> dict:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT * FROM skills WHERE skill_id=?", (skill_id,)).fetchone()
        return dict(fila) if fila else {}

    def recursos(self, skill_id: str) -> list[dict]:
        with self.store.lock:
            filas = self.store.connection.execute(
                "SELECT * FROM skill_resources WHERE skill_id=? ORDER BY created_at", (skill_id,)
            ).fetchall()
        return [dict(f) for f in filas]

    def obtener(self, skill_id: str) -> dict:
        base = POR_ID.get(skill_id)
        if not base:
            raise ValueError("La skill no existe")
        guardada = self._guardada(skill_id)
        recursos = self.recursos(skill_id)
        motor_recursos = [{"id": r["id"], "tipo": r["kind"]} for r in recursos]
        ajustes = _defectos(base)
        # Lo guardado se revalida: si borraste un recurso que estaba elegido, vuelve al valor por defecto.
        ajustes.update(motor.validar_ajustes({"parametros": base["parametros"], "recursos": motor_recursos},
                                             json.loads(guardada.get("ajustes") or "{}"), estricto=False))
        return {
            **{k: v for k, v in base.items() if k != "instrucciones"},
            "activa": bool(guardada.get("activa", 1)),
            "instrucciones": guardada.get("instrucciones") or base["instrucciones"],
            "instrucciones_por_defecto": base["instrucciones"],
            "personalizada": bool(guardada.get("instrucciones")) or bool(json.loads(guardada.get("ajustes") or "{}")),
            "ajustes": ajustes,
            "director_ajusta": bool(guardada.get("director_ajusta", 1)),
            "recursos_cargados": [{"id": r["id"], "tipo": r["kind"], "nombre": r["name"], "licencia": r["license"],
                                   "tipo_nombre": TIPOS_RECURSO[r["kind"]], "url": f"/media/skill/{r['id']}"}
                                  for r in recursos],
            "tipos_recurso": [[t, TIPOS_RECURSO[t]] for t in base["recursos"]],
        }

    def listar(self) -> list[dict]:
        return [self.obtener(s["id"]) for s in CATALOGO]

    def para_motor(self) -> dict:
        """Copia completa para un plan: lo que el motor y el Director necesitan, con rutas y textos."""
        skills = {}
        for skill in self.listar():
            recursos = [{"id": r["id"], "nombre": r["name"], "tipo": r["kind"], "ruta": r["path"],
                         "licencia": r["license"], **({"texto": r["texto"]} if r.get("texto") else {})}
                        for r in self.recursos(skill["id"])]
            skills[skill["id"]] = {
                "nombre": skill["nombre"], "descripcion": skill["descripcion"], "activa": skill["activa"],
                "instrucciones": skill["instrucciones"], "ajustes": skill["ajustes"],
                "director_ajusta": skill["director_ajusta"], "parametros": skill["parametros"], "recursos": recursos,
            }
        return {"version": 1, "skills": skills}

    # --- Escritura ----------------------------------------------------------------------------

    def guardar(self, skill_id: str, body: dict) -> dict:
        base = POR_ID.get(skill_id)
        if not base:
            raise ValueError("La skill no existe")
        actual = self.obtener(skill_id)
        recursos = [{"id": r["id"], "tipo": r["tipo"]} for r in actual["recursos_cargados"]]
        ajustes = {**actual["ajustes"], **motor.validar_ajustes({"parametros": base["parametros"], "recursos": recursos,
                                                                  "nombre": base["nombre"]}, body.get("ajustes") or {})}
        instrucciones = str(body.get("instrucciones", actual["instrucciones"])).strip()[:4000]
        if not instrucciones:
            raise ValueError("Las instrucciones no pueden quedar vacías; usa «Restablecer» para volver a las originales")
        activa = body.get("activa", actual["activa"])
        director_ajusta = body.get("director_ajusta", actual["director_ajusta"])
        if not isinstance(activa, bool) or not isinstance(director_ajusta, bool):
            raise ValueError("«Activa» y «el Director puede ajustarla» deben ser sí o no")
        with self.store.transaction(immediate=True) as con:
            con.execute(
                "INSERT INTO skills(skill_id,activa,instrucciones,ajustes,director_ajusta,updated_at) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(skill_id) DO UPDATE SET activa=excluded.activa, instrucciones=excluded.instrucciones, "
                "ajustes=excluded.ajustes, director_ajusta=excluded.director_ajusta, updated_at=excluded.updated_at",
                (skill_id, int(activa), None if instrucciones == base["instrucciones"] else instrucciones,
                 json.dumps({k: v for k, v in ajustes.items() if v != _defectos(base)[k]}, ensure_ascii=False),
                 int(director_ajusta), _ahora()),
            )
        return self.obtener(skill_id)

    def instantanea(self, skill_id: str) -> dict:
        """Lo guardado de una skill tal cual (vacío si está de fábrica), para poder deshacer un cambio."""
        return {k: v for k, v in self._guardada(skill_id).items() if k != "updated_at"}

    def restaurar(self, skill_id: str, guardada: dict) -> dict:
        if skill_id not in POR_ID:
            raise ValueError("La skill no existe")
        with self.store.transaction(immediate=True) as con:
            con.execute("DELETE FROM skills WHERE skill_id=?", (skill_id,))
            if guardada:
                con.execute("INSERT INTO skills(skill_id,activa,instrucciones,ajustes,director_ajusta,updated_at) VALUES(?,?,?,?,?,?)",
                            (skill_id, guardada["activa"], guardada["instrucciones"], guardada["ajustes"],
                             guardada["director_ajusta"], _ahora()))
        return self.obtener(skill_id)

    def restablecer(self, skill_id: str) -> dict:
        if skill_id not in POR_ID:
            raise ValueError("La skill no existe")
        with self.store.transaction(immediate=True) as con:
            con.execute("DELETE FROM skills WHERE skill_id=?", (skill_id,))
        return self.obtener(skill_id)

    def importar_recurso(self, skill_id: str, kind: str, original_name: str, temporal: Path, licencia: str) -> dict:
        base = POR_ID.get(skill_id)
        if not base:
            raise ValueError("La skill no existe")
        if kind not in base["recursos"]:
            raise ValueError(f"{base['nombre']} no usa recursos de tipo «{TIPOS_RECURSO.get(kind, kind)}»")
        extension = Path(original_name).suffix.lower()
        if extension not in EXTENSIONES[kind]:
            raise ValueError(f"Para «{TIPOS_RECURSO[kind]}» usa: {', '.join(sorted(EXTENSIONES[kind]))}")
        licencia = " ".join(str(licencia).split())[:120]
        if not licencia:
            raise ValueError("Indica la licencia o el origen del recurso")
        texto = None
        if kind == "document":
            texto = self._texto(temporal, extension)
            if not texto:
                raise ValueError("El documento está vacío o no se pudo leer")
        ident = str(uuid4())
        carpeta = self.carpeta / skill_id
        carpeta.mkdir(parents=True, exist_ok=True)
        destino = carpeta / f"{kind}-{ident[:8]}{extension}"
        shutil.copy2(temporal, destino)
        with self.store.transaction(immediate=True) as con:
            con.execute(
                "INSERT INTO skill_resources(id,skill_id,kind,name,path,license,texto,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (ident, skill_id, kind, Path(original_name).name, str(destino), licencia, texto, _ahora()),
            )
        return self.obtener(skill_id)

    @staticmethod
    def _texto(ruta: Path, extension: str) -> str:
        if extension in {".txt", ".md"}:
            texto = ruta.read_text(encoding="utf-8", errors="replace")
        else:
            proceso = subprocess.run(["textutil", "-convert", "txt", "-stdout", str(ruta)], capture_output=True, text=True)
            texto = proceso.stdout if proceso.returncode == 0 else ""
        return texto.strip()[:TEXTO_DOCUMENTO]

    def borrar_recurso(self, resource_id: str) -> dict:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT * FROM skill_resources WHERE id=?", (resource_id,)).fetchone()
        if not fila:
            raise ValueError("El recurso no existe")
        Path(fila["path"]).unlink(missing_ok=True)
        with self.store.transaction(immediate=True) as con:
            con.execute("DELETE FROM skill_resources WHERE id=?", (resource_id,))
        return self.obtener(fila["skill_id"])

    def media(self, resource_id: str) -> tuple[Path, str]:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT path, name FROM skill_resources WHERE id=?", (resource_id,)).fetchone()
        ruta = Path(fila["path"]).resolve() if fila else None
        if not ruta or self.carpeta.resolve() not in ruta.parents or not ruta.is_file():
            raise ValueError("El recurso no está disponible")
        return ruta, fila["name"]
