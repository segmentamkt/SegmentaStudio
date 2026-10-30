// Reduce Natural Earth 1:110m (dominio público) a lo que usa MapaPais: código, nombre en español y subregión.
import { readFileSync, writeFileSync } from "node:fs";

const fuente = new URL("../fuentes/natural-earth/ne_110m_admin_0_countries.geojson", import.meta.url);
const destino = new URL("../src/data/paises_110m.json", import.meta.url);

const mundo = JSON.parse(readFileSync(fuente, "utf8"));
const redondear = (valor) => (Array.isArray(valor) ? valor.map(redondear) : Math.round(valor * 1000) / 1000);
const salida = {
  type: "FeatureCollection",
  fuente: "Natural Earth 1:110m admin 0 countries (dominio público)",
  features: mundo.features.map((feature) => ({
    type: "Feature",
    properties: {
      id: feature.properties.ADM0_A3,
      nombre: feature.properties.NAME_ES || feature.properties.NAME,
      subregion: feature.properties.SUBREGION,
    },
    geometry: { type: feature.geometry.type, coordinates: redondear(feature.geometry.coordinates) },
  })),
};

writeFileSync(destino, JSON.stringify(salida));
console.log(`Países listos: ${salida.features.length}`);
