import { Easing, OffthreadVideo, Sequence, interpolate, staticFile } from "remotion";
import type { Timeline, Zoom } from "../tipos";
import { FUENTE, PANEL_ALTO, fuenteDe, tramosDe } from "../util";

const zoomEn = (t: number, zooms: Zoom[]) => {
  const vigente = [...zooms].reverse().find((z) => t >= z.inicio && t < z.hasta);
  if (!vigente) return 1;
  if (vigente.fin <= vigente.inicio) return vigente.a; // cambio de encuadre instantáneo en un corte
  return interpolate(t, [vigente.inicio, vigente.fin], [vigente.de, vigente.a], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
};

// Mientras no llega tu clip: silueta neutra, sin simular un rostro real.
const Marcador: React.FC<{ alto: number }> = ({ alto }) => (
  <div style={{ position: "absolute", inset: 0, backgroundColor: "#1F1B2E" }}>
    <div
      style={{
        position: "absolute", left: "50%", top: "40%", width: alto * 0.22, height: alto * 0.22,
        transform: "translate(-50%, -50%)", borderRadius: "50%", backgroundColor: "#3B3355",
      }}
    />
    <div
      style={{
        position: "absolute", left: "50%", top: "56%", width: alto * 0.55, height: alto * 0.5,
        transform: "translateX(-50%)", borderRadius: "48% 48% 0 0", backgroundColor: "#3B3355",
      }}
    />
    <div style={{ position: "absolute", left: 48, top: 40, fontFamily: FUENTE, fontSize: 30, color: "#9C93C9", fontWeight: 700 }}>
      CÁMARA · voz guía sintética (clip pendiente)
    </div>
  </div>
);

// «Edición y ritmo»: acercamiento lento (4 %) a lo largo de cada tramo.
const acercamiento = (t: number, timeline: Timeline) => {
  const tramo = tramosDe(timeline).find((x) => t >= x.salida && t < x.salida + (x.hasta - x.desde));
  return tramo ? 1 + 0.04 * ((t - tramo.salida) / (tramo.hasta - tramo.desde)) : 1;
};

export const Camara: React.FC<{ t: number; split: number; timeline: Timeline }> = ({ t, split, timeline }) => {
  const top = interpolate(split, [0, 1], [0, PANEL_ALTO + 6]);
  const alto = timeline.alto - top;
  const { fuente, fps } = timeline;
  const estilo = timeline.estilo?.camara;
  // Filtro de color y brillo de las skills; nitidez y suavizado van por el filtro SVG de EdicionSemantica.
  const filtro = [estilo?.filtro, estilo && (estilo.nitidez > 0 || estilo.suavizado > 0) ? "url(#kiko-retoque)" : ""]
    .filter(Boolean).join(" ");
  const escala = zoomEn(t, timeline.camara.zoom) * (estilo?.zoom_lento ? acercamiento(t, timeline) : 1);
  return (
    <div style={{ position: "absolute", left: 0, top, width: timeline.ancho, height: alto, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${escala})`, transformOrigin: "50% 38%", filter: filtro || undefined }}>
        {fuente.clip ? (
          // Cada tramo del montaje es un trozo de la toma original colocado en su lugar del video final.
          tramosDe(timeline).map((tramo, i) => (
            <Sequence key={i} from={Math.round(tramo.salida * fps)} durationInFrames={Math.round((tramo.hasta - tramo.desde) * fps)}>
              <OffthreadVideo
                src={staticFile(fuenteDe(timeline, tramo).clip ?? fuente.clip!)}
                muted
                trimBefore={Math.round((fuente.inicio_clip + tramo.desde) * fps)}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 30%" }}
              />
            </Sequence>
          ))
        ) : (
          <Marcador alto={alto} />
        )}
      </div>
      {estilo && estilo.vineta > 0 && (
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 42%, transparent 52%, rgba(0,0,0,${(0.65 * estilo.vineta).toFixed(3)}) 100%)` }} />
      )}
    </div>
  );
};
