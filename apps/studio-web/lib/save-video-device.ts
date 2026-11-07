import { recordingMimeType } from './media-mime';

export type SaveVideoDeviceResult = {
  /** A successful share/download request cannot confirm a destination or gallery write. */
  mode: 'shared' | 'download' | 'cancelled';
  filename: string;
};

function videoMimeType(type: string, filename: string): string {
  const container = type.split(';', 1)[0].trim().toLowerCase();
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(container)) return recordingMimeType(container);
  if (container === 'video/x-m4v') return 'video/mp4';
  if ((!container || container === 'application/octet-stream') && /\.(mp4|m4v|webm|mov)$/i.test(filename)) {
    return recordingMimeType('', filename);
  }
  throw new Error('No reconocemos el formato del video. Usa un archivo MP4, MOV o WebM.');
}

/** Keep the real container extension even when a suggested title has a different one. */
export function videoDeviceFilename(filename: string, mimeType: string): string {
  const type = videoMimeType(mimeType, filename);
  const extension = type === 'video/webm' ? 'webm' : type === 'video/quicktime' ? 'mov' : 'mp4';
  const title = filename.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.(mp4|m4v|webm|mov)$/i, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150).trim() || 'video-segmenta';
  return `${title}.${extension}`;
}

/** This synchronous step keeps the click's user activation available for the share sheet. */
export function videoDeviceFile(blob: Blob, filename: string): File {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('Todavía no hay un video listo para guardar.');
  const mimeType = videoMimeType(blob.type, filename);
  return new File([blob], videoDeviceFilename(filename, mimeType), {
    type: mimeType,
    lastModified: blob instanceof File ? blob.lastModified : Date.now(),
  });
}

/**
 * Call directly from an explicit button click with an already prepared Blob.
 * Never fetch or convert media before this call: iOS transient activation can expire.
 * The OS chooses the destinations; the web app cannot confirm a write to Photos/Gallery.
 */
export async function saveVideoToDevice(blob: Blob, filename: string): Promise<SaveVideoDeviceResult> {
  const file = videoDeviceFile(blob, filename);
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') {
    throw new Error('Abre este video en el navegador para guardarlo en tu dispositivo.');
  }
  if (navigator.userActivation?.isActive === false) {
    throw new Error('Pulsa de nuevo Guardar en mi dispositivo para abrir las opciones del navegador.');
  }
  let canShareFile = false;
  if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
    try { canShareFile = navigator.canShare({ files: [file] }); } catch { /* Use download if file sharing is blocked. */ }
  }
  if (canShareFile) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return { mode: 'shared', filename: file.name };
    } catch (reason) {
      // AbortError also covers an empty share target list. Never download after cancellation.
      if (reason && typeof reason === 'object' && 'name' in reason && reason.name === 'AbortError') {
        return { mode: 'cancelled', filename: file.name };
      }
      // Unsupported/failed share requests still offer the original video as a download.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  try {
    document.body.appendChild(link);
    link.click();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('El navegador no pudo iniciar la descarga. Vuelve a pulsar Guardar en mi dispositivo.');
  } finally { link.remove(); }
  // Keep the URL alive long enough for mobile browsers to consume the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { mode: 'download', filename: file.name };
}
