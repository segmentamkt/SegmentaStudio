import { videoDeviceFilename } from './save-video-device';

export const MAX_DEVICE_COPY_BYTES = 100 * 1024 * 1024;
export const LARGE_DEVICE_COPY_MESSAGE = 'Este video supera 100 MB. Para guardarlo, usa el menú del reproductor si tu navegador ofrece la opción Guardar o Descargar.';

/** Limit a prepared local copy even if the signed storage response omits/misstates its size. */
export async function readTakeDeviceCopy(response: Response, signal: AbortSignal, fallbackMimeType = ''): Promise<Blob> {
  signal.throwIfAborted();
  if (!response.ok) throw new Error(response.status === 401 ? 'Tu sesión venció. Vuelve a entrar antes de preparar la copia.' : 'No pudimos cargar el video. Puedes volver a intentarlo.');
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_DEVICE_COPY_BYTES) {
    await response.body?.cancel();
    throw new Error(LARGE_DEVICE_COPY_MESSAGE);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  const mimeType = !contentType || contentType === 'application/octet-stream' ? fallbackMimeType : contentType;
  // Do not turn a login/error HTML response into a pretend MP4.
  try { videoDeviceFilename('toma', mimeType); }
  catch (reason) { await response.body?.cancel(); throw reason; }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('El navegador no pudo leer este video. Inténtalo de nuevo.');
  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DEVICE_COPY_BYTES) throw new Error(LARGE_DEVICE_COPY_MESSAGE);
      chunks.push(value.slice().buffer);
    }
    if (!totalBytes) throw new Error('El archivo de video está vacío. Intenta prepararlo otra vez.');
    return new Blob(chunks, { type: mimeType });
  } catch (reason) {
    await reader.cancel().catch(() => undefined);
    throw reason;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
