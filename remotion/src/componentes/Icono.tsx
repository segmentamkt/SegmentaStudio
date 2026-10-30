import { interpolate, spring, useVideoConfig } from "remotion";
import type { PropsEvento } from "../tipos";
import { FUENTE, fundido } from "../util";
import { useTema } from "../tema";

// Ícono Tabler (MIT) que el planificador validó y copió al plan; la etiqueta es la palabra dicha.
export const Icono: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: Math.round((t - e.inicio) * fps), fps, config: { damping: 11, mass: 0.6 } });
  const svg = String(e.params.svg ?? "")
    .replace(/width="24"/, 'width="100%"')
    .replace(/height="24"/, 'height="100%"')
    .replace(/stroke-width="2"/, 'stroke-width="1.6"');
  const etiqueta = String(e.params.etiqueta ?? "");
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, e.inicio, e.fin, 0.12) }}>
      <div
        style={{
          position: "absolute", left: 540 - 210, top: 150, width: 420, height: 420, borderRadius: "50%",
          backgroundColor: tema.violeta, border: "10px solid #A78BFA", boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "center",
          transform: `scale(${0.3 + 0.7 * pop}) rotate(${interpolate(pop, [0, 1], [-12, 0])}deg)`,
        }}
      >
        <div style={{ width: 260, height: 260, color: "white" }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: 590, textAlign: "center", fontFamily: FUENTE,
          fontSize: Math.min(88, Math.floor(1500 / Math.max(6, etiqueta.length))), fontWeight: 900, color: tema.amarillo,
          WebkitTextStroke: "10px #2E1065", paintOrder: "stroke fill", opacity: pop,
        }}
      >
        {etiqueta || null}
      </div>
    </div>
  );
};
