import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from "@huggingface/transformers";
import { transcriptionFromChunks, type SpeechTranscription } from "./transcription-core";

export type SpeechWorkerRequest = { id: string; waveform: Float32Array; durationSeconds: number; maxWords: number };
export type SpeechWorkerMessage =
  | { id: string; type: "progress"; stage: string; percent?: number }
  | { id: string; type: "result"; result: SpeechTranscription }
  | { id: string; type: "error"; error: string; code?: "no-speech" };

const scope = self as unknown as { onmessage: ((event: MessageEvent<SpeechWorkerRequest>) => void) | null; postMessage: (message: SpeechWorkerMessage) => void };
const MODEL = "onnx-community/whisper-base_timestamped";
const REVISION = "608c49e61301901684bc36cac8f74b95ff6b5a8e";
// Use one WASM thread: works without cross-origin isolation, WebGPU, or API credentials.
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let currentId = "";

function modelProgress(progress: ProgressInfo) {
  if (progress.status === "progress") {
    const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
    scope.postMessage({ id: currentId, type: "progress", stage: `Descargando modelo de voz · ${percent}% del archivo actual`, percent });
  } else if (progress.status === "initiate" || progress.status === "download") {
    scope.postMessage({ id: currentId, type: "progress", stage: "Preparando el modelo de voz; la primera vez necesita una descarga" });
  }
}

scope.onmessage = async ({ data }) => {
  currentId = data.id;
  try {
    scope.postMessage({ id: data.id, type: "progress", stage: "Cargando el reconocimiento de voz en este dispositivo" });
    transcriber ??= pipeline("automatic-speech-recognition", MODEL, { device: "wasm", dtype: "q8", revision: REVISION, progress_callback: modelProgress });
    const recognize = await transcriber;
    scope.postMessage({ id: data.id, type: "progress", stage: "Escuchando la voz y sincronizando las palabras. Puedes cancelar mientras trabaja" });
    const output = await recognize(data.waveform, { language: "spanish", task: "transcribe", return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, do_sample: false });
    const result = transcriptionFromChunks(output.chunks || [], data.durationSeconds, data.maxWords);
    scope.postMessage({ id: data.id, type: "result", result });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "";
    const noSpeech = /No reconocimos/.test(message);
    if (!noSpeech) transcriber = null;
    console.warn("Segmenta: error del reconocimiento local", message.slice(0, 600));
    const network = /fetch|network|download|load.*model|HTTP|Unauthorized|Forbidden|404|403/i.test(message);
    scope.postMessage({ id: data.id, type: "error", ...(noSpeech ? { code: "no-speech" as const } : {}), error: network
      ? "No pudimos descargar el modelo de voz. Revisa la conexión y vuelve a intentarlo; no necesitas una clave API."
      : /No reconocimos/.test(message) ? message : "El reconocimiento local no pudo terminar en este dispositivo. Cierra otras pestañas pesadas y vuelve a intentarlo." });
  }
};
