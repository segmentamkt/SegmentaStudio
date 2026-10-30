import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Estilo, Marca, PropsEvento, Timeline } from "./tipos";
import { FUENTE, PANEL_ALTO, division, progreso } from "./util";
import { TEMA_KIKO, TemaContexto, type Tema } from "./tema";
import { Camara } from "./componentes/Camara";
import { MapaPais } from "./componentes/MapaPais";
import { Trofeo } from "./componentes/Trofeo";
import { Teclado } from "./componentes/Teclado";
import { Llamada } from "./componentes/Llamada";
import { Moneda } from "./componentes/Moneda";
import { Icono } from "./componentes/Icono";
import { Imagen } from "./componentes/Imagen";
import { TextoCinetico } from "./componentes/TextoCinetico";
import { Subtitulos } from "./componentes/Subtitulos";
import { Audios } from "./componentes/Audios";

// Librería de componentes: el planificador solo puede pedir estos nombres («sonido» no tiene parte visual).
const REGISTRO: Partial<Record<string, React.FC<PropsEvento>>> = {
  mapa_pais: MapaPais,
  trofeo: Trofeo,
  teclado: Teclado,
  llamada: Llamada,
  moneda: Moneda,
  icono: Icono,
  imagen: Imagen,
  texto_cinetico: TextoCinetico,
};

// Tarjeta final de la plantilla de marca: logo y llamado a la acción, después de la última palabra.
const Cierre: React.FC<{ marca: NonNullable<Marca>; tema: Tema }> = ({ marca, tema }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entra = progreso(frame / fps, 0, 0.35);
  return (
    <AbsoluteFill style={{ backgroundColor: tema.morado, alignItems: "center", justifyContent: "center", gap: 48, opacity: entra }}>
      {marca.logo && <Img src={staticFile(marca.logo)} style={{ width: 360, maxHeight: 360, objectFit: "contain" }} />}
      <div style={{ fontFamily: FUENTE, fontWeight: 900, fontSize: 92, color: "white", textAlign: "center", maxWidth: 860, lineHeight: 1.05 }}>
        {marca.cierre?.texto}
      </div>
      <div style={{ width: interpolate(entra, [0, 1], [0, 320]), height: 14, borderRadius: 7, backgroundColor: tema.amarillo }} />
    </AbsoluteFill>
  );
};

// «Retoques»: suavizado de piel (una copia desenfocada mezclada encima) y nitidez (laplaciano), en SVG.
const Retoque: React.FC<{ nitidez: number; suavizado: number }> = ({ nitidez, suavizado }) => {
  const k = (0.6 * nitidez).toFixed(3);
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <filter id="kiko-retoque" colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feGaussianBlur in="SourceGraphic" stdDeviation={2.2} result="suave" />
        <feComponentTransfer in="suave" result="suave_a">
          <feFuncA type="linear" slope={0.55 * suavizado} />
        </feComponentTransfer>
        <feMerge result="mezcla">
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="suave_a" />
        </feMerge>
        <feConvolveMatrix in="mezcla" order={3} preserveAlpha
          kernelMatrix={`0 -${k} 0 -${k} ${(1 + 4 * 0.6 * nitidez).toFixed(3)} -${k} 0 -${k} 0`} />
      </filter>
    </svg>
  );
};

// «Subtítulos» con tu tipografía: el render espera a que la fuente cargue antes del primer fotograma.
const FuentePropia: React.FC<{ archivo: string; familia: string }> = ({ archivo, familia }) => {
  const [espera] = useState(() => delayRender(`Tipografía ${familia}`));
  useEffect(() => {
    new FontFace(familia, `url(${staticFile(archivo)})`).load()
      .then((fuente) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(fuente))
      .catch(() => undefined) // si no carga, se usa Inter: mejor un subtítulo correcto que un render fallido
      .finally(() => continueRender(espera));
  }, [archivo, familia, espera]);
  return null;
};

// «Superposiciones»: rótulo con tu usuario al empezar, bajo la zona que tapan las apps. Con pantalla dividida
// baja a la esquina de la cámara para no tapar el gráfico del panel.
const Rotulo: React.FC<{ t: number; split: number; texto: string; hasta: number; tema: Tema }> = ({ t, split, texto, hasta, tema }) => {
  const opacidad = Math.min(progreso(t, 0.3, 0.6), 1 - progreso(t, hasta - 0.3, hasta));
  if (opacidad <= 0) return null;
  return (
    <div style={{
      position: "absolute", left: 60, top: split > 0.5 ? PANEL_ALTO + 40 : 170, padding: "14px 28px", borderRadius: 40, opacity: opacidad,
      backgroundColor: tema.morado, border: `4px solid ${tema.violeta}`, fontFamily: FUENTE, fontWeight: 800,
      fontSize: 44, color: "white", transform: `translateX(${(1 - opacidad) * -30}px)`,
    }}>
      {texto}
    </div>
  );
};

const POSICION_MARCA: Record<NonNullable<Estilo>["superposiciones"]["marca_posicion"], React.CSSProperties> = {
  derecha: { right: 22, top: 744 }, izquierda: { left: 22, top: 744 }, abajo: { left: 22, top: 1420 },
};

// Capas (de abajo arriba): V2 panel · V1 cámara · V3 gráficos + V4 texto cinético · V5 subtítulos · marca.
export const EdicionSemantica: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const split = division(t, timeline.layout.dividido);
  const marca = timeline.marca ?? null;
  const tema: Tema = { ...TEMA_KIKO, ...(marca?.colores ?? {}) };
  const finVoz = timeline.duracion_voz ?? timeline.duracion;
  const estilo = timeline.estilo ?? null;
  const capas = estilo?.superposiciones;

  return (
    <TemaContexto.Provider value={tema}>
      <AbsoluteFill style={{ backgroundColor: "#140A2E" }}>
        {estilo && (estilo.camara.nitidez > 0 || estilo.camara.suavizado > 0) && (
          <Retoque nitidez={estilo.camara.nitidez} suavizado={estilo.camara.suavizado} />
        )}
        {estilo?.subtitulos.fuente && <FuentePropia {...estilo.subtitulos.fuente} />}
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: 1080, height: PANEL_ALTO, overflow: "hidden",
            backgroundColor: tema.morado, borderBottom: `6px solid ${tema.violeta}`,
            opacity: split, transform: `translateY(${interpolate(split, [0, 1], [-120, 0])}px)`,
          }}
        >
          {timeline.eventos.map((evento) => {
            const Componente = REGISTRO[evento.componente];
            return Componente && t >= evento.inicio - 0.05 && t <= evento.fin + 0.05 ? (
              <Componente key={evento.id} t={t} e={evento} />
            ) : null;
          })}
        </div>
        <Camara t={t} split={split} timeline={timeline} />
        <Subtitulos t={t} split={split} tarjetas={timeline.subtitulos} estilo={estilo?.subtitulos} />
        {capas?.marco && t < finVoz && (
          <Img src={staticFile(capas.marco)} style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920 }} />
        )}
        {marca?.logo && marca.marca_de_agua && capas?.activas !== false && t < finVoz && (
          // Por defecto, orilla derecha a la altura de la franja de subtítulos: no tapa gráficos, cara ni los íconos de las apps.
          <Img src={staticFile(marca.logo)} style={{
            position: "absolute", width: 84, ...POSICION_MARCA[capas?.marca_posicion ?? "derecha"],
            opacity: capas?.marca_opacidad ?? 0.8,
          }} />
        )}
        {capas?.rotulo && <Rotulo t={t} split={split} texto={capas.rotulo.texto} hasta={capas.rotulo.hasta} tema={tema} />}
        {marca?.cierre?.texto && timeline.duracion > finVoz && (
          <Sequence from={Math.round(finVoz * fps)}>
            <Cierre marca={marca} tema={tema} />
          </Sequence>
        )}
        <Audios timeline={timeline} />
      </AbsoluteFill>
    </TemaContexto.Provider>
  );
};
