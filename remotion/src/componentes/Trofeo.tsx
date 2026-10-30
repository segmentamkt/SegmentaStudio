import { interpolate, random, spring, useVideoConfig } from "remotion";
import type { PropsEvento } from "../tipos";
import { FUENTE, fundido, progreso } from "../util";
import { useTema } from "../tema";


// Ráfaga breve (0,9 s) con física simple; las semillas fijas hacen el render reproducible.
const Confeti: React.FC<{ dt: number }> = ({ dt }) => {
  const tema = useTema();
  const colores = [tema.amarillo, "#009C3B", "#FFFFFF", tema.violeta, "#22C55E"];
  if (dt < 0 || dt > 0.9) return null;
  return (
    <>
      {Array.from({ length: 60 }, (_, i) => {
        const angulo = -Math.PI / 2 + (random(`a${i}`) - 0.5) * 2.4;
        const velocidad = 700 + random(`v${i}`) * 600;
        const x = 540 + Math.cos(angulo) * velocidad * dt;
        const y = 330 + Math.sin(angulo) * velocidad * dt + 0.5 * 1800 * dt * dt;
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: x, top: y, width: 14, height: 24, borderRadius: 3,
              backgroundColor: colores[i % colores.length], opacity: interpolate(dt, [0.6, 0.9], [1, 0], { extrapolateLeft: "clamp" }),
              transform: `rotate(${random(`r${i}`) * 360 + dt * 720 * (i % 2 ? 1 : -1)}deg)`,
            }}
          />
        );
      })}
    </>
  );
};

// Copa genérica dibujada a mano: sin logotipos ni parecido con trofeos registrados.
const Copa: React.FC = () => (
  <svg width={400} height={480} viewBox="0 0 400 480">
    <path d="M95 90 C 20 90, 20 220, 120 230" stroke="#E0A100" strokeWidth={22} fill="none" strokeLinecap="round" />
    <path d="M305 90 C 380 90, 380 220, 280 230" stroke="#E0A100" strokeWidth={22} fill="none" strokeLinecap="round" />
    <path d="M90 60 H310 V120 C310 230 250 290 200 295 C150 290 90 230 90 120 Z" fill="#F5B700" />
    <path d="M120 75 H150 V130 C150 200 170 240 190 262 C150 245 120 200 120 130 Z" fill="#FFE27A" opacity={0.75} />
    <rect x={80} y={45} width={240} height={28} rx={10} fill="#FFCB2E" />
    <polygon points="200,120 213,152 247,154 221,175 230,208 200,190 170,208 179,175 153,154 187,152" fill="#FFF3C4" />
    <rect x={182} y={295} width={36} height={70} fill="#E0A100" />
    <rect x={160} y={360} width={80} height={22} rx={8} fill="#F5B700" />
    <path d="M120 470 L145 382 H255 L280 470 Z" fill="#C98F00" />
    <rect x={105} y={450} width={190} height={30} rx={8} fill="#8F5F00" />
  </svg>
);

export const Trofeo: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const { fps } = useVideoConfig();
  const sube = spring({ frame: Math.round((t - e.inicio) * fps), fps, config: { damping: 12, mass: 0.8 } });
  const texto = progreso(t, e.params.texto_en, e.params.texto_en + 0.18);
  if (t < e.inicio) return null;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, e.inicio, e.fin, 0.12) }}>
      <Confeti dt={t - e.inicio - 0.1} />
      <div
        style={{
          position: "absolute", left: 340, top: 230,
          transform: `translateY(${(1 - sube) * 260}px) scale(${0.4 + 0.6 * sube})`, transformOrigin: "50% 100%",
        }}
      >
        <Copa />
      </div>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", fontFamily: FUENTE,
          fontSize: 120, fontWeight: 900, color: tema.amarillo, WebkitTextStroke: "12px #2E1065", paintOrder: "stroke fill",
          opacity: texto, transform: `scale(${interpolate(texto, [0, 1], [1.3, 1])})`,
        }}
      >
        {e.params.texto}
      </div>
    </div>
  );
};
