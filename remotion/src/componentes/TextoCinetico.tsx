import { interpolate, spring, useVideoConfig } from "remotion";
import type { PropsEvento } from "../tipos";
import { FUENTE, ZONA_GRAFICO, fundido } from "../util";
import { useTema } from "../tema";

// La cifra o el concepto exactamente como se dijo; el planificador nunca escribe aquí datos propios.
export const TextoCinetico: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const { fps } = useVideoConfig();
  const golpe = spring({ frame: Math.round((t - e.inicio) * fps), fps, config: { damping: 9, mass: 0.5 } });
  const texto = String(e.params.texto ?? "");
  const cifra = e.params.estilo === "cifra";
  // Las cifras van en una línea; las frases largas pasan a dos o tres líneas en vez de achicarse.
  // Tope por la palabra más larga: una palabra no se puede partir y debe caber en 1000 px («ABSOLUTAMENTE»).
  const palabraMasLarga = Math.max(...texto.split(/\s+/).map((palabra) => palabra.length), 1);
  const tamano = Math.min(
    cifra ? Math.min(260, Math.floor(2600 / Math.max(4, texto.length))) : Math.min(150, Math.max(84, Math.floor(2800 / Math.max(4, texto.length)))),
    Math.floor(1000 / (palabraMasLarga * 0.72)),
  );
  return (
    <div
      style={{
        position: "absolute", left: 40, right: 40, top: 0, height: ZONA_GRAFICO, display: "flex", alignItems: "center",
        justifyContent: "center", textAlign: "center", opacity: fundido(t, e.inicio, e.fin, 0.1),
      }}
    >
      <div
        style={{
          fontFamily: FUENTE, fontWeight: 900, fontSize: tamano, lineHeight: 1, color: cifra ? tema.amarillo : "white",
          WebkitTextStroke: "14px #1A0B3D", paintOrder: "stroke fill",
          transform: `scale(${interpolate(golpe, [0, 1], [1.6, 1])}) rotate(${interpolate(golpe, [0, 1], [-4, 0])}deg)`,
          opacity: Math.min(1, golpe * 2),
        }}
      >
        {texto}
      </div>
    </div>
  );
};
