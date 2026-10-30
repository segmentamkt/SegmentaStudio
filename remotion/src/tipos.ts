export type Ventana = [number, number];

export type Palabra = { i: number; texto: string; inicio: number; fin: number };

export type Tarjeta = {
  inicio: number;
  fin: number;
  palabras: { texto: string; inicio: number; clave: boolean }[];
};

export type Zoom = { inicio: number; fin: number; de: number; a: number; hasta: number; motivo?: string };

export type Sonido = { archivo: string; inicio: number; ancla: string; referencia?: number; dentro?: Ventana };

/** Un evento del plan: qué componente, cuándo y con qué parámetros (todo anclado a palabras reales). */
export type Evento = {
  id: string;
  componente: "mapa_pais" | "trofeo" | "teclado" | "llamada" | "moneda" | "icono" | "texto_cinetico" | "imagen" | "sonido";
  inicio: number;
  fin: number;
  ancla: { i0: number; i1: number; texto: string };
  params: Record<string, any>;
  sonidos: Sonido[];
  grupo: string | null;
};

/** Trozo de la toma original (desde–hasta, en segundos de origen) colocado en `salida` del video final. */
export type Tramo = { desde: number; hasta: number; salida: number; clip?: number };

export type FuenteClip = { clip: string | null; voz: string };

export type Marca = {
  colores?: { morado?: string; violeta?: string; amarillo?: string };
  logo?: string | null;
  marca_de_agua?: boolean;
  cierre?: { texto?: string; duracion?: number };
} | null;

/** Lo que piden las skills de Kiko Studio para este render (null: valores de siempre). */
export type Estilo = {
  camara: { filtro: string; nitidez: number; suavizado: number; vineta: number; zoom_lento: boolean };
  subtitulos: {
    activos: boolean; centro_completo: number; escala: number; resaltado: string | null;
    fuente: { archivo: string; familia: string } | null;
  };
  superposiciones: {
    activas: boolean; marca_posicion: "derecha" | "izquierda" | "abajo"; marca_opacidad: number;
    rotulo: { texto: string; hasta: number } | null; marco: string | null;
  };
  audio: { sfx_volumen: number };
} | null;

export type Timeline = {
  version: number;
  fps: number;
  ancho: number;
  alto: number;
  duracion: number;
  duracion_voz?: number;
  fuente: { tipo: "voz_guia" | "clip"; clip: string | null; inicio_clip: number; voz: string; clips?: FuenteClip[] };
  tramos?: Tramo[];
  marca?: Marca;
  estilo?: Estilo;
  palabras: Palabra[];
  subtitulos: Tarjeta[];
  layout: { dividido: Ventana[] };
  camara: { zoom: Zoom[] };
  eventos: Evento[];
  sonidos: Sonido[];
  musica: null | {
    archivo: string;
    volumen_bajo: number;
    volumen_alto: number;
    ventanas_voz: Ventana[];
    fade_out: Ventana;
  };
};

export type PropsEvento = { t: number; e: Evento };
