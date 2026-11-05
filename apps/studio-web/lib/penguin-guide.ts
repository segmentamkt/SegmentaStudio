export type GuideAction = { label: string; destination: "upload" | "record" | "edit" | "library" | "projects" | "skills" };
export type GuideAnswer = { text: string; action?: GuideAction };
export type GuideContext = { view: string; projectCount: number; approvedCount: number; readyCount: number };

export const GUIDE_SUGGESTIONS = ["¿Cómo empiezo?", "¿Cómo pongo subtítulos?", "¿Dónde veo mi video?", "¿Qué falta por crear?"];

function normalized(value: string) {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function guideNextStep(context: GuideContext): GuideAnswer {
  if (context.projectCount === 0) return { text: "Empecemos por tu primer proyecto. Sube tus videos o crea una grabación; después revisa cada toma y aprueba las que sirven.", action: { label: "Subir videos", destination: "upload" } };
  if (context.approvedCount === 0) return { text: "Ya tienes un proyecto. Abre Crear video y aprueba al menos una toma. Las descartadas y los bloopers no entrarán al montaje.", action: { label: "Revisar tomas", destination: "record" } };
  if (context.readyCount === 0) return { text: "Ya hay tomas aprobadas. En el Editor, pega el libreto, revisa el orden y los subtítulos de cada toma, elige un estilo y renderiza el MP4.", action: { label: "Abrir editor", destination: "edit" } };
  return { text: "Tienes un MP4 listo. Reprodúcelo completo en Mis videos, comprueba subtítulos, ritmo y sonido, y descarga la versión aprobada.", action: { label: "Ver mis videos", destination: "library" } };
}

export function answerPenguinGuide(question: string, context: GuideContext): GuideAnswer {
  const text = normalized(question);
  if (!text.trim()) return guideNextStep(context);
  if (/empez|inicio|primer|paso|flujo|tutorial|ayuda|como uso|como funciona/.test(text)) return guideNextStep(context);
  if (/clip|opus|video largo|video pesado|extracto|tendencia/.test(text)) return { text: "La extracción automática de clips de videos largos todavía está en desarrollo. El render actual admite hasta 12 segmentos y 2 minutos. Para una pieza corta, selecciona las tomas, recórtalas en la línea de tiempo y renderiza.", action: { label: "Abrir editor", destination: "edit" } };
  if (/subtitul|transcrip|srt|vtt|texto hablado/.test(text)) return { text: "En Editor → Texto activa Subtítulos. Luego selecciona cada segmento de la línea de tiempo y escribe lo que realmente se dice, o importa su archivo SRT/VTT. Revisa el MP4 final: el texto plano usa tiempos aproximados.", action: { label: "Abrir editor", destination: "edit" } };
  if (/libreto|guion|orden|cronolog|historia/.test(text)) return { text: "Pega el libreto completo en Editor → Libreto y recursos. Añade el texto hablado de cada toma. Cuando la coincidencia sea suficiente, pulsa Aplicar orden; si hay dudas, puedes mover las tomas manualmente.", action: { label: "Abrir editor", destination: "edit" } };
  if (/subir|cargar|importar|montar|archivo|video nuevo/.test(text)) return { text: "Pulsa Subir videos, selecciona varios MP4, MOV o WebM y crea un proyecto. Luego revisa cada archivo: aprueba las tomas útiles, descarta errores o márcalos como blooper.", action: { label: "Subir videos", destination: "upload" } };
  if (/grabar|camara|teleprompter|celular/.test(text)) return { text: "En Crear video abre una producción, elige una escena y activa la cámara. Puedes leer el libreto con el teleprompter. Al terminar, aprueba, repite o envía la toma a bloopers.", action: { label: "Ir a grabar", destination: "record" } };
  if (/resultado|mp4|render|export|descarg|donde.*video/.test(text)) return { text: "En Editor, primero pulsa Preparar edición y después Renderizar. Espera a que aparezca Resultado editado listo. También lo encontrarás en Mis videos, donde puedes reproducirlo y descargar el MP4.", action: { label: "Ver mis videos", destination: "library" } };
  if (/cort|divid|recort|pausa|silencio|tiempos? muertos?|duplic/.test(text)) return { text: "En la línea de tiempo selecciona un segmento. Ajusta Inicio y Final, indica el segundo para Dividir o usa Duplicar. En Efectos puedes activar Cortar silencios. Deshacer y Rehacer recuperan cambios manuales.", action: { label: "Abrir editor", destination: "edit" } };
  if (/sonido|audio|musica|volumen|voz|efecto sonoro/.test(text)) return { text: "En Editor → Audio ajusta el volumen de la toma y los sonidos de los cortes. Puedes silenciar la voz de un segmento. La biblioteca de música y la carga de pistas propias siguen en desarrollo.", action: { label: "Abrir editor", destination: "edit" } };
  if (/estilo|color|brillo|contraste|saturacion|velocidad|transicion|filtro/.test(text)) return { text: "En Editor → Estilos eliges el aspecto general. En Video ajustas velocidad, brillo, contraste y saturación de la toma seleccionada. En Efectos eliges las transiciones disponibles. Los cambios se aplican al próximo MP4.", action: { label: "Abrir editor", destination: "edit" } };
  if (/imagen|b.?roll|sticker|mascara|keyframe|croma/.test(text)) return { text: "Los apoyos visuales, capas de imágenes, stickers y máscaras aún no se renderizan en la web. El libreto sí propone recursos y rótulos; los rótulos se pueden aplicar al video. Puedes revisar el estado de cada herramienta en Editor → Herramientas.", action: { label: "Ver herramientas", destination: "edit" } };
  if (/claude|gemini|chatgpt|inteligencia artificial|agente|skill/.test(text)) return { text: "Esta guía responde con instrucciones de la plataforma y funciona sin claves API. La conexión conversacional con Claude y Gemini desde la web todavía no está activa. En Skills puedes ver las capacidades del editor y su estado real.", action: { label: "Ver skills", destination: "skills" } };
  if (/proyecto|portafolio|marca/.test(text)) return { text: "Un proyecto reúne libreto, escenas, tomas y exportaciones. Cambia de portafolio arriba para trabajar con otra marca; cada portafolio conserva su identidad y sus proyectos.", action: { label: "Ver proyectos", destination: "projects" } };
  return { text: "Puedo guiarte para subir videos, grabar, ordenar el libreto, editar tomas, poner subtítulos y encontrar el MP4. Pregúntame por una de esas acciones; si una herramienta aún está en desarrollo, te lo diré.", action: guideNextStep(context).action };
}
