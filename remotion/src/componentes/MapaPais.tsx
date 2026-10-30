import { useMemo } from "react";
import { Easing, interpolate, interpolateColors } from "remotion";
import { geoArea, geoBounds, geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, MultiPoint, Polygon } from "geojson";
import paisesJson from "../data/paises_110m.json";
import type { PropsEvento } from "../tipos";
import { FUENTE, PANEL_ALTO, ZONA_GRAFICO, fundido, progreso } from "../util";
import { useTema } from "../tema";

type Props = { id: string; nombre: string; subregion: string };
const paises = (paisesJson as unknown as FeatureCollection<Polygon, Props>).features;

// En países con territorios lejanos (Francia, EE. UU.) el encuadre usa el polígono más grande.
const principal = (pais: Feature<any, Props>): Feature<Polygon, Props> => {
  if (pais.geometry.type !== "MultiPolygon") return pais as Feature<Polygon, Props>;
  return pais.geometry.coordinates
    .map((coordenadas: Polygon["coordinates"]) => ({ ...pais, geometry: { type: "Polygon", coordinates: coordenadas } }) as Feature<Polygon, Props>)
    .sort((a: Feature<Polygon, Props>, b: Feature<Polygon, Props>) => geoArea(b) - geoArea(a))[0];
};

const prepararMapa = (id: string) => {
  const objetivo = paises.find((p) => p.properties.id === id);
  if (!objetivo) return null;
  // Se arranca mostrando la subregión (Sudamérica para Brasil) y se acerca al país.
  const vecinos = paises.filter((p) => p.properties.subregion === objetivo.properties.subregion).map(principal);
  const limites = vecinos.map((p) => geoBounds(p));
  const oeste = Math.min(...limites.map(([[x]]) => x));
  const este = Math.max(...limites.map(([, [x]]) => x));
  const sur = Math.max(-70, Math.min(...limites.map(([[, y]]) => y)));
  const norte = Math.min(80, Math.max(...limites.map(([, [, y]]) => y)));
  const marco: MultiPoint = { type: "MultiPoint", coordinates: [[oeste, sur], [este, norte], [oeste, norte], [este, sur]] };
  const proyeccion = geoMercator().fitExtent([[60, 40], [1020, ZONA_GRAFICO - 20]], marco);
  const trazado = geoPath(proyeccion);
  // Archipiélagos (Japón) se encuadran completos; países con territorios lejanos, por su parte principal.
  const [[px0, py0], [px1, py1]] = trazado.bounds(principal(objetivo));
  const [[tx0, ty0], [tx1, ty1]] = trazado.bounds(objetivo);
  const cercano = tx1 - tx0 <= 3 * Math.max(px1 - px0, 1) && ty1 - ty0 <= 3 * Math.max(py1 - py0, 1);
  return {
    nombre: objetivo.properties.nombre,
    caja: cercano ? trazado.bounds(objetivo) : trazado.bounds(principal(objetivo)),
    caminos: paises.map((p) => ({ id: p.properties.id, d: trazado(p) ?? "", destacado: p.properties.id === id })),
  };
};

// Natural Earth 1:110m (dominio público). El país se enciende con la palabra y la cámara se acerca.
export const MapaPais: React.FC<PropsEvento> = ({ t, e }) => {
  const tema = useTema();
  const mapa = useMemo(() => prepararMapa(e.params.pais), [e.params.pais]);
  if (!mapa) return null;
  const [[x0, y0], [x1, y1]] = mapa.caja;
  const bx = (x0 + x1) / 2;
  const by = (y0 + y1) / 2;
  const escalaMax = Math.max(1, Math.min(2.2, 0.75 * Math.min(1080 / Math.max(x1 - x0, 1), ZONA_GRAFICO / Math.max(y1 - y0, 1))));
  const z = progreso(t, e.params.zoom_inicio, e.params.zoom_fin, Easing.inOut(Easing.cubic));
  const s = 1 + (escalaMax - 1) * z;
  const transform = `translate(${bx + z * (540 - bx)} ${by + z * (ZONA_GRAFICO / 2 - by)}) scale(${s}) translate(${-bx} ${-by})`;
  const enciende = progreso(t, e.params.resalta, e.params.resalta + 0.2);
  const atenua = e.params.atenuar_desde != null ? progreso(t, e.params.atenuar_desde, e.params.atenuar_desde + 0.25) : 0;
  const entrada = progreso(t, e.inicio, e.inicio + 0.3);

  return (
    <div style={{ position: "absolute", inset: 0, opacity: fundido(t, e.inicio, e.fin, 0.15) }}>
      <svg
        width={1080}
        height={PANEL_ALTO}
        style={{ position: "absolute", inset: 0, opacity: 1 - 0.6 * atenua, transform: `translateY(${(1 - entrada) * -60}px)` }}
      >
        <g transform={transform}>
          {mapa.caminos.map((camino) => (
            <path
              key={camino.id}
              d={camino.d}
              fill={camino.destacado ? interpolateColors(enciende, [0, 1], ["#3A2A6B", tema.amarillo]) : "#3A2A6B"}
              stroke={camino.destacado ? interpolateColors(enciende, [0, 1], ["#6D5BD0", "#FFFFFF"]) : "#6D5BD0"}
              strokeWidth={camino.destacado ? 4 : 1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: 140, textAlign: "center", fontFamily: FUENTE,
          fontSize: Math.min(104, Math.floor(1700 / Math.max(6, mapa.nombre.length))), fontWeight: 900, color: "white", letterSpacing: 6,
          WebkitTextStroke: "12px #2E1065", paintOrder: "stroke fill",
          opacity: enciende * (1 - atenua), transform: `scale(${interpolate(enciende, [0, 1], [0.8, 1])})`,
        }}
      >
        {mapa.nombre.toUpperCase()}
      </div>
    </div>
  );
};
