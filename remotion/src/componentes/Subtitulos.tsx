import { interpolate } from "remotion";
import type { Estilo, Tarjeta } from "../tipos";
import { FUENTE, SUBTITULO_DIVIDIDO, progreso } from "../util";
import { useTema } from "../tema";

type Props = { t: number; split: number; tarjetas: Tarjeta[]; estilo?: NonNullable<Estilo>["subtitulos"] };

// Tarjetas de 2–4 palabras; la clave va en amarillo y la palabra que suena crece un poco.
// Plano completo: 72 % (debajo de la barbilla). Pantalla dividida: franja inferior del panel morado,
// porque ahí la cara ocupa casi toda la mitad de abajo.
export const Subtitulos: React.FC<Props> = ({ t, split, tarjetas, estilo }) => {
  const tema = useTema();
  const tarjeta = tarjetas.find((item) => t >= item.inicio && t < item.fin);
  if (!tarjeta || estilo?.activos === false) return null;
  // Salta de posición a mitad de la transición: deslizarse cruzaría la cara.
  const dividido = split > 0.5;
  const centro = dividido ? SUBTITULO_DIVIDIDO : estilo?.centro_completo ?? 1920 * 0.72;
  const escala = estilo?.escala ?? 1;
  const familia = estilo?.fuente ? `"${estilo.fuente.familia}", ${FUENTE}` : FUENTE;
  const entra = progreso(t, tarjeta.inicio, tarjeta.inicio + 0.1);
  const sonando = [...tarjeta.palabras].reverse().find((p) => t >= p.inicio);
  return (
    <div
      style={{
        position: "absolute", left: 110, width: 860, top: centro - 130 * escala, height: 260 * escala,
        display: "flex", flexWrap: "wrap", alignItems: "center", alignContent: "center", justifyContent: "center",
        columnGap: 34, rowGap: 0, transform: `scale(${interpolate(entra, [0, 1], [0.92, 1])})`,
      }}
    >
      {tarjeta.palabras.map((palabra, i) => (
        <span
          key={i}
          style={{
            fontFamily: familia, fontSize: (dividido ? 72 : 84) * escala, fontWeight: 900, lineHeight: 1.1, letterSpacing: 1,
            color: palabra.clave ? estilo?.resaltado ?? tema.amarillo : "white",
            WebkitTextStroke: "11px #0B0618", paintOrder: "stroke fill",
            textShadow: "0 6px 18px rgba(0,0,0,0.45)",
            transform: `scale(${palabra === sonando ? 1.05 : 1})`, display: "inline-block",
          }}
        >
          {palabra.texto}
        </span>
      ))}
    </div>
  );
};
