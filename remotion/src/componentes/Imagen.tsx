import { Img, spring, staticFile, useVideoConfig } from "remotion";
import type { PropsEvento } from "../tipos";
import { fundido } from "../util";
import { useTema } from "../tema";

// Imagen de tu biblioteca de recursos (propia o con licencia), pedida en el libreto con [IMAGEN nombre].
export const Imagen: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const { fps } = useVideoConfig();
  const entra = spring({ frame: Math.round((t - e.inicio) * fps), fps, config: { damping: 14, mass: 0.7 } });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, e.inicio, e.fin, 0.15) }}>
      <div
        style={{
          position: "absolute", left: 90, top: 150, width: 900, height: 530, borderRadius: 28, overflow: "hidden",
          backgroundColor: "#1C1630", border: `6px solid ${tema.violeta}`,
          transform: `translateY(${(1 - entra) * 50}px) scale(${0.88 + 0.12 * entra})`,
        }}
      >
        <Img src={staticFile(String(e.params.archivo))} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    </div>
  );
};
