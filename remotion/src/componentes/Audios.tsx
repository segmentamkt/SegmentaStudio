import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { Timeline } from "../tipos";
import { fuenteDe, tramosDe } from "../util";

const db = (valor: number) => 20 * Math.log10(Math.max(valor, 1e-6));

// Música: baja 10 dB mientras hablas (ataque 80 ms, relajación 300 ms) y se funde al final.
const volumenMusica = (t: number, musica: NonNullable<Timeline["musica"]>) => {
  const voz = Math.max(
    0,
    ...musica.ventanas_voz.map(([a, b]) => {
      if (t >= a && t <= b) return 1;
      if (t >= a - 0.08 && t < a) return (t - (a - 0.08)) / 0.08;
      if (t > b && t <= b + 0.3) return 1 - (t - b) / 0.3;
      return 0;
    }),
  );
  const ganancia = db(musica.volumen_alto) + (db(musica.volumen_bajo) - db(musica.volumen_alto)) * voz;
  const [salidaA, salidaB] = musica.fade_out;
  const fundido = Math.min(1, t / 0.3, t >= salidaA ? Math.max(0, (salidaB - t) / (salidaB - salidaA)) : 1);
  return 10 ** (ganancia / 20) * fundido;
};

export const Audios: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  const { fuente, musica } = timeline;
  return (
    <>
      {tramosDe(timeline).map((tramo, i) => (
        <Sequence key={`voz${i}`} from={Math.round(tramo.salida * fps)} durationInFrames={Math.round((tramo.hasta - tramo.desde) * fps)} layout="none">
          <Audio src={staticFile(fuenteDe(timeline, tramo).voz)} trimBefore={Math.round((fuente.inicio_clip + tramo.desde) * fps)} />
        </Sequence>
      ))}
      {timeline.sonidos.map((sonido, i) => (
        <Sequence key={i} from={Math.max(0, Math.round(sonido.inicio * fps))} layout="none">
          <Audio src={staticFile(sonido.archivo)} volume={Math.min(1, timeline.estilo?.audio.sfx_volumen ?? 1)} />
        </Sequence>
      ))}
      {musica && <Audio src={staticFile(musica.archivo)} loop volume={(f) => volumenMusica(f / fps, musica)} />}
    </>
  );
};
