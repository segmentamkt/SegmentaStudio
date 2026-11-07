export type AutomaticEditStage = "captions" | "resources" | "plan" | "render" | "done";

export type AutomaticEditSteps<TDraft, TJob, TResult> = {
  signal: AbortSignal;
  captureDraft: () => TDraft;
  transcribe: () => Promise<boolean>;
  /** Adds contextual resources to the current draft after timed captions exist. */
  addResources?: () => void | Promise<void>;
  prepare: (draft: TDraft) => Promise<TJob | null>;
  render: (job: TJob) => Promise<TResult | null>;
  onStage: (stage: AutomaticEditStage) => void;
};

/**
 * Runs the confirmed montage through one sequence, using each completed step's
 * actual output. The caller owns cancellation of its current network/worker
 * operation; this guard also prevents late completions from starting more work.
 */
export async function runAutomaticEdit<TDraft, TJob, TResult>(steps: AutomaticEditSteps<TDraft, TJob, TResult>): Promise<TResult> {
  const checkActive = () => {
    if (steps.signal.aborted) throw new DOMException("La edición automática se detuvo.", "AbortError");
  };
  const enter = (stage: AutomaticEditStage) => {
    checkActive();
    steps.onStage(stage);
    checkActive();
  };

  enter("captions");
  const captionsReady = await steps.transcribe();
  checkActive();
  if (!captionsReady) throw new Error("Faltan subtítulos por generar. Revisa las tomas con aviso y vuelve a intentarlo.");

  if (steps.addResources) {
    enter("resources");
    await steps.addResources();
    checkActive();
  }

  // Captions and resources update the draft asynchronously. Capture only after
  // both finish, rather than passing state from the original click handler.
  const draft = steps.captureDraft();
  enter("plan");
  const job = await steps.prepare(draft);
  checkActive();
  if (job === null) throw new Error("No se pudo preparar la edición. El video no se ha renderizado.");

  enter("render");
  const result = await steps.render(job);
  checkActive();
  if (result === null) throw new Error("No se pudo confirmar el resultado de la edición.");

  enter("done");
  return result;
}
