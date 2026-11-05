import { Upload, DetailedError } from "tus-js-client";

export const MAX_RENDER_BYTES = 48_000_000;

function endpointFor(projectUrl: string) {
  const url = new URL(projectUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectId = url.hostname.split(".")[0];
    return `${url.protocol}//${projectId}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return new URL("/storage/v1/upload/resumable", url).toString();
}

/** Uploads a bounded MP4 in 6 MB chunks with retries, without a long chunked POST. */
export async function uploadRenderedMp4(input: {
  bytes: Buffer;
  objectKey: string;
  accessToken: string;
  projectUrl: string;
  publishableKey: string;
}) {
  if (!input.bytes.length) throw new Error("El render produjo un MP4 vacío.");
  if (input.bytes.length > MAX_RENDER_BYTES) throw new Error("El MP4 supera el límite de 48 MB de esta edición. Divide el proyecto en videos más cortos.");
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(input.bytes, {
      endpoint: endpointFor(input.projectUrl),
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        apikey: input.publishableKey,
        "x-upsert": "true",
      },
      metadata: {
        bucketName: "kiko-videos",
        objectName: input.objectKey,
        contentType: "video/mp4",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: false,
      onSuccess: () => resolve(),
      onError: (error) => {
        const responseStatus = error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
        const networkCode = error instanceof DetailedError ? (error.causingError as NodeJS.ErrnoException | null)?.code : undefined;
        const detail = responseStatus ? `HTTP ${responseStatus}` : networkCode ? `red ${networkCode}` : "red o almacenamiento";
        reject(new Error(`No pudimos subir el MP4 al almacenamiento (${detail}).`, { cause: error }));
      },
    });
    upload.start();
  });
}
