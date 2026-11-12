export type EditorToolStatus = "ready" | "partial" | "planned";
export type EditorCatalogCategory = { id: number; name: string; tools: { name: string; description: string; section: string; status: EditorToolStatus }[] };
// Inventory adapted from the tool guide supplied by the project owner. “Ready” means the current editor exposes a working equivalent.
export const EDITOR_TOOL_CATALOG: EditorCatalogCategory[] = [
  {
    "id": 1,
    "name": "Multimedia / Medios",
    "tools": [
      {
        "name": "Importar",
        "description": "Cargar videos, fotografías, archivos de audio y otros recursos compatibles desde el computador.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Local",
        "description": "Visualizar y organizar los archivos importados al proyecto.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Biblioteca",
        "description": "Acceder a videos de stock, clips de naturaleza, personas, paisajes, fondos y recursos creativos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Pantalla verde",
        "description": "Encontrar videos y elementos con fondo verde para eliminarlo mediante Chroma Key.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Recursos de IA",
        "description": "Acceder a materiales multimedia generados mediante inteligencia artificial, cuando estén disponibles.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Espacios",
        "description": "Acceder a archivos guardados en el espacio de CapCut y recursos sincronizados en la nube.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Búsqueda de recursos",
        "description": "Buscar materiales por palabras clave.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Vista previa de recursos",
        "description": "Reproducir clips antes de agregarlos al proyecto.",
        "section": "",
        "status": "partial"
      }
    ]
  },
  {
    "id": 2,
    "name": "Línea de tiempo y edición básica",
    "tools": [
      {
        "name": "Seleccionar",
        "description": "Elegir videos, audios, imágenes, textos o varios elementos de la línea de tiempo.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Dividir (Split)",
        "description": "Cortar un clip en dos en la posición del cabezal de reproducción.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Recortar (Trim)",
        "description": "Acortar un video desde el principio o desde el final.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Eliminar",
        "description": "Borrar elementos seleccionados de la línea de tiempo.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Deshacer",
        "description": "Revertir la última acción.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Rehacer",
        "description": "Recuperar una acción deshecha.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Copiar",
        "description": "Copiar clips o elementos seleccionados.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Pegar",
        "description": "Insertar elementos previamente copiados.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Duplicar",
        "description": "Crear una copia de un clip en el proyecto.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Congelar (Freeze)",
        "description": "Convertir un fotograma en una imagen fija con duración editable.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Invertir (Reverse)",
        "description": "Reproducir el video hacia atrás.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Extraer audio",
        "description": "Separar la pista de sonido del video para editarla independientemente.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Agrupar / Desagrupar",
        "description": "Organizar varios elementos para moverlos conjuntamente.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Marcadores",
        "description": "Señalar momentos específicos, como golpes musicales o cambios de escena.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Zoom de línea de tiempo",
        "description": "Acercar o alejar la vista de los clips para editar con precisión.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Ajuste magnético (Snap)",
        "description": "Alinear clips y otros elementos automáticamente con puntos cercanos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Bloquear pistas",
        "description": "Proteger pistas para evitar cambios accidentales.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Silenciar pistas",
        "description": "Desactivar temporalmente el sonido de determinados elementos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Ocultar pistas",
        "description": "Ocultar temporalmente capas visuales durante la edición.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Escena dividida",
        "description": "Dividir material en escenas detectadas, en las versiones que incorporan esta opción.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 3,
    "name": "Video: herramientas del panel derecho",
    "tools": [
      {
        "name": "Escala",
        "description": "Aumentar o reducir el tamaño de una imagen o video.",
        "section": "Video → Básico",
        "status": "ready"
      },
      {
        "name": "Posición X",
        "description": "Mover el elemento horizontalmente.",
        "section": "Video → Básico",
        "status": "ready"
      },
      {
        "name": "Posición Y",
        "description": "Mover el elemento verticalmente.",
        "section": "Video → Básico",
        "status": "ready"
      },
      {
        "name": "Rotación",
        "description": "Girar un elemento en el encuadre.",
        "section": "Video → Básico",
        "status": "partial"
      },
      {
        "name": "Opacidad",
        "description": "Controlar la transparencia de un video o imagen.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Modo de fusión",
        "description": "Combinar visualmente dos capas mediante distintos modos de mezcla.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Fotogramas clave",
        "description": "Animar la posición, escala, rotación, opacidad y otros parámetros compatibles.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Estabilización",
        "description": "Reducir los movimientos y temblores de cámara.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Reencuadre automático",
        "description": "Adaptar el video a otra proporción manteniendo al sujeto dentro del encuadre.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Eliminación de parpadeo",
        "description": "Reducir fluctuaciones de luz o parpadeos de la grabación.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Mejora de imagen",
        "description": "Mejorar nitidez y detalles mediante procesamiento de IA, con opciones como HD o UHD en versiones compatibles.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Seguimiento de movimiento",
        "description": "Seguir un objeto o sujeto para asociarle movimientos o elementos.",
        "section": "Video → Básico",
        "status": "planned"
      },
      {
        "name": "Eliminación automática",
        "description": "Detectar el sujeto y quitar el fondo mediante IA.",
        "section": "Video → Recorte / Eliminar fondo",
        "status": "planned"
      },
      {
        "name": "Eliminación personalizada",
        "description": "Seleccionar manualmente zonas que deben conservarse o eliminarse.",
        "section": "Video → Recorte / Eliminar fondo",
        "status": "planned"
      },
      {
        "name": "Chroma Key",
        "description": "Eliminar un fondo de un color específico, como verde o azul.",
        "section": "Video → Recorte / Eliminar fondo",
        "status": "planned"
      },
      {
        "name": "Selector de color",
        "description": "Elegir el color exacto que se eliminará.",
        "section": "Video → Recorte / Eliminar fondo",
        "status": "planned"
      },
      {
        "name": "Intensidad",
        "description": "Ajustar la fuerza de la eliminación del color.",
        "section": "Video → Recorte / Eliminar fondo",
        "status": "planned"
      },
      {
        "name": "Ajustes de borde y sombra",
        "description": "Refinar el recorte para conseguir una integración visual más natural.",
        "section": "Video → Recorte / Eliminar fondo",
        "status": "planned"
      },
      {
        "name": "Máscara circular",
        "description": "Mostrar u ocultar una zona circular del video.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Máscara rectangular",
        "description": "Delimitar una zona rectangular.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Máscara lineal o dividida",
        "description": "Separar visualmente dos zonas de una composición.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Máscaras con formas",
        "description": "Aplicar formas predefinidas disponibles en la biblioteca.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Invertir máscara",
        "description": "Intercambiar las áreas visibles y ocultas.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Suavizado / Pluma (Feather)",
        "description": "Difuminar los bordes de la máscara.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Posición, tamaño y rotación",
        "description": "Transformar la geometría de la máscara.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Animación mediante keyframes",
        "description": "Hacer que la máscara cambie de posición o tamaño durante el video.",
        "section": "Video → Máscara",
        "status": "planned"
      },
      {
        "name": "Color",
        "description": "Colocar un fondo de color sólido.",
        "section": "Video → Lienzo / Fondo",
        "status": "planned"
      },
      {
        "name": "Desenfoque",
        "description": "Crear un fondo borroso a partir de la imagen o video.",
        "section": "Video → Lienzo / Fondo",
        "status": "planned"
      },
      {
        "name": "Estilo de fondo",
        "description": "Aplicar los fondos predefinidos de la aplicación.",
        "section": "Video → Lienzo / Fondo",
        "status": "planned"
      },
      {
        "name": "Ajuste al lienzo",
        "description": "Encajar el contenido en el formato horizontal, vertical o cuadrado.",
        "section": "Video → Lienzo / Fondo",
        "status": "ready"
      }
    ]
  },
  {
    "id": 4,
    "name": "Velocidad",
    "tools": [
      {
        "name": "Velocidad estándar",
        "description": "Acelerar o ralentizar todo el clip de manera uniforme.",
        "section": "Velocidad → Normal",
        "status": "ready"
      },
      {
        "name": "Duración",
        "description": "Modificar cuánto tiempo ocupa el clip al cambiar la velocidad.",
        "section": "Velocidad → Normal",
        "status": "ready"
      },
      {
        "name": "Ajuste de tono",
        "description": "Conservar o modificar el tono del audio cuando cambia la velocidad, cuando es compatible.",
        "section": "Velocidad → Normal",
        "status": "partial"
      },
      {
        "name": "Personalizada",
        "description": "Crear curvas manuales de aceleración y desaceleración.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Montaje",
        "description": "Aplicar un patrón de cambios de velocidad preestablecido.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Bala (Bullet)",
        "description": "Crear un efecto rápido-lento-rápido de tipo cinematográfico.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Corte de salto",
        "description": "Aplicar un patrón dinámico de velocidad.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Tiempo de héroe",
        "description": "Destacar un momento mediante un cambio dramático de velocidad.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Flash In",
        "description": "Aplicar un patrón de aceleración de entrada.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Flash Out",
        "description": "Aplicar un patrón de aceleración de salida.",
        "section": "Velocidad → Curva",
        "status": "planned"
      },
      {
        "name": "Cámara lenta suave",
        "description": "Suavizar el movimiento al ralentizar la reproducción.",
        "section": "Velocidad → Curva",
        "status": "planned"
      }
    ]
  },
  {
    "id": 5,
    "name": "Animación",
    "tools": [
      {
        "name": "Entrada (In)",
        "description": "Animaciones que aparecen al comenzar el clip: desvanecimiento, zoom, desplazamiento, giro, entre otras.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Salida (Out)",
        "description": "Animaciones que se ejecutan al terminar el clip: desaparición, alejamiento, giro o desplazamiento.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Combinación (Combo)",
        "description": "Animaciones predefinidas que modifican el elemento durante su duración, en clips compatibles.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Bucle (Loop)",
        "description": "Animaciones de movimiento repetitivo, especialmente para texto.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Duración de animación",
        "description": "Controlar cuánto tiempo tarda una entrada o salida.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Keyframes personalizados",
        "description": "Crear movimientos propios sin depender de animaciones predefinidas.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 6,
    "name": "Audio",
    "tools": [
      {
        "name": "Música",
        "description": "Buscar canciones instrumentales, música de fondo y pistas por categorías.",
        "section": "Audio → Biblioteca",
        "status": "partial"
      },
      {
        "name": "Efectos de sonido",
        "description": "Buscar impactos, clics, sonidos de naturaleza, transiciones, ambiente y otros efectos.",
        "section": "Audio → Biblioteca",
        "status": "partial"
      },
      {
        "name": "Audio importado",
        "description": "Utilizar archivos MP3, WAV y otros formatos compatibles.",
        "section": "Audio → Biblioteca",
        "status": "ready"
      },
      {
        "name": "Audio extraído",
        "description": "Utilizar sonido separado previamente de un video.",
        "section": "Audio → Biblioteca",
        "status": "planned"
      },
      {
        "name": "Grabación de voz",
        "description": "Grabar narraciones con un micrófono.",
        "section": "Audio → Biblioteca",
        "status": "planned"
      },
      {
        "name": "Búsqueda de audio",
        "description": "Encontrar canciones o sonidos mediante palabras clave.",
        "section": "Audio → Biblioteca",
        "status": "planned"
      },
      {
        "name": "Volumen",
        "description": "Subir o bajar la intensidad de la pista.",
        "section": "Audio → Básico",
        "status": "ready"
      },
      {
        "name": "Fundido de entrada",
        "description": "Aumentar el volumen gradualmente al inicio.",
        "section": "Audio → Básico",
        "status": "ready"
      },
      {
        "name": "Fundido de salida",
        "description": "Disminuir progresivamente el volumen al final.",
        "section": "Audio → Básico",
        "status": "ready"
      },
      {
        "name": "Reducción de ruido",
        "description": "Atenuar ruido de fondo, zumbidos y sonidos indeseados.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Mejorar voz",
        "description": "Mejorar la claridad de una narración y reducir imperfecciones.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Normalización de sonoridad",
        "description": "Equilibrar automáticamente el volumen de audio.",
        "section": "Audio → Básico",
        "status": "ready"
      },
      {
        "name": "Aislamiento vocal",
        "description": "Separar o eliminar voces de pistas musicales.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Mantener voz",
        "description": "Conservar principalmente la parte vocal de una grabación.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Eliminar voz",
        "description": "Reducir o quitar la parte vocal para obtener un instrumental.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Velocidad de audio",
        "description": "Acelerar o ralentizar la pista sonora.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Tono (Pitch)",
        "description": "Cambiar la altura de la voz o del audio.",
        "section": "Audio → Básico",
        "status": "partial"
      },
      {
        "name": "División de audio",
        "description": "Cortar una pista para editar secciones independientes.",
        "section": "Audio → Básico",
        "status": "planned"
      },
      {
        "name": "Filtros de voz",
        "description": "Aplicar voces agudas, graves, dulces, estilo micrófono y otros efectos disponibles.",
        "section": "Audio → Cambiador de voz",
        "status": "ready"
      },
      {
        "name": "Efectos de personaje",
        "description": "Transformar la voz con estilos de personaje, cuando estén disponibles.",
        "section": "Audio → Cambiador de voz",
        "status": "ready"
      },
      {
        "name": "Efectos de voz especiales",
        "description": "Crear sonidos robóticos, artificiales o con efectos.",
        "section": "Audio → Cambiador de voz",
        "status": "ready"
      },
      {
        "name": "Personalización de efecto",
        "description": "Ajustar el resultado de los efectos compatibles.",
        "section": "Audio → Cambiador de voz",
        "status": "planned"
      }
    ]
  },
  {
    "id": 7,
    "name": "Texto y títulos",
    "tools": [
      {
        "name": "Texto predeterminado",
        "description": "Añadir un cuadro de texto independiente al video.",
        "section": "Texto → Agregar texto",
        "status": "ready"
      },
      {
        "name": "Fuente",
        "description": "Seleccionar la tipografía.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Tamaño",
        "description": "Modificar las dimensiones de las letras.",
        "section": "Texto → Agregar texto",
        "status": "ready"
      },
      {
        "name": "Color",
        "description": "Elegir el color del texto.",
        "section": "Texto → Agregar texto",
        "status": "ready"
      },
      {
        "name": "Negrita",
        "description": "Aumentar el grosor de las letras.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Cursiva",
        "description": "Inclinar el texto.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Alineación",
        "description": "Alinear el texto a la izquierda, centro o derecha.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Espaciado",
        "description": "Ajustar la separación entre caracteres y líneas.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Trazo / Contorno",
        "description": "Agregar bordes de color alrededor de las letras.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Sombra",
        "description": "Añadir sombras y ajustar sus características.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Fondo",
        "description": "Colocar un fondo detrás del texto cuando el estilo lo permita.",
        "section": "Texto → Agregar texto",
        "status": "ready"
      },
      {
        "name": "Opacidad",
        "description": "Modificar la transparencia.",
        "section": "Texto → Agregar texto",
        "status": "planned"
      },
      {
        "name": "Posición y rotación",
        "description": "Cambiar ubicación y orientación del texto.",
        "section": "Texto → Agregar texto",
        "status": "partial"
      },
      {
        "name": "Efectos de texto",
        "description": "Aplicar estilos visuales preconfigurados.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      },
      {
        "name": "Plantillas de texto",
        "description": "Utilizar títulos con diseños y animaciones listas.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      },
      {
        "name": "Animación de entrada",
        "description": "Hacer aparecer un título con movimiento.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      },
      {
        "name": "Animación de salida",
        "description": "Crear una desaparición animada.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      },
      {
        "name": "Animación en bucle",
        "description": "Mantener el texto animado de forma continua.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      },
      {
        "name": "Texto a voz (TTS)",
        "description": "Convertir texto escrito en una narración generada por IA.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      },
      {
        "name": "Keyframes",
        "description": "Controlar manualmente el movimiento del texto.",
        "section": "Texto → Recursos y animaciones",
        "status": "planned"
      }
    ]
  },
  {
    "id": 8,
    "name": "Subtítulos y transcripciones",
    "tools": [
      {
        "name": "Subtítulos automáticos",
        "description": "Reconocer la voz en español en este navegador, generar subtítulos con tiempos y corregirlos antes del MP4. Disponible en Editor → Texto.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Selección de idioma",
        "description": "Indicar el idioma hablado que debe reconocer CapCut.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Selección de fuente de audio",
        "description": "Elegir qué audio utilizar para generar los subtítulos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Subtítulos manuales",
        "description": "Escribir y sincronizar subtítulos manualmente.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Corrección de transcripción",
        "description": "Modificar palabras que la IA haya reconocido incorrectamente.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Sincronización temporal",
        "description": "Ajustar los momentos de aparición y desaparición de cada subtítulo.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Estilo de subtítulos",
        "description": "Personalizar fuente, tamaño, color y contorno.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Plantillas de subtítulos",
        "description": "Aplicar estilos prediseñados, incluidos formatos para redes sociales.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Animación de subtítulos",
        "description": "Aplicar entrada, salida y efectos disponibles.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Resaltado de palabras clave",
        "description": "Destacar palabras específicas, si la versión lo permite.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Subtítulos bilingües",
        "description": "Mostrar subtítulos traducidos a otro idioma, en versiones compatibles.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Importación de subtítulos",
        "description": "Trabajar con archivos de subtítulos externos cuando la versión lo admita.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Exportación SRT/TXT",
        "description": "Guardar subtítulos o transcripciones en formatos compatibles, según la versión.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Identificación de hablantes",
        "description": "Diferenciar participantes en una conversación, cuando esté disponible.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 9,
    "name": "Stickers / Pegatinas",
    "tools": [
      {
        "name": "Biblioteca de stickers",
        "description": "Acceder a gráficos y pegatinas prediseñados.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Stickers animados",
        "description": "Insertar gráficos que ya incluyen movimiento.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Emojis",
        "description": "Incorporar elementos gráficos expresivos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Elementos decorativos",
        "description": "Añadir flechas, corazones, símbolos y otros recursos disponibles.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Stickers de IA",
        "description": "Generar pegatinas mediante instrucciones de texto.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Escala y posición",
        "description": "Cambiar tamaño y ubicación de la pegatina.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Animación",
        "description": "Añadir movimiento a una pegatina.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Seguimiento de movimiento",
        "description": "Hacer que un sticker siga el movimiento de un objeto compatible.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 10,
    "name": "Efectos visuales",
    "tools": [
      {
        "name": "Tendencias",
        "description": "Efectos populares y estilos utilizados frecuentemente por creadores.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Básicos",
        "description": "Modificaciones visuales generales.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Lente",
        "description": "Distorsiones ópticas, destellos y efectos de cámara.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Retro",
        "description": "Estética VHS, película antigua y otros efectos vintage.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Glitch",
        "description": "Interferencias digitales, errores visuales y distorsiones.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Distorsión",
        "description": "Deformaciones de la imagen.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Desenfoque",
        "description": "Efectos de enfoque, desenfoque y movimiento borroso.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Luz",
        "description": "Destellos, resplandores y efectos de iluminación.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Chispas / Partículas",
        "description": "Partículas brillantes y efectos luminosos.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Naturaleza",
        "description": "Efectos ambientales y elementos naturales.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Amor",
        "description": "Corazones y elementos visuales románticos.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Discoteca / Fiesta",
        "description": "Luces de fiesta y efectos rítmicos.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Ajuste de intensidad",
        "description": "Controlar la fuerza del efecto seleccionado, cuando sea ajustable.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Duración del efecto",
        "description": "Determinar cuánto tiempo permanece visible.",
        "section": "Efectos → Efectos de video",
        "status": "planned"
      },
      {
        "name": "Efectos faciales",
        "description": "Modificaciones visuales vinculadas al rostro.",
        "section": "Efectos → Efectos corporales",
        "status": "planned"
      },
      {
        "name": "Efectos de cuerpo",
        "description": "Transformaciones o decoraciones asociadas a una persona.",
        "section": "Efectos → Efectos corporales",
        "status": "planned"
      },
      {
        "name": "Iluminación corporal",
        "description": "Resplandores y efectos luminosos aplicados a personas.",
        "section": "Efectos → Efectos corporales",
        "status": "planned"
      },
      {
        "name": "Rotación y movimiento",
        "description": "Animaciones o distorsiones de partes del cuerpo.",
        "section": "Efectos → Efectos corporales",
        "status": "planned"
      },
      {
        "name": "Efectos de seguimiento",
        "description": "Efectos que responden al movimiento detectado.",
        "section": "Efectos → Efectos corporales",
        "status": "planned"
      }
    ]
  },
  {
    "id": 11,
    "name": "Transiciones",
    "tools": [
      {
        "name": "Básicas",
        "description": "Fundidos, cambios suaves y transiciones sencillas.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Desenfoque (Blur)",
        "description": "Cambios de escena con pérdida temporal de enfoque.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Cámara",
        "description": "Movimientos simulados de cámara y cambios de perspectiva.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Deslizamiento (Slide)",
        "description": "Entrada y salida de imágenes mediante desplazamiento.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "División (Split)",
        "description": "Cambios entre clips mediante divisiones de pantalla.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Máscara (Mask)",
        "description": "Revelar el siguiente clip mediante una figura o máscara.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Luz (Light)",
        "description": "Flash, destellos y transiciones luminosas.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Glitch",
        "description": "Cortes con interferencias digitales.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Distorsión",
        "description": "Cambios de escena mediante deformaciones.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Superposición (Overlay)",
        "description": "Mezclar visualmente dos clips durante la transición.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "MG / Motion Graphics",
        "description": "Transiciones de estilo gráfico y animado.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Social Media",
        "description": "Estilos pensados para contenido de redes sociales.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Duración",
        "description": "Ajustar cuánto dura la transición.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Vista previa",
        "description": "Ver el resultado antes de confirmar la transición.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 12,
    "name": "Filtros",
    "tools": [
      {
        "name": "Mono",
        "description": "Filtros monocromáticos y blanco y negro.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Retro",
        "description": "Aspectos de fotografía y cine antiguos.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Estilo",
        "description": "Tratamientos visuales prediseñados.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Comida",
        "description": "Filtros orientados a mejorar tomas gastronómicas.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Escena nocturna",
        "description": "Estilos concebidos para imágenes nocturnas.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Cinematográficos",
        "description": "Looks de cine y tratamientos de color.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Intensidad del filtro",
        "description": "Controlar cuánto se aplica el filtro seleccionado.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Duración del filtro",
        "description": "Ajustar la sección de video sobre la que se aplica.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 13,
    "name": "Ajuste de color profesional",
    "tools": [
      {
        "name": "Temperatura",
        "description": "Modificar la calidez o frialdad de los colores.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Matiz",
        "description": "Desplazar el equilibrio de color hacia tonos verdes o magentas.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Saturación",
        "description": "Aumentar o disminuir la intensidad de los colores.",
        "section": "Ajuste → Básico",
        "status": "ready"
      },
      {
        "name": "Exposición",
        "description": "Aclarar u oscurecer la imagen globalmente.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Brillo",
        "description": "Modificar la luminosidad general.",
        "section": "Ajuste → Básico",
        "status": "ready"
      },
      {
        "name": "Contraste",
        "description": "Aumentar o disminuir la diferencia entre zonas claras y oscuras.",
        "section": "Ajuste → Básico",
        "status": "ready"
      },
      {
        "name": "Iluminaciones / Altas luces",
        "description": "Ajustar las zonas más luminosas.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Sombras",
        "description": "Recuperar o reducir detalle en las zonas oscuras.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Blancos",
        "description": "Modificar los niveles más claros.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Negros",
        "description": "Ajustar la profundidad de los tonos negros.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Nitidez",
        "description": "Resaltar bordes y detalles.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Vibrancia",
        "description": "Intensificar principalmente los colores menos saturados.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Viñeta",
        "description": "Oscurecer o modificar visualmente los bordes.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Grano",
        "description": "Añadir textura de película.",
        "section": "Ajuste → Básico",
        "status": "planned"
      },
      {
        "name": "Hue / Tono",
        "description": "Cambiar el tono de una gama de color seleccionada.",
        "section": "Ajuste → HSL",
        "status": "planned"
      },
      {
        "name": "Saturation / Saturación",
        "description": "Aumentar o reducir la intensidad de esa gama.",
        "section": "Ajuste → HSL",
        "status": "planned"
      },
      {
        "name": "Lightness / Luminosidad",
        "description": "Aclarar u oscurecer esa gama.",
        "section": "Ajuste → HSL",
        "status": "planned"
      },
      {
        "name": "Curva de luminancia",
        "description": "Ajustar la relación entre sombras, medios tonos y luces.",
        "section": "Ajuste → Curvas",
        "status": "planned"
      },
      {
        "name": "Curva roja",
        "description": "Controlar el canal rojo.",
        "section": "Ajuste → Curvas",
        "status": "planned"
      },
      {
        "name": "Curva verde",
        "description": "Controlar el canal verde.",
        "section": "Ajuste → Curvas",
        "status": "planned"
      },
      {
        "name": "Curva azul",
        "description": "Controlar el canal azul.",
        "section": "Ajuste → Curvas",
        "status": "planned"
      },
      {
        "name": "Puntos de control",
        "description": "Crear ajustes específicos sobre las curvas.",
        "section": "Ajuste → Curvas",
        "status": "planned"
      },
      {
        "name": "Sombras",
        "description": "Aplicar tonalidades a las zonas oscuras.",
        "section": "Ajuste → Ruedas de color",
        "status": "planned"
      },
      {
        "name": "Medios tonos",
        "description": "Modificar los colores de las zonas de luminosidad intermedia.",
        "section": "Ajuste → Ruedas de color",
        "status": "planned"
      },
      {
        "name": "Altas luces",
        "description": "Ajustar el color de las zonas luminosas.",
        "section": "Ajuste → Ruedas de color",
        "status": "planned"
      },
      {
        "name": "Equilibrio cromático",
        "description": "Combinar los ajustes para conseguir un aspecto coherente.",
        "section": "Ajuste → Ruedas de color",
        "status": "planned"
      },
      {
        "name": "Importar LUT",
        "description": "Cargar perfiles de color externos compatibles, como archivos `.cube`.",
        "section": "Ajuste → LUT",
        "status": "planned"
      },
      {
        "name": "Aplicar LUT",
        "description": "Utilizar un tratamiento de color predefinido.",
        "section": "Ajuste → LUT",
        "status": "planned"
      },
      {
        "name": "Ajustar intensidad",
        "description": "Controlar la fuerza del aspecto aplicado, cuando esté disponible.",
        "section": "Ajuste → LUT",
        "status": "planned"
      }
    ]
  },
  {
    "id": 14,
    "name": "Inteligencia artificial y automatizaciones",
    "tools": [
      {
        "name": "AI Video Generator",
        "description": "Generar clips a partir de instrucciones, con selección de modelo, formato y duración disponibles.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Texto a video",
        "description": "Escribir un prompt y generar una escena audiovisual.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Imagen a video",
        "description": "Subir una imagen y utilizarla como referencia para crear movimiento.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Guion a video",
        "description": "Convertir un guion en un borrador audiovisual con escenas y recursos.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Escritor de IA",
        "description": "Crear ideas y borradores de guiones a partir de un tema.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Texto a voz",
        "description": "Generar narraciones artificiales a partir de texto.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Avatares IA",
        "description": "Elegir personajes virtuales y hacerlos presentar un guion.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Generador de imágenes IA",
        "description": "Crear imágenes utilizando prompts de texto.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Generador de stickers IA",
        "description": "Crear pegatinas personalizadas.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Subtítulos IA",
        "description": "Reconocer conversaciones y producir subtítulos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Traducción de subtítulos",
        "description": "Generar subtítulos en otros idiomas.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "AutoCut",
        "description": "Producir primeros montajes automáticos a partir del contenido disponible.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "AI Clipper",
        "description": "Identificar fragmentos útiles para crear clips cortos.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Edición por transcripción",
        "description": "Editar contenido hablado utilizando su texto transcrito.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Eliminación de muletillas",
        "description": "Detectar y ayudar a eliminar expresiones repetitivas.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Corrección de contacto visual",
        "description": "Ajustar la dirección aparente de la mirada en material compatible.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Mejora de calidad IA",
        "description": "Aumentar la calidad aparente de un video.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Eliminación automática de fondo",
        "description": "Separar sujetos del fondo utilizando reconocimiento inteligente.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Reencuadre inteligente",
        "description": "Cambiar la proporción del video siguiendo al sujeto.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Mejorar voz IA",
        "description": "Limpiar y mejorar narraciones.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Aislamiento vocal IA",
        "description": "Separar voces y música.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "AI Story Maker",
        "description": "Transformar un tema en una propuesta audiovisual con guion, recursos y animaciones.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "AI Music",
        "description": "Generar recursos musicales mediante IA, donde esté habilitado.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "EditPilot",
        "description": "Dar instrucciones en lenguaje natural para preparar un primer montaje, reducir pausas, reorganizar escenas y editar contenido.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Asistente de contenido IA",
        "description": "Apoyar la investigación de tendencias, planificación y preparación de contenidos.",
        "section": "",
        "status": "planned"
      }
    ]
  },
  {
    "id": 15,
    "name": "Exportación y publicación",
    "tools": [
      {
        "name": "Nombre de archivo",
        "description": "Definir cómo se llamará el video exportado.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Ubicación de guardado",
        "description": "Elegir la carpeta de destino.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Resolución",
        "description": "Elegir entre las resoluciones admitidas, como 720p, 1080p o 4K.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Fotogramas por segundo (FPS)",
        "description": "Seleccionar la frecuencia de fotogramas disponible.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Calidad / Bitrate",
        "description": "Controlar la compresión y calidad del video final.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Formato",
        "description": "Seleccionar formatos disponibles, como MP4 o MOV.",
        "section": "",
        "status": "partial"
      },
      {
        "name": "Códec",
        "description": "Elegir el método de codificación disponible.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Exportación de audio",
        "description": "Guardar una salida de audio cuando la modalidad lo permita.",
        "section": "",
        "status": "planned"
      },
      {
        "name": "Exportación de subtítulos",
        "description": "Exportar archivos de subtítulos en las versiones compatibles.",
        "section": "",
        "status": "ready"
      },
      {
        "name": "Compartir en plataformas",
        "description": "Acceder a las opciones de publicación disponibles para YouTube y TikTok.",
        "section": "",
        "status": "planned"
      }
    ]
  }
];
