"use client";

import { EditorStudio } from "../../components/editor-studio";

/** Tres tomas aprobadas de prueba. Los videos no existen: la vista previa muestra su estado de error, lo demás funciona. */
const TAKES = [
  { id: "t1", sessionId: "s1", sceneId: "sc1", status: "approved", durationMs: 6400, bytes: 1000, objectKey: "demo/t1", mimeType: "video/mp4", createdAt: "2026-11-10T10:00:00Z" },
  { id: "t2", sessionId: "s1", sceneId: "sc2", status: "approved", durationMs: 9800, bytes: 1000, objectKey: "demo/t2", mimeType: "video/mp4", createdAt: "2026-11-10T10:01:00Z" },
  { id: "t3", sessionId: "s1", sceneId: "sc3", status: "approved", durationMs: 7200, bytes: 1000, objectKey: "demo/t3", mimeType: "video/mp4", createdAt: "2026-11-10T10:02:00Z" },
];
const SCENES = [
  { id: "sc1", sessionId: "s1", position: 0, selectedTakeId: "t1", title: "Intro", script: "Hoy te muestro cómo se prepara" },
  { id: "sc2", sessionId: "s1", position: 1, selectedTakeId: "t2", title: "Lechona", script: "la lechona tolimense con arroz y arveja" },
  { id: "sc3", sessionId: "s1", position: 2, selectedTakeId: "t3", title: "Cierre", script: "pruébala en casa" },
];
const SESSIONS = [{ id: "s1", portfolioId: "p1", title: "Lechona tolimense", script: "", status: "ready", createdAt: "2026-11-10T10:00:00Z" }];
const REVIEW = { id: "r1", sessionId: "s1", orderedTakeIds: ["t1", "t2", "t3"], createdAt: "2026-11-10T10:05:00Z" };

// La revisión de tomas vive en /api/media-review. En el banco se responde con datos de prueba.
let patched = false;
function mockReviewApi() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/media-review")) {
      return Promise.resolve(new Response(JSON.stringify({ review: REVIEW, valid: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return original(input, init);
  };
}

export function EditorDemo() {
  mockReviewApi();
  return (
    <main className="min-h-screen bg-[#070910] p-0 text-white sm:p-6">
      <EditorStudio
        portfolioId="p1"
        sessions={SESSIONS}
        scenes={SCENES}
        takes={TAKES}
        editJobs={[]}
        preproductionPlans={[]}
        onRefresh={async () => {}}
        onBack={() => {}}
        onUpload={() => {}}
        onAddToCurrent={() => {}}
      />
    </main>
  );
}
