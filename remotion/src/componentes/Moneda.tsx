import { interpolate } from "remotion";
import type { PropsEvento } from "../tipos";
import { FUENTE, fundido, progreso } from "../util";

const DIAMETRO = 240;
const SUELO = 420;

// Moneda genérica (no reproduce ninguna de curso legal): sube girando y cae justo al final de «moneda».
export const Moneda: React.FC<PropsEvento> = ({ t, e }) => {
  const g = { inicio: e.inicio, fin: e.fin, aterriza: e.params.aterriza as number };
  const despegue = g.inicio + 0.08;
  const vuelo = Math.min(1, Math.max(0, (t - despegue) / (g.aterriza - despegue)));
  const angulo = vuelo * 6 * 2 * Math.PI;
  const coseno = Math.cos(angulo);
  const tras = t - g.aterriza;
  const rebote = tras > 0 ? -30 * Math.exp(-12 * tras) * Math.abs(Math.sin(18 * tras)) : 0;
  const y = SUELO - 380 * 4 * vuelo * (1 - vuelo) + rebote;
  const aparece = progreso(t, g.inicio, g.inicio + 0.1);
  const destello = tras > 0 && tras < 0.3 ? tras / 0.3 : -1;
  const cara = coseno >= 0;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, g.inicio, g.fin, 0.12) }}>
      <div
        style={{
          position: "absolute", left: 540 - 110, top: 660, width: 220, height: 40, borderRadius: "50%", backgroundColor: "black",
          opacity: 0.35 * (1 - (SUELO - y) / 450), transform: `scale(${1 - (SUELO - y) / 700})`,
        }}
      />
      {destello >= 0 && (
        <div
          style={{
            position: "absolute", left: 540, top: y + DIAMETRO / 2, width: 2 * interpolate(destello, [0, 1], [130, 270]),
            aspectRatio: "1", borderRadius: "50%", border: "10px solid rgba(255, 228, 120, 1)", boxSizing: "border-box",
            opacity: 0.7 * (1 - destello), transform: "translate(-50%, -50%)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute", left: 540 - DIAMETRO / 2, top: y, width: DIAMETRO, height: DIAMETRO, borderRadius: "50%",
          backgroundColor: "#8A6100", transform: `translateY(${Math.sin(angulo) * 12}px) scaleY(${Math.max(Math.abs(coseno), 0.08)}) scale(${aparece})`,
        }}
      />
      <div
        style={{
          position: "absolute", left: 540 - DIAMETRO / 2, top: y, width: DIAMETRO, height: DIAMETRO, borderRadius: "50%", boxSizing: "border-box",
          backgroundColor: cara ? "#E8B923" : "#D9C27A", border: "14px solid #B8860B",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: FUENTE, fontWeight: 900, fontSize: cara ? 120 : 130, color: "#8A6100",
          transform: `scaleY(${Math.max(Math.abs(coseno), 0.04)}) scale(${aparece})`,
        }}
      >
        {cara ? "★" : "1"}
      </div>
    </div>
  );
};
