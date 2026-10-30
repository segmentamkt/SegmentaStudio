import type { PropsEvento } from "../tipos";
import { FUENTE, fundido, progreso } from "../util";
import { useTema } from "../tema";

const FILAS = [12, 11, 10, 9];
const TECLA = 68;
const SEPARACION = 8;

// Teclado de computador (el contexto «escribirlo» descarta el teclado musical).
export const Teclado: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const pulsaciones: number[] = e.params.pulsaciones ?? [];
  const pulsadas = new Set(
    pulsaciones.flatMap((p, i) => (t >= p && t < p + 0.12 ? [(i * 7 + 3) % 42] : [])),
  );
  const escritas = pulsaciones.filter((p) => t >= p).length;
  const entrada = progreso(t, e.inicio, e.inicio + 0.3);
  let indice = 0;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, e.inicio, e.fin, 0.15) }}>
      <div
        style={{
          position: "absolute", left: 140, top: 150, width: 800, height: 110, borderRadius: 24,
          backgroundColor: "#F4F1FF", display: "flex", alignItems: "center", paddingLeft: 40,
          fontFamily: FUENTE, fontSize: 64, fontWeight: 900, color: "#2E1065", letterSpacing: 10,
        }}
      >
        {"•".repeat(escritas * 3)}
        <span style={{ opacity: Math.floor(t * 2.5) % 2 ? 0 : 1, color: tema.violeta }}>|</span>
      </div>
      <div
        style={{
          position: "absolute", left: 70, top: 320, width: 940, padding: 22, borderRadius: 32, backgroundColor: "#1E1B2E",
          boxShadow: "0 24px 0 #0E0B1A",
          transform: `perspective(1400px) rotateX(24deg) translateY(${(1 - entrada) * 120}px)`,
        }}
      >
        {FILAS.map((columnas, fila) => (
          <div key={fila} style={{ display: "flex", justifyContent: "center", gap: SEPARACION, marginBottom: SEPARACION }}>
            {Array.from({ length: columnas }, () => {
              const activa = pulsadas.has(indice++);
              return (
                <div
                  key={indice}
                  style={{
                    width: TECLA, height: 60, borderRadius: 12,
                    backgroundColor: activa ? tema.violeta : "#3B3552",
                    boxShadow: activa ? "0 1px 0 #1A1530" : "0 6px 0 #14111F",
                    transform: `translateY(${activa ? 5 : 0}px)`,
                  }}
                />
              );
            })}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width: 460, height: 60, borderRadius: 12, backgroundColor: "#3B3552", boxShadow: "0 6px 0 #14111F" }} />
        </div>
      </div>
    </div>
  );
};
