"""Imágenes generadas con IA para el editor semántico, con las sesiones autorizadas y sin claves API.

Codex (dentro de la app de ChatGPT) y Gemini (a través de Antigravity) traen su propio generador de
imágenes; Claude no lo tiene en su CLI. Kiko les pide una imagen, la recoge, comprueba que sea una imagen
válida y la deja como propuesta: solo entra en los recursos del proyecto cuando la apruebas, con la
licencia anotada. Cada proveedor genera una imagen a la vez; «auto» reparte entre los dos y, si uno falla,
lo intenta con el otro.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from multiagent_core import SQLiteStore

CODEX = Path("/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex")
CODEX_IMAGENES = Path.home() / ".codex" / "generated_images"
ANTIGRAVITY_BRAIN = Path.home() / ".gemini" / "antigravity-cli" / "brain"
TIEMPO_MAXIMO = 300          # segundos por imagen
ESPERA_ANTIGRAVITY = 150     # su subagente de imágenes puede terminar después de que responda el agente
LADO_MINIMO = 512
EXTENSIONES = {".png", ".jpg", ".jpeg", ".webp"}

# En el panel se llama ChatGPT: es su generador de imágenes, al que Kiko llega a través del Codex de esa app.
PROVEEDORES = {"codex": "ChatGPT", "gemini": "Gemini (Antigravity)"}
ESTILOS = {
    "foto": "fotografía realista, iluminación cuidada, profundidad de campo",
    "ilustracion": "ilustración digital plana, colores vivos y formas simples",
    "3d": "render 3D estilizado, iluminación de estudio suave",
    "acuarela": "acuarela suave con textura de papel",
    "cine": "fotograma cinematográfico, contraste dramático y tonos cálidos",
}


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def nombre_de_archivo(nombre: str) -> str:
    """«Biblia antigua.png» → «biblia-antigua»: el nombre con el que el libreto pide la imagen."""
    base = unicodedata.normalize("NFD", Path(nombre.strip()).stem.lower())
    base = "".join(c for c in base if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:60]


def medir(ruta: Path) -> tuple[int, int, str]:
    """Ancho, alto y formato con sips (macOS); falla si el archivo no es una imagen."""
    proceso = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", str(ruta)],
                             capture_output=True, text=True)
    datos = dict(re.findall(r"^\s+(\w+): (\S+)$", proceso.stdout, re.M))
    if proceso.returncode != 0 or "pixelWidth" not in datos:
        raise RuntimeError("La IA no devolvió una imagen válida")
    return int(datos["pixelWidth"]), int(datos["pixelHeight"]), datos.get("format", "")


class ImageGenerator:
    def __init__(self, store: SQLiteStore, data_dir: Path, *, ejecutables: Callable[[], dict[str, str]],
                 importar: Callable[..., dict], recursos: Callable[[str], list[dict]],
                 skill: Callable[[], dict] | None = None) -> None:
        self.store = store
        self.carpeta = data_dir / "generated_images"
        self.ejecutables = ejecutables   # rutas de los CLI autorizados (Gemini va por Antigravity)
        self.importar = importar          # State.import_asset
        self.recursos = recursos          # State.list_assets
        self.skill = skill                # skill «Generador de imágenes»: instrucciones, referencias y si está activa
        self.candados = {proveedor: threading.Lock() for proveedor in PROVEEDORES}
        self.pendientes = {proveedor: 0 for proveedor in PROVEEDORES}
        self.cuenta = threading.Lock()
        with self.store.transaction(immediate=True) as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS generated_images(
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider TEXT NOT NULL,
                    nombre TEXT NOT NULL, descripcion TEXT NOT NULL, estilo TEXT NOT NULL, contexto TEXT,
                    status TEXT NOT NULL, path TEXT, width INTEGER, height INTEGER, error TEXT, asset_id TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_generated_images_project ON generated_images(project_id, created_at);
                """
            )
            # Lo que quedó a medias al cerrar el servidor ya no va a terminar.
            con.execute("UPDATE generated_images SET status='failed', error='Se interrumpió al cerrar Kiko Studio' "
                        "WHERE status='generating'")

    # --- Estado ---------------------------------------------------------------------------------

    def proveedores(self) -> list[dict]:
        rutas = self._rutas()
        return [{"id": clave, "nombre": nombre, "disponible": clave in rutas} for clave, nombre in PROVEEDORES.items()]

    def _rutas(self) -> dict[str, str]:
        rutas = {}
        if CODEX.is_file():
            rutas["codex"] = str(CODEX)
        if self.ejecutables().get("gemini"):
            rutas["gemini"] = self.ejecutables()["gemini"]
        return rutas

    def listar(self, project_id: str) -> list[dict]:
        with self.store.lock:
            filas = self.store.connection.execute(
                "SELECT * FROM generated_images WHERE project_id=? AND status IN ('generating','ready','failed') "
                "ORDER BY created_at DESC LIMIT 24", (project_id,),
            ).fetchall()
        return [self._fila(fila) for fila in filas]

    def _fila(self, fila) -> dict:
        item = dict(fila)
        item["proveedor"] = PROVEEDORES.get(item["provider"], item["provider"])
        item["url"] = f"/media/generated/{item['id']}?v={item['updated_at']}" if item.get("path") else None
        item.pop("path", None)
        return item

    def _obtener(self, image_id: str) -> dict:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT * FROM generated_images WHERE id=?", (image_id,)).fetchone()
        if not fila:
            raise ValueError("La imagen generada no existe")
        return dict(fila)

    def _actualizar(self, image_id: str, **campos) -> None:
        campos["updated_at"] = _ahora()
        columnas = ", ".join(f"{nombre}=?" for nombre in campos)
        with self.store.transaction(immediate=True) as con:
            con.execute(f"UPDATE generated_images SET {columnas} WHERE id=?", (*campos.values(), image_id))

    def media(self, image_id: str) -> tuple[Path, str]:
        ruta = Path(self._obtener(image_id).get("path") or "").resolve()
        if self.carpeta.resolve() not in ruta.parents or not ruta.is_file():
            raise ValueError("La imagen todavía no está disponible")
        return ruta, ruta.name

    # --- Generar, guardar y descartar -----------------------------------------------------------

    def generar(self, project_id: str, *, descripcion: str, nombre: str, estilo: str, contexto: str = "",
                proveedor: str = "auto") -> list[dict]:
        descripcion = " ".join(str(descripcion).split())[:600]
        nombre = nombre_de_archivo(nombre or descripcion)
        if len(descripcion.split()) < 2:
            raise ValueError("Describe la imagen con algunas palabras")
        if not nombre:
            raise ValueError("Ponle un nombre a la imagen")
        if estilo not in ESTILOS:
            raise ValueError("Estilo no válido")
        if self.skill and not self.skill().get("activa", True):
            raise RuntimeError("La skill «Generador de imágenes» está desactivada; actívala en Skills")
        disponibles = self._rutas()
        if proveedor == "ambas":
            elegidos = list(disponibles)
        elif proveedor == "auto":
            with self.cuenta:
                elegidos = sorted(disponibles, key=lambda p: self.pendientes[p])[:1]
        elif proveedor in PROVEEDORES:
            elegidos = [proveedor] if proveedor in disponibles else []
        else:
            raise ValueError("Opción de IA no válida")
        if not elegidos:
            raise RuntimeError("No encuentro la app de ChatGPT ni Gemini (Antigravity) para generar imágenes")
        creadas = []
        for elegido in elegidos:
            image_id = str(uuid4())
            with self.store.transaction(immediate=True) as con:
                con.execute(
                    "INSERT INTO generated_images(id,project_id,provider,nombre,descripcion,estilo,contexto,status,"
                    "created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (image_id, project_id, elegido, nombre, descripcion, estilo, " ".join(str(contexto).split())[:400],
                     "generating", _ahora(), _ahora()),
                )
            with self.cuenta:
                self.pendientes[elegido] += 1
            otro = next((p for p in disponibles if p != elegido), None) if proveedor == "auto" else None
            threading.Thread(target=self._trabajo, args=(image_id, elegido, otro), daemon=True,
                             name=f"imagen-{image_id[:8]}").start()
            creadas.append(self._fila(self._obtener(image_id)))
        return creadas

    def otra_version(self, image_id: str) -> list[dict]:
        fila = self._obtener(image_id)
        return self.generar(fila["project_id"], descripcion=fila["descripcion"], nombre=fila["nombre"],
                            estilo=fila["estilo"], contexto=fila["contexto"] or "", proveedor=fila["provider"])

    def guardar(self, image_id: str, nombre: str | None = None) -> dict:
        """Pasa la propuesta a los recursos del proyecto como imagen, con la IA anotada como licencia."""
        fila = self._obtener(image_id)
        if fila["status"] != "ready":
            raise ValueError("Esa imagen no está lista para guardarse")
        base = nombre_de_archivo(nombre or fila["nombre"])
        if not base:
            raise ValueError("Ponle un nombre a la imagen")
        clave = base.replace("-", "")  # igual que planificador.clave_recurso: «biblia-antigua» = «Biblia_Antigua»
        if any(r["kind"] in {"image", "sound"} and nombre_de_archivo(r["name"]).replace("-", "") == clave
               for r in self.recursos(fila["project_id"])):
            raise ValueError(f"Ya hay un recurso llamado «{base}»; elige otro nombre")
        origen, _ = self.media(image_id)
        temporal = Path(tempfile.mkstemp(suffix=origen.suffix)[1])
        shutil.copy2(origen, temporal)
        licencia = f"Generada con IA · {PROVEEDORES[fila['provider']]} · revisa los términos de tu plan"
        try:
            recurso = self.importar(fila["project_id"], "image", f"{base}{origen.suffix}", temporal, licencia)
        finally:
            temporal.unlink(missing_ok=True)
        self._actualizar(image_id, status="saved", asset_id=recurso["id"], nombre=base)
        return recurso

    def descartar(self, image_id: str) -> None:
        fila = self._obtener(image_id)
        if fila["status"] == "generating":
            raise ValueError("Espera a que termine de generarse")
        if fila.get("path"):
            Path(fila["path"]).unlink(missing_ok=True)
        self._actualizar(image_id, status="discarded", path=None)

    # --- Trabajo en segundo plano ---------------------------------------------------------------

    def _trabajo(self, image_id: str, proveedor: str, alternativo: str | None) -> None:
        fila = self._obtener(image_id)
        try:
            try:
                ruta = self._con_proveedor(proveedor, fila)
            except Exception:
                if not alternativo:
                    raise
                self._actualizar(image_id, provider=alternativo)
                ruta = self._con_proveedor(alternativo, fila)
            ancho, alto, _ = medir(ruta)
            if min(ancho, alto) < LADO_MINIMO:
                raise RuntimeError(f"La imagen salió muy pequeña ({ancho}×{alto})")
            self._actualizar(image_id, status="ready", path=str(ruta), width=ancho, height=alto, error=None)
        except Exception as exc:  # el error llega al panel tal cual
            self._actualizar(image_id, status="failed", error=str(exc)[:400])

    def _con_proveedor(self, proveedor: str, fila: dict) -> Path:
        destino = self.carpeta / fila["project_id"]
        destino.mkdir(parents=True, exist_ok=True)
        try:
            with self.candados[proveedor], tempfile.TemporaryDirectory(prefix="kiko-imagen-") as trabajo:
                carpeta = Path(trabajo)
                skill = self.skill() if self.skill else {}
                prompt = self._prompt(fila, proveedor, carpeta, skill)
                generada = self._codex(prompt, carpeta, self._referencias(skill)) if proveedor == "codex" \
                    else self._gemini(prompt, carpeta)
                if generada.suffix.lower() == ".webp":  # Remotion y los navegadores la leen, pero se guarda en PNG
                    convertida = carpeta / "convertida.png"
                    subprocess.run(["sips", "-s", "format", "png", str(generada), "--out", str(convertida)],
                                   capture_output=True, check=True)
                    generada = convertida
                final = destino / f"{fila['id']}{'.jpg' if generada.suffix.lower() == '.jpeg' else generada.suffix.lower()}"
                shutil.copy2(generada, final)
                return final
        finally:
            with self.cuenta:
                self.pendientes[proveedor] = max(0, self.pendientes[proveedor] - 1)

    @staticmethod
    def _referencias(skill: dict) -> list[str]:
        """Hasta 3 imágenes de referencia de la skill, si pidió enviarlas (solo Codex acepta adjuntos)."""
        if not skill.get("ajustes", {}).get("usar_referencias", True):
            return []
        return [r["ruta"] for r in skill.get("recursos", []) if r["tipo"] == "image" and Path(r["ruta"]).is_file()][:3]

    @staticmethod
    def _prompt(fila: dict, proveedor: str, carpeta: Path, skill: dict | None = None) -> str:
        partes = [
            "Genera una sola imagen con tu herramienta de generación de imágenes.",
            f"Qué debe mostrar: {fila['descripcion']}.",
        ]
        if fila.get("contexto"):
            partes.append(f"Aparece en un video mientras se dice: «{fila['contexto']}».")
        partes += [
            f"Estilo: {ESTILOS[fila['estilo']]}.",
            "Formato horizontal (3:2): se verá dentro de un recuadro en un video vertical de redes sociales.",
            "Sujeto claro y centrado; sin textos superpuestos, subtítulos, logotipos ni marcas de agua.",
        ]
        if skill and skill.get("instrucciones"):
            partes.append(f"Indicaciones del creador para sus imágenes: {skill['instrucciones']}")
        conocimiento = " ".join(r.get("texto", "") for r in (skill or {}).get("recursos", []) if r["tipo"] == "document")
        if conocimiento:
            partes.append(f"Guía visual del creador: {conocimiento[:1500]}")
        if proveedor == "codex" and skill and ImageGenerator._referencias(skill):
            partes.append("Las imágenes adjuntas son solo referencia de estilo (color, luz, composición): no las copies.")
        if proveedor == "codex":
            partes.append(f"Guarda el resultado como {carpeta / 'imagen.png'} y responde solo con esa ruta.")
        else:
            partes.append("No copies ni muevas el archivo; solo genera la imagen y responde con su ruta.")
        return " ".join(partes)

    def _codex(self, prompt: str, carpeta: Path, referencias: list[str] | None = None) -> Path:
        inicio = time.time()
        proceso = subprocess.run(
            [self._rutas()["codex"], "exec", "--skip-git-repo-check", "--sandbox", "workspace-write",
             "-C", str(carpeta), prompt, *(["-i", *referencias] if referencias else [])],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=TIEMPO_MAXIMO, cwd=carpeta,
        )
        imagen = self._buscar(carpeta, inicio) or self._buscar(CODEX_IMAGENES, inicio)
        if imagen:
            return imagen
        detalle = (proceso.stderr or proceso.stdout).strip().splitlines()
        raise RuntimeError(f"ChatGPT no generó la imagen: {detalle[-1][:200] if detalle else 'sin respuesta'}")

    def _gemini(self, prompt: str, carpeta: Path) -> Path:
        inicio = time.time()
        proceso = subprocess.run(
            [self._rutas()["gemini"], "-p", prompt, "--mode", "accept-edits", "--output-format", "json",
             "--print-timeout", f"{TIEMPO_MAXIMO}s"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=TIEMPO_MAXIMO + 30, cwd=carpeta,
        )
        try:
            conversacion = json.loads(proceso.stdout.strip().splitlines()[-1]).get("conversation_id", "")
        except (ValueError, IndexError):
            conversacion = ""
        # El generador de Antigravity guarda la imagen en la carpeta de la conversación, a veces unos
        # segundos después de que el agente responde.
        limite = time.time() + ESPERA_ANTIGRAVITY
        while True:
            imagen = self._buscar(carpeta, inicio) or (self._buscar(ANTIGRAVITY_BRAIN / conversacion, inicio)
                                                       if conversacion else None)
            if imagen or time.time() > limite:
                break
            time.sleep(3)
        if imagen:
            return imagen
        detalle = (proceso.stderr or proceso.stdout).strip().splitlines()
        raise RuntimeError(f"Gemini no generó la imagen: {detalle[-1][:200] if detalle else 'sin respuesta'}")

    @staticmethod
    def _buscar(carpeta: Path, desde: float) -> Path | None:
        """La imagen más reciente creada en la carpeta (o sus subcarpetas) después de empezar."""
        if not carpeta.is_dir():
            return None
        candidatas = [r for r in carpeta.rglob("*") if r.suffix.lower() in EXTENSIONES and r.is_file()
                      and r.stat().st_mtime >= desde - 1 and r.stat().st_size > 1024]
        return max(candidatas, key=lambda r: r.stat().st_mtime) if candidatas else None
