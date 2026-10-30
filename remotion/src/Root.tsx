import { Composition } from "remotion";
import { EdicionSemantica } from "./EdicionSemantica";
import ejemploJson from "./data/ejemplo.json";
import type { Timeline } from "./tipos";

// El editor pasa la línea de tiempo con --props; el ejemplo solo sirve para abrir el Studio.
const ejemplo = ejemploJson as unknown as Timeline;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="EdicionSemantica"
    component={EdicionSemantica}
    durationInFrames={Math.ceil(ejemplo.duracion * ejemplo.fps)}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ timeline: ejemplo }}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil(props.timeline.duracion * props.timeline.fps) })}
  />
);
