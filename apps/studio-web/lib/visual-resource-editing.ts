import { MAX_VISUAL_IMAGE_BYTES, visualImageByteLength, type VisualResource, type VisualResourceImage } from './visual-resources';

/** Keep source timestamps when the user trims or splits a take. */
export function fitVisualResources(resources: VisualResource[], from: number, to: number): VisualResource[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return [];
  return resources.filter((item) => Number.isFinite(item.startSeconds) && Number.isFinite(item.endSeconds))
    .map((item) => ({ ...item, startSeconds: Math.max(from, item.startSeconds), endSeconds: Math.min(to, item.endSeconds) }))
    .filter((item) => item.endSeconds - item.startSeconds >= .1 - 1e-6);
}

/** Resize on-device before it becomes a draft/API payload; raw photos never enter the render request. */
export async function prepareVisualImage(file: File): Promise<VisualResourceImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Usa una foto PNG, JPEG o WebP de hasta 8 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error('No pudimos leer esa imagen. Usa otra foto PNG, JPEG o WebP.'); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('Reduce la resolución de esta imagen antes de añadirla.');
    const canvas = document.createElement('canvas');
    for (const size of [640, 480, 320]) {
      const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No pudimos preparar la imagen en este navegador.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/webp', .82);
      try {
        if (visualImageByteLength(dataUrl) <= MAX_VISUAL_IMAGE_BYTES) return { kind: 'upload', dataUrl, title: file.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || 'Imagen propia' };
      } catch { /* Retry with fewer pixels. */ }
    }
    throw new Error('La imagen sigue siendo demasiado grande. Usa una versión más pequeña.');
  } finally { URL.revokeObjectURL(url); }
}
