# Kiko Remotion

Editor semántico de Kiko Studio. Compara lo que dices en tus tomas con tu libreto, arma el montaje con la mejor versión de cada línea y propone mapas, objetos, cifras, imágenes y efectos sincronizados con tu voz. Antes de renderizar te muestra el plan y una vista previa para que lo revises.

## Desde el panel de Kiko Studio

En el panel (`python3 -m kiko_studio.app` → http://127.0.0.1:8765), abre la vista **Editor semántico**. La tarjeta **Cómo preparar tu material** resume todo lo de abajo.

1. **Tomas.** Marca todas las tomas del video o súbelas. Cada una se revisa al marcarla (orientación, resolución, fps, volumen, saturación y silencio inicial). Puedes grabar por partes y en cualquier orden.
2. **Libreto (obligatorio).** Pégalo o cárgalo en .txt, .md, .docx, .rtf u .odt. Sin libreto no se planifica: con él Kiko corrige la transcripción, ordena las tomas, se queda con la última versión completa de cada línea repetida y quita lo que dijiste fuera del libreto.
3. **Recursos.** Sube imágenes, sonidos, música o tu logo con su licencia (obligatoria). El nombre del archivo es cómo lo pides en el libreto; el botón de cada recurso inserta su indicación donde está el cursor.
   - **Generar imagen con IA:** describe la imagen, elige estilo y elige quién la genera: ChatGPT (a través del Codex de su app), Gemini (Antigravity), automático o las dos para comparar. Usa tu plan y no claves API, y tarda alrededor de un minuto. Cada imagen queda como propuesta: la guardas en tus recursos, pides otra versión o la descartas. Claude no tiene generador de imágenes en su CLI.
   - Si el libreto pide una `[IMAGEN …]` que no está en tus recursos, el paso del libreto lo avisa y ofrece generarla, con la descripción de la indicación o, si no la tiene, con el texto de la línea.
4. **Plantilla de marca.** Por proyecto: colores, logo como marca de agua y tarjeta final.
5. **Planificar edición.** Corre en segundo plano y avisa (también con una notificación del sistema) cuando el plan está listo.
6. **Revisar el plan:**
   - informe del libreto (porcentaje dicho, líneas que faltan, repeticiones y avisos de las indicaciones);
   - línea de tiempo con los gráficos sobre las tomas;
   - montaje: mueve el inicio o el final de cada tramo palabra a palabra, quita tramos y escucha cada tramo o cada corte desde el original;
   - gráficos: quítalos, cambia su texto, adelanta o atrasa su entrada de 0,2 en 0,2 s y fija su duración;
   - **Ver vista previa**: 12 s a media resolución, con la plantilla de marca.
7. **Aprobar y renderizar.** Al terminar ves el video con su control de calidad, una guía de zonas seguras de TikTok, Reels y Shorts, y lo descargas junto con los subtítulos (SRT) y la miniatura (JPG).

### Skills y el Director

En la vista **Skills** cada parte de la edición es una skill que puedes activar o apagar. En cada una cambias sus instrucciones (el prompt), sus ajustes y sus recursos, con licencia obligatoria:

| Skill | Qué controla | Recursos |
|---|---|---|
| 🧠 Director (orquestador) | Analiza la toma y tu objetivo y recomienda qué skills usar y con qué ajustes | Documentos de marca, público y tono |
| 🎚️ Sonido | Limpieza de la voz, aislamiento, música y su volumen bajo la voz | Música |
| ✨ Efectos visuales | Tipos de gráficos permitidos, cantidad por minuto y aire entre ellos | Referencias, documentos |
| ✂️ Recortes | Aire de cada corte, pausa inicial, cola final y muletillas | Documentos |
| 🎬 Edición y ritmo | Zoom en los cortes, su intensidad y acercamiento lento | Documentos |
| 🎨 Filtros de color | Cálido, frío, cine, vivo, vintage o blanco y negro, con intensidad | Fotos de referencia |
| 🖼️ Generador de imágenes | IA y estilo por defecto; sus instrucciones van en cada imagen | Imágenes de referencia (se adjuntan a ChatGPT) |
| 🧩 Superposiciones | Posición y opacidad de la marca de agua, rótulo inicial y capa a pantalla completa | PNG transparentes |
| 🔊 Efectos de audio | Volumen de los efectos y tus sonidos para cada tipo de gráfico | Sonidos |
| 💬 Subtítulos | Mayúsculas, color de la palabra clave, tamaño, posición y tipografía | Tipografías |
| 🪄 Retoques | Brillo, contraste, nitidez, suavizado de piel y viñeta | Fotos de referencia |

Al planificar escribes el **objetivo de la edición**. El Director mide la toma en local: brillo, contraste, color y nitidez, el rostro con Apple Vision, el volumen de la voz, el ritmo, las repeticiones y los gráficos posibles. Luego, con la IA de tu sesión (o con reglas locales si no hay IA), recomienda skills con su motivo. Las recomendaciones se validan contra los ajustes de cada skill y tú eliges cuáles aplicar a esa edición. «Usar la configuración actual de las skills» trae a la edición lo que cambies después en la vista Skills.

Las instrucciones de cada skill son lo que lee el Director (y, en el Generador, cada imagen). Los ajustes son lo que aplica el motor. Una skill que apagas o un gráfico que la skill no permite nunca quita lo que pide el libreto.

#### Conversar con una skill

Cada skill tiene dos pestañas: **Conversar** y **Configuración**. En Conversar eliges un video y le escribes a la skill. La skill ve sus instrucciones, sus ajustes, sus documentos y lo que hizo en ese video: transcripción con segundos, gráficos, cortes, acercamientos, correcciones y lo que midió el Director. Responde con la IA de tu sesión (Claude, ChatGPT o Gemini, según el proveedor del Director). También se abre desde el editor: toca una skill en «Skills de esta edición» o «Conversar con el Director».

Cuando pide un cambio, la skill solo lo propone. Kiko valida cada acción y la prueba en una copia del plan. La tarjeta muestra qué cambia («Entra Ícono «bible» a los 12,5 s…») y avisa si algo no entra. Tú marcas qué aplicar. Al aplicar se guarda una copia para **Deshacer** y queda el botón **Ver vista previa** de ese momento. Los cambios se deshacen en orden: si el video cambió después, primero se deshace lo más reciente.

| Skill | Herramientas propias (además de cambiar sus ajustes, activarse o reescribir sus instrucciones) |
|---|---|
| 🧠 Director | Todas las de abajo, sobre cualquier skill que no esté bloqueada para él, y aplicar sus recomendaciones |
| ✨ Efectos visuales | Quitar, mover o alargar un gráfico; cambiar un texto o un ícono; agregar texto, ícono o mapa en una frase |
| ✂️ Recortes | Cortar una frase, recuperar una frase cortada, rearmar el montaje |
| 🎬 Edición y ritmo | Acercamiento en una frase, quitar un acercamiento (gancho, remate o uno pedido) |
| 🖼️ Generador de imágenes | Generar una imagen (llega al generador para aprobarla), poner una imagen de la biblioteca en una frase |
| 🔊 Efectos de audio | Quitar el sonido de un gráfico, agregar un sonido en una frase |
| 💬 Subtítulos | Corregir una palabra mal transcrita en todo el video |

El chat vive en `kiko_studio/skill_chat.py` (tabla `skill_chat`). Las copias para deshacer quedan en `trabajo/<plan>/deshacer/`.

### Indicaciones del libreto

Van entre corchetes al final de la línea a la que pertenecen. Las líneas que empiezan con `#` son notas.

| Indicación | Qué hace |
|---|---|
| `[IMAGEN biblia.png]` | Muestra tu imagen mientras dices la línea |
| `[IMAGEN biblia "Biblia antigua con luz de vela"]` | Igual; si todavía no la tienes, la descripción sirve para generarla con IA |
| `[TEXTO]` | La línea en letras grandes |
| `[TEXTO "MATEO 25"]` | Ese texto, sobre las palabras que lo dicen |
| `[MAPA Japón]` | Mapa del país resaltado |
| `[ICONO trophy]` | Ícono de Tabler (nombre en inglés) |
| `[SONIDO golpe.wav]` | Tu sonido al empezar la línea |
| `[SIN GRÁFICO]` | Nada en pantalla durante esa línea |

Lo que pide el libreto tiene prioridad sobre lo que detecta Kiko o propone la IA.

Las imágenes generadas viven en `kiko_studio/image_generator.py` (tabla `generated_images`, archivos en `data/generated_images/`) y al aprobarlas pasan a `media_assets` con la IA anotada como licencia.

El panel usa los pasos de abajo (`revisar`, `planificar`, `editar` y `render`, con `--sin-descargas`) a través de `kiko_studio/semantic_editor.py`. Cada edición queda en la tabla `semantic_edits`, la plantilla en `semantic_brand` y los archivos en `data/exports/semantic/`.

## Uso en la terminal

```bash
cd remotion
python3 scripts/editor.py revisar --clip ~/Downloads/TOMA_1.MOV
python3 scripts/editor.py planificar --clip ~/Downloads/TOMA_1.MOV ~/Downloads/TOMA_2.MOV --libreto libreto.txt --recursos recursos.json --nombre mi-video [--skills skills.json --objetivo "Reel emotivo para emprendedores"]
```

`recursos.json` es una lista de `{"nombre", "tipo": "image" | "logo" | "sound" | "music", "ruta", "licencia"}`. `planificar` escribe `trabajo/mi-video/plan_edicion.json` y una vista legible en `~/Downloads/kiko_ediciones/mi-video/plan_edicion.md`. **No renderiza nada.** En la vista aparecen el informe del libreto, el montaje y los eventos con su tiempo, recurso, sonido, justificación y avisos de verificación, además de lo que se descartó y por qué.

Si quieres cambiar algo, edita `plan_edicion.json` y corre `rehacer` para recalcular los tiempos. También puedes describir los cambios en un JSON y aplicarlos con `editar`:

```bash
echo '{"quitar": ["c1"], "agregar_textos": ["el miedo disfrazado"], "ajustes": {"l0": {"ajuste_inicio": 0.2, "duracion": 3}}}' > cambios.json
python3 scripts/editor.py editar --plan trabajo/mi-video/plan_edicion.json --cambios cambios.json
```

`editar` también acepta `"skills": {"filtros": {"activa": true, "ajustes": {"preset": "calido"}}}` (ajustes validados con el esquema de cada skill) y `"skills_base"` (la configuración completa de skills.json). Las herramientas del chat usan además `"agregar_eventos": [{"componente": "icono", "frase": "la Biblia", "icono": "bible"}]` (también `texto_cinetico` con `texto`, `mapa_pais` con `pais`, `imagen` con `recurso` y `sonido` con `sonido`), `"iconos": {"ia0": "pig-money"}`, `"sin_sonido": ["c3"]`, `"recursos_nuevos"`, `"quitar_frases"` y `"recuperar_frases"` (frases tal como suenan), `"zoom_frases": [{"frase": "…", "intensidad": 10}]`, `"quitar_zoom": ["gancho" | "remate" | "z1"]` y `"corregir": [{"dice": "talentosentos", "correcta": "talentos"}]`. Las frases se buscan en el video tal como queda; si algo no existe, `editar` falla con un mensaje claro y no deja el plan a medias. `montaje` acepta `libreto` (vuelve al montaje del libreto), `usar_ultima` o `quitar_repeticion` (solo sin libreto, si se detectaron repeticiones), `original`, o una lista de rangos de palabras. Cuando el plan esté como quieres, renderiza:

```bash
python3 scripts/editor.py render --plan trabajo/mi-video/plan_edicion.json --marca marca.json
python3 scripts/editor.py render --plan trabajo/mi-video/plan_edicion.json --vista-previa auto
```

`marca.json` es `{"colores": {"morado", "violeta", "amarillo"}, "logo": ruta, "marca_de_agua": true, "cierre": {"texto", "duracion"}}`. El render completo deja en `out/` el MP4, los subtítulos `.srt` y la miniatura `.jpg`; la vista previa deja `out/mi-video_vista.mp4`.

Opciones útiles:

- `planificar --guion "texto"` prueba un guion con la voz guía de macOS, sin grabar.
- `--ia no` usa solo el análisis local; también puedes elegir `--ia claude`, `codex` o `gemini`.
- `render --sin-musica` renderiza sin música de fondo; si subiste música propia, se usa en lugar de la de Apple Loops.

Para revisar a mano en el navegador: `npm run studio`.

## Cómo se arma el plan

1. **Transcripción por palabra** con SpeechAnalyzer de macOS, en local, de cada toma.
2. **Alineación con el libreto** (`scripts/libreto.py`): cada línea se busca en lo dicho con una alineación local tolerante a errores de transcripción y a cifras dichas en letras. Si una línea aparece varias veces, se usa la última versión casi completa. Las tomas se ordenan según el libreto y ningún tramo cruza de un archivo a otro.
3. **Correcciones:** primero las del libreto (solo palabras que se parecen a lo transcrito; un sinónimo dicho se respeta), luego las de `diccionario.json`. Sin libreto, también las que proponga la IA. Se aplican al plan y quedan registradas.
4. **Análisis local**, que siempre corre (`scripts/planificador.py`, `scripts/lexico.py`):
   - **Países:** los 177 de Natural Earth, con alias como «EE. UU.» u «Holanda». Exige mayúscula, así que «chile» (el ají) no cuenta.
   - **Desambiguación:** «me llamo Ana» no es una llamada; un teclado musical da un ícono de piano; la moneda como dinero da un ícono de monedas y no un lanzamiento.
   - **Cifras:** años, porcentajes y montos, siempre con aviso de verificación.
   - **Objetos concretos:** se dibujan con íconos Tabler.
5. **Paso de IA opcional** (`scripts/ia.py`): Claude, Codex o Gemini a través de MultiAgent Core, con sesiones autorizadas y sin claves API. La IA solo propone; cada propuesta se valida:
   - las palabras que cita deben existir en la transcripción;
   - los componentes deben estar en el catálogo, y los países y los íconos deben existir;
   - los textos visibles salen siempre de lo dicho;
   - las correcciones deben parecerse a lo transcrito.
6. **Reglas editoriales:**
   - Prioridad: lo pedido en el libreto > imagen > mapa > objeto o acción > cifra > ícono.
   - Al menos 0,25 s de aire entre gráficos.
   - No se repite la misma idea en menos de 12 s.
   - Un mapa seguido de un logro se funde en una sola idea, con la copa sobre el mapa.
   - Gancho al inicio y remate al final con la cámara.

## Librería de componentes (`src/componentes/`)

| Componente | Cuándo | Sonido |
|---|---|---|
| `MapaPais` | Un país en contexto geográfico; muestra su subregión y se acerca | whoosh |
| `Trofeo` | Campeón, trofeo, ganar algo deportivo; copa genérica con confeti | ovación |
| `Teclado` | Teclado o escribir en un computador | clics sobre las sílabas |
| `Llamada` | Llamar o teléfono; nombre dicho o «Contacto» | vibración |
| `Moneda` | Lanzar una moneda o cara o sello | ping al caer |
| `Icono` | Objeto concreto (unos 60 en el léxico, o los que proponga la IA) | pop |
| `TextoCinetico` | Cifra o concepto, exactamente como se dijo | impacto |
| `Imagen` | Tu imagen, pedida con `[IMAGEN …]` en el libreto | whoosh |

Para sumar un componente: créalo en `src/componentes/`, regístralo en `REGISTRO` (`src/EdicionSemantica.tsx`) y en `CATALOGO` y `PRIORIDAD` (`scripts/planificador.py`), y agrega su regla de detección.

## Audio y control de calidad

- **Voz:** aislamiento al 65 %, filtro paso alto de 80 Hz, ecualización, de-esser, compresor y limitador, con los Audio Units de Apple (`scripts/cadena_voz.swift`).
- **Loudness:** −14 LUFS, en dos pasadas con el FFmpeg incluido en Remotion.
- **Control de calidad** (`scripts/qc.py`), sobre el archivo renderizado:
  - 1080×1920 a 30 fps y duración correcta;
  - loudness y pico real;
  - cada efecto a 2 fotogramas o menos de su palabra;
  - subtítulos sin cortes sintácticos;
  - Apple Vision comprueba que ningún subtítulo se cruce con un rostro.

## Pruebas

```bash
python3 -m unittest discover -s tests
```

## Recursos y licencias

| Recurso | Fuente | Licencia |
|---|---|---|
| Mapas | Natural Earth 1:110m (`fuentes/natural-earth/`) | Dominio público |
| Íconos | `@tabler/icons@3.49.0` | MIT |
| Copa, teclado, llamada, moneda y confeti | Dibujos vectoriales propios | Propia |
| Efectos de sonido | Sintetizados en `scripts/sfx.py` (provisionales) | Propia |
| Imágenes generadas con IA | ChatGPT o Gemini (Antigravity), con tu plan | Según los términos de tu plan; quedan anotadas como licencia del recurso |
| Música de fondo | Capas «Chill Chords» (guitarra y bajo) de Apple Loops | Libres de regalías dentro de composiciones propias; confirma los términos antes de publicar en redes |
| Remotion | npm `remotion@4.0.539` | Gratis para personas y empresas de hasta 3 empleados; si no, requiere licencia de empresa |

Para usar sonidos reales, reemplaza el WAV del mismo nombre en `public/audio/sfx/`; el editor no sobrescribe los que ya existen.
