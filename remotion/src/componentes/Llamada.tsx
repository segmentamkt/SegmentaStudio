import { interpolate } from "remotion";
import type { PropsEvento } from "../tipos";
import { FUENTE, activa, fundido, progreso } from "../util";
import { useTema } from "../tema";

// Pantalla de llamada genérica: el nombre sale de lo dicho («Amigo») o es «Contacto»; sin número ni datos reales.
export const Llamada: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const g = { ...e.params, inicio: e.inicio, fin: e.fin } as { vibracion: [number, number][]; contesta: number; nombre: string; inicio: number; fin: number };
  const vibra = activa(t, g.vibracion);
  const sacudida = vibra ? Math.sin(t * 2 * Math.PI * 24) : 0;
  const contestada = progreso(t, g.contesta, g.contesta + 0.25);
  const entrada = progreso(t, g.inicio, g.inicio + 0.25);
  const segundos = Math.max(0, Math.floor(t - g.contesta));
  const pulso = ((t - g.inicio) % 0.8) / 0.8;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, g.inicio, g.fin, 0.15) }}>
      <div
        style={{
          position: "absolute", left: 280, top: 110, width: 520, height: 590, borderRadius: 64,
          backgroundColor: "#1C1630", border: "4px solid #6D5BD0", fontFamily: FUENTE, color: "white",
          transform: `translate(${sacudida * 8}px, ${(1 - entrada) * 80}px) rotate(${sacudida * 1.2}deg)`,
        }}
      >
        <div style={{ position: "absolute", top: 50, width: "100%", textAlign: "center", fontSize: 34, color: "#B9B0E8", fontWeight: 600 }}>
          {contestada > 0.5 ? `En llamada · 00:${String(segundos).padStart(2, "0")}` : "Llamada entrante"}
        </div>
        <div
          style={{
            position: "absolute", left: 160, top: 115, width: 200, height: 200, borderRadius: "50%",
            border: `6px solid ${tema.violeta}`, opacity: (1 - pulso) * (1 - contestada),
            transform: `scale(${1 + pulso * 0.35})`,
          }}
        />
        <div
          style={{
            position: "absolute", left: 160, top: 115, width: 200, height: 200, borderRadius: "50%", backgroundColor: tema.violeta,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 110, fontWeight: 900,
          }}
        >
          {g.nombre.charAt(0).toUpperCase()}
        </div>
        <div style={{ position: "absolute", top: 335, width: "100%", textAlign: "center", fontSize: 76, fontWeight: 900 }}>{g.nombre}</div>
        <div
          style={{
            position: "absolute", top: 440, left: interpolate(contestada, [0, 1], [80, 195]), width: 130, height: 130, borderRadius: "50%",
            backgroundColor: "#E5484D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 900,
          }}
        >
          ✕
        </div>
        <div
          style={{
            position: "absolute", top: 440, left: 310, width: 130, height: 130, borderRadius: "50%", backgroundColor: "#30A46C",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 900,
            opacity: 1 - contestada, transform: `scale(${1 - 0.5 * contestada})`,
          }}
        >
          ✓
        </div>
      </div>
    </div>
  );
};
