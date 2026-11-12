"use client";

import { Bot, Camera, Film, FolderKanban, FolderOpen, Home, Lightbulb, Library, ListChecks, Palette, Plus, Scissors, Sparkles, UploadCloud, UserRound, WandSparkles, type LucideIcon } from "lucide-react";

/** Inicio de Studio: acciones principales, tomas recientes y herramientas. Todas las acciones vienen por props. */
export type HomeTake = { id: string; sessionId: string; sessionTitle: string; durationMs?: number | null };
export type HomeView = { id: string; label: string };

type Props = {
  portfolioName: string;
  niche: string;
  activeView: string;
  takes: HomeTake[];
  views: HomeView[];
  locked: boolean;
  recordDisabled: boolean;
  uploadDisabled: boolean;
  scriptsDisabled: boolean;
  onRecord: () => void;
  onUpload: () => void;
  onImportScripts: () => void;
  onNewProject: () => void;
  onOpenTake: (take: HomeTake) => void;
  onOpenView: (id: string) => void;
  onOpenAccount: () => void;
};

const VIEW_ICONS: Record<string, LucideIcon> = {
  edit: Scissors,
  library: Library,
  projects: FolderKanban,
  skills: WandSparkles,
  semantic: Sparkles,
  trends: Lightbulb,
  style: Palette,
  team: Bot,
  tasks: ListChecks,
};

function formatDuration(ms?: number | null) {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function StudioHome(props: Props) {
  const { portfolioName, niche, activeView, takes, views, locked, recordDisabled, uploadDisabled, scriptsDisabled } = props;
  const quickActions: Array<{ id: string; label: string; hint: string; icon: LucideIcon; disabled: boolean; onClick: () => void; primary?: boolean }> = [
    { id: "record", label: "Grabar", hint: "Cámara directa", icon: Camera, disabled: recordDisabled, onClick: props.onRecord, primary: true },
    { id: "upload", label: "Subir videos", hint: "MP4, MOV o WebM", icon: UploadCloud, disabled: uploadDisabled, onClick: props.onUpload, primary: true },
    { id: "scripts", label: "Importar libretos", hint: "Carpetas y escenas", icon: FolderOpen, disabled: scriptsDisabled, onClick: props.onImportScripts },
    { id: "new", label: "Nuevo proyecto", hint: "Crear una producción", icon: Plus, disabled: locked, onClick: props.onNewProject },
  ];
  const tools: Array<{ id: string; label: string; icon: LucideIcon; onClick: () => void }> = views.map((view) => ({ id: view.id, label: view.label, icon: VIEW_ICONS[view.id] || Film, onClick: () => props.onOpenView(view.id) }));

  return (
    <div className="space-y-6 pb-4">
      <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-violet-600/30 via-indigo-600/12 to-(--c-0c0f18) p-5 sm:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-200/80">{niche || "Tu portafolio"}</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-4xl">{portfolioName}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-300/80">Graba, sube y edita sin salir de aquí. Tus tomas, tus libretos y tus videos listos para exportar.</p>
      </section>

      <section aria-label="Acciones rápidas" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`group flex min-h-[124px] flex-col justify-between rounded-2xl border p-4 text-left transition disabled:opacity-40 sm:min-h-[150px] ${action.primary ? "border-violet-400/30 bg-gradient-to-br from-violet-500/25 to-violet-500/5 hover:border-violet-300/50" : "border-white/8 bg-white/[.03] hover:border-white/20"}`}
            >
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${action.primary ? "bg-white text-black" : "bg-white/8 text-zinc-200"}`}><Icon size={20} /></span>
              <span>
                <strong className="block text-sm font-semibold sm:text-base">{action.label}</strong>
                <span className="mt-0.5 block text-[11px] text-zinc-400">{action.hint}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section aria-labelledby="home-takes-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-zinc-500">Tomas recientes</p>
            <h2 id="home-takes-title" className="mt-1 text-base font-semibold sm:text-lg">Sigue donde lo dejaste</h2>
          </div>
          <button type="button" onClick={() => props.onOpenView("library")} className="shrink-0 text-xs text-violet-300 hover:text-violet-200">Ver todas</button>
        </div>
        {takes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.02] p-6 text-center text-sm text-zinc-500">Aún no hay tomas. Graba o sube videos para empezar.</div>
        ) : (
          <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0 xl:grid-cols-6">
            {takes.map((take) => (
              <button
                key={take.id}
                type="button"
                onClick={() => props.onOpenTake(take)}
                disabled={locked}
                aria-label={`Editar toma de ${take.sessionTitle}, ${formatDuration(take.durationMs)}`}
                data-theme="dark"
                className="relative aspect-[9/14] w-[38%] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-b from-zinc-800 to-zinc-950 text-left disabled:opacity-50 sm:w-auto"
              >
                <video src={`/api/media/${take.id}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-8">
                  <span className="block truncate text-[11px] font-medium text-white">{take.sessionTitle}</span>
                  <span className="text-[10px] tabular-nums text-zinc-300">{formatDuration(take.durationMs)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="home-tools-title">
        <p id="home-tools-title" className="mb-3 text-[10px] font-bold uppercase tracking-[.18em] text-zinc-500">Herramientas</p>
        <div className="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-6 lg:grid-cols-8">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const active = tool.id === activeView;
            return (
              <button key={tool.id} type="button" onClick={tool.onClick} className="flex flex-col items-center gap-2 text-center">
                <span className={`grid h-14 w-14 place-items-center rounded-2xl border transition ${active ? "border-violet-400/50 bg-violet-500/20 text-violet-100" : "border-white/8 bg-white/[.04] text-zinc-200 hover:border-white/20"}`}><Icon size={22} /></span>
                <span className="text-[11px] leading-tight text-zinc-300">{tool.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-white/8 bg-(--c-0b0d13)/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
        {[
          { id: "summary", label: "Inicio", icon: Home, disabled: false, onClick: () => props.onOpenView("summary") },
          { id: "record", label: "Grabar", icon: Camera, disabled: recordDisabled, onClick: props.onRecord },
          { id: "library", label: "Tomas", icon: Library, disabled: false, onClick: () => props.onOpenView("library") },
          { id: "edit", label: "Editor", icon: Scissors, disabled: false, onClick: () => props.onOpenView("edit") },
          { id: "account", label: "Yo", icon: UserRound, disabled: false, onClick: props.onOpenAccount },
        ].map((item) => {
          const Icon = item.icon;
          const active = item.id === activeView;
          return (
            <button key={item.id} type="button" onClick={item.onClick} disabled={item.disabled} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-1 py-1 text-[10px] disabled:opacity-40 ${active ? "text-white" : "text-zinc-500"}`}>
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
