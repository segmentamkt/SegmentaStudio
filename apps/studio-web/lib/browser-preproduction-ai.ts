/** Optional browser inference. The model is downloaded to the device; no provider key is used. */
let generatorPromise: ReturnType<typeof loadGenerator> | null = null;

async function loadGenerator() {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { device: "webgpu", dtype: "q4" });
}

export async function suggestPreproductionEdit(input: { script: string; description: string; question: string; scenes: string[] }): Promise<string> {
  if (!("gpu" in navigator)) throw new Error("Este navegador no ofrece WebGPU para la IA local. Puedes ajustar el plan manualmente.");
  generatorPromise ||= loadGenerator().catch((error) => { generatorPromise = null; throw error; });
  const generator = await generatorPromise;
  const messages = [
    { role: "system", content: "Eres director de edición de videos verticales en español. Responde a la pregunta del creador con 2 o 3 acciones concretas y máximo 80 palabras. Usa solo elementos presentes en el libreto. Si sugieres un recurso que aún no existe, di 'grabar o subir'. No inventes personas, lugares, tomas, mapas ni imágenes disponibles. Indica el momento de la escena, el apoyo visual y un rótulo alternativo si falta material. No afirmes que ya se editó." },
    { role: "user", content: `Libreto: ${input.script.slice(0, 3000)}\nEscenas: ${input.scenes.join(" | ").slice(0, 1000)}\nDirección actual: ${input.description.slice(0, 1000)}\nPetición del creador: ${input.question.slice(0, 500)}` },
  ];
  const result = await generator(messages, { max_new_tokens: 170, do_sample: false });
  const generated = result[0]?.generated_text;
  const answer = Array.isArray(generated) ? String(generated.at(-1)?.content || "") : String(generated || "").replace(/^.*?Petición del creador:[\s\S]*?\n/, "");
  if (!answer.trim()) throw new Error("La IA local no devolvió una propuesta. Puedes continuar editando el plan.");
  return answer.trim().slice(0, 1500);
}
