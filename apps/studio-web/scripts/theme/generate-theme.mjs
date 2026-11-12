// Generates apps/studio-web/app/theme.css: light mode by mirroring Tailwind's palette and the app's dark hex tokens.
// Uso: node scripts/theme/generate-theme.mjs "$PWD" "$(cat scripts/theme/tokens.json)"
import fs from "node:fs";
const root = process.argv[2];
const themeCss = fs.readFileSync(`${root}/node_modules/tailwindcss/theme.css`, "utf8");
const palette = {};
for (const m of themeCss.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) (palette[m[1]] ??= {})[m[2]] = m[3].trim();
const mirror = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 };

// sRGB hex -> OKLCH and back, to invert the lightness of the app's own dark surfaces.
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToOklch(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => toLin(parseInt(h.length === 3 ? h[i / 2].repeat(2) : h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}
const fmt = ({ L, C, H }) => `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(4)} ${H.toFixed(2)})`;
/** Dark surface -> light surface with the same hue: 6% lightness becomes ~97%. */
const lightSurface = (hex) => { const c = hexToOklch(hex); return fmt({ L: Math.min(.985, 1.02 - c.L * .55), C: Math.min(c.C, .02), H: c.H }); };
/** Light accent text -> a darker shade of the same hue for white backgrounds. */
const darkText = (hex) => { const c = hexToOklch(hex); return fmt({ L: Math.max(.42, 1 - c.L + .05), C: c.C, H: c.H }); };

const tokens = JSON.parse(process.argv[3]); // { hex: "surface" | "text" }
const lines = [];
lines.push("/* Generado por scripts/theme (modo claro): espejo de la paleta de Tailwind y de las superficies propias. */");
lines.push("/* Oscuro es el tema por defecto; [data-theme=\"light\"] en <html> activa el claro. */");
lines.push(":root {");
for (const hex of Object.keys(tokens)) lines.push(`  --c-${hex.slice(1).toLowerCase()}: ${hex};`);
lines.push("}");
const light = [], dark = [];
for (const [name, shades] of Object.entries(palette)) {
  for (const [shade, value] of Object.entries(shades)) {
    const target = shades[mirror[shade]];
    if (target) light.push(`  --color-${name}-${shade}: ${target};`);
    dark.push(`  --color-${name}-${shade}: ${value};`);
  }
}
light.push(`  --color-white: ${palette.zinc[950]};`, "  --color-black: #fff;");
dark.push("  --color-white: #fff;", "  --color-black: #000;");
for (const [hex, kind] of Object.entries(tokens)) {
  const id = `--c-${hex.slice(1).toLowerCase()}`;
  if (kind === "surface") light.push(`  ${id}: ${lightSurface(hex)};`);
  if (kind === "text") light.push(`  ${id}: ${darkText(hex)};`);
  dark.push(`  ${id}: ${hex};`);
}
lines.push(":root[data-theme=\"light\"] {", "  color-scheme: light;", ...light, "}");
lines.push("/* Zonas que siempre se ven oscuras (video, cámara, sala de edición) dentro del tema claro. */");
lines.push(":root[data-theme=\"light\"] [data-theme=\"dark\"] {", "  color-scheme: dark;", ...dark, "}");
fs.writeFileSync(`${root}/app/theme.css`, lines.join("\n") + "\n");
console.log("tokens", Object.keys(tokens).length, "light vars", light.length);
