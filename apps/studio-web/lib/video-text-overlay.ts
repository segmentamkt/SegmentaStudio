import sharp from "sharp";

type TextOverlayOptions = {
  text: string;
  fontFile: string;
  fontSize: number;
  textColor: string;
  boxColor: string;
  boxOpacity: number;
  highlightLastWord?: boolean;
  highlightColor?: string;
};

function hexColor(value: string, fallback: string) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return fallback;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toUpperCase()}`;
}

function escapeMarkup(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Rasterize a compact transparent PNG with the bundled Inter font. FFmpeg's
 * Linux build can overlay PNGs even when its drawtext filter is unavailable.
 */
export async function renderTextOverlay(options: TextOverlayOptions): Promise<Buffer> {
  const safeText = options.text.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  if (!safeText) throw new Error("El texto de la superposición está vacío.");
  const fontSize = Number.isFinite(options.fontSize) ? Math.max(24, Math.min(100, options.fontSize)) : 54;
  const textColor = hexColor(options.textColor, "#FFFFFF");
  const highlightColor = hexColor(options.highlightColor || "#FACC15", "#FACC15");
  const boxColor = hexColor(options.boxColor, "#09090B");
  const padding = 24;
  const words = safeText.split(/\s+/);
  const textMarkup = options.highlightLastWord && words.length > 1
    ? `<span foreground="${textColor}">${escapeMarkup(words.slice(0, -1).join(" "))}</span>\n<span foreground="${highlightColor}" weight="bold">${escapeMarkup(words[words.length - 1])}</span>`
    : `<span foreground="${options.highlightLastWord ? highlightColor : textColor}">${escapeMarkup(safeText)}</span>`;
  const textImage = await sharp({
    text: {
      text: textMarkup,
      font: `Inter ${Math.round(fontSize * 1.2)}`,
      fontfile: options.fontFile,
      width: 960,
      align: "center",
      rgba: true,
    },
  }).png().toBuffer({ resolveWithObject: true });
  const maxHeight = 280;
  const letters = textImage.info.height > maxHeight
    ? await sharp(textImage.data).resize({ height: maxHeight, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
    : textImage;
  const background = {
    r: parseInt(boxColor.slice(1, 3), 16),
    g: parseInt(boxColor.slice(3, 5), 16),
    b: parseInt(boxColor.slice(5, 7), 16),
    alpha: Math.max(0, Math.min(1, options.boxOpacity)),
  };
  return sharp({
    create: {
      width: letters.info.width + padding * 2,
      height: letters.info.height + padding * 2,
      channels: 4,
      background,
    },
  }).composite([{ input: letters.data, left: padding, top: padding }]).png().toBuffer();
}
