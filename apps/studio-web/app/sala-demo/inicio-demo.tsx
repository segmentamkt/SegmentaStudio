"use client";

import { useState } from "react";
import { StudioHome, type HomeTake } from "../../components/studio-home";

/** Banco local del inicio: datos de prueba (las miniaturas quedan vacías sin sesión). */
const TAKES: HomeTake[] = Array.from({ length: 8 }, (_, index) => ({
  id: `demo-take-${index + 1}`,
  sessionId: `demo-session-${(index % 3) + 1}`,
  sessionTitle: ["Lechona tolimense", "Parábola de los talentos", "Ideas para la semana"][index % 3],
  durationMs: 9_000 + index * 3_700,
}));

const VIEWS = [
  { id: "edit", label: "Editor" },
  { id: "library", label: "Tomas" },
  { id: "projects", label: "Proyectos" },
  { id: "skills", label: "Skills" },
  { id: "semantic", label: "Editor semántico" },
  { id: "trends", label: "Ideas y tendencias" },
  { id: "style", label: "Estilo Kiko" },
  { id: "team", label: "Equipo IA" },
  { id: "tasks", label: "Tareas" },
];

export function InicioDemo() {
  const [last, setLast] = useState("ninguna");
  const note = (label: string) => () => setLast(label);
  return (
    <main className="min-h-screen bg-(--c-070910) p-4 pb-28 text-white sm:p-8">
      <div className="mx-auto max-w-[1200px]">
        <StudioHome
          portfolioName="Mi portafolio"
          niche="Contenido educativo"
          activeView="summary"
          takes={TAKES}
          views={VIEWS}
          locked={false}
          recordDisabled={false}
          uploadDisabled={false}
          scriptsDisabled={false}
          onRecord={note("Grabar")}
          onUpload={note("Subir videos")}
          onImportScripts={note("Importar libretos")}
          onNewProject={note("Nuevo proyecto")}
          onOpenTake={(take) => setLast(`Toma ${take.id}`)}
          onOpenView={(id) => setLast(`Vista ${id}`)}
          onOpenAccount={note("Cuenta")}
        />
        <p className="mt-6 text-[10px] text-zinc-500">Última acción del banco: {last}</p>
      </div>
    </main>
  );
}
