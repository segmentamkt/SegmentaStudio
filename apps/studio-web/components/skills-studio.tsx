"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, Settings2, SlidersHorizontal } from "lucide-react";
import {
  defaultSkillProfiles,
  loadSkillProfiles,
  saveSkillProfiles,
  SKILL_CATALOG,
  type SkillCategory,
  type SkillDefinition,
  type SkillId,
  type SkillProfile,
  type SkillSetting,
  type SkillValue,
} from "../lib/studio-skills";

const CATEGORIES: Array<{ id: SkillCategory | "todas"; label: string }> = [
  { id: "todas", label: "Todas" },
  { id: "dirección", label: "Dirección" },
  { id: "imagen", label: "Imagen" },
  { id: "audio", label: "Audio" },
  { id: "texto", label: "Texto" },
  { id: "entrega", label: "Entrega" },
];

const STATUS: Record<SkillDefinition["execution"], { label: string; className: string }> = {
  render: { label: "Se aplica al render", className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" },
  partial: { label: "Aplicación parcial", className: "border-amber-400/20 bg-amber-400/10 text-amber-200" },
  plan: { label: "Plan editorial", className: "border-sky-400/20 bg-sky-400/10 text-sky-200" },
  pending: { label: "Motor pendiente", className: "border-white/10 bg-white/5 text-zinc-400" },
};

function SettingControl({ definition, value, onChange }: {
  definition: SkillSetting;
  value: SkillValue;
  onChange: (value: SkillValue) => void;
}) {
  const id = `skill-setting-${definition.key}`;
  if (definition.kind === "toggle") {
    return (
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
        <span>
          <span className="block text-sm text-zinc-200">{definition.label}</span>
          {definition.plannedOnly && <small className="block text-[11px] text-amber-200/75">Solo se guarda en el plan</small>}
        </span>
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-violet-500" />
      </label>
    );
  }
  if (definition.kind === "select") {
    return (
      <label htmlFor={id} className="block rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
        <span className="block text-sm text-zinc-200">{definition.label}</span>
        {definition.plannedOnly && <small className="block text-[11px] text-amber-200/75">Solo se guarda en el plan</small>}
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100">
          {definition.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label htmlFor={id} className="block rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <span className="flex items-center justify-between gap-3 text-sm text-zinc-200">
        <span>{definition.label}</span>
        <output className="font-semibold tabular-nums text-violet-200">{Number(value).toLocaleString("es-CO", { maximumFractionDigits: 2 })}{definition.suffix || ""}</output>
      </span>
      {definition.plannedOnly && <small className="block text-[11px] text-amber-200/75">Solo se guarda en el plan</small>}
      <input id={id} type="range" min={definition.min} max={definition.max} step={definition.step || 1} value={Number(value)} onChange={(event) => onChange(Number(event.target.value))} className="mt-3 w-full accent-violet-500" />
    </label>
  );
}

export function SkillsStudio({ portfolioId }: { portfolioId: string }) {
  const [profiles, setProfiles] = useState<SkillProfile[]>(defaultSkillProfiles);
  const [loadedPortfolioId, setLoadedPortfolioId] = useState<string | null>(null);
  const [category, setCategory] = useState<SkillCategory | "todas">("todas");
  const [selectedId, setSelectedId] = useState<SkillId>("recortes");
  const [resetNotice, setResetNotice] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setProfiles(loadSkillProfiles(portfolioId));
      setLoadedPortfolioId(portfolioId);
      setResetNotice(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [portfolioId]);

  useEffect(() => {
    if (loadedPortfolioId === portfolioId) saveSkillProfiles(portfolioId, profiles);
  }, [loadedPortfolioId, portfolioId, profiles]);

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const visible = category === "todas" ? SKILL_CATALOG : SKILL_CATALOG.filter((skill) => skill.category === category);
  const selected = SKILL_CATALOG.find((skill) => skill.id === selectedId) || SKILL_CATALOG[0];
  const selectedProfile = profileById.get(selected.id) || defaultSkillProfiles().find((profile) => profile.id === selected.id)!;
  const activeCount = profiles.filter((profile) => profile.enabled).length;
  const renderCount = profiles.filter((profile) => profile.enabled && ["render", "partial"].includes(SKILL_CATALOG.find((skill) => skill.id === profile.id)?.execution || "pending")).length;

  const updateProfile = (id: SkillId, patch: Partial<SkillProfile>) => {
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
    setResetNotice(false);
  };
  const updateSetting = (id: SkillId, key: string, value: SkillValue) => {
    setProfiles((current) => current.map((profile) => profile.id === id ? {
      ...profile,
      settings: { ...profile.settings, [key]: value },
      overrides: profile.overrides.includes(key) ? profile.overrides : [...profile.overrides, key],
    } : profile));
    setResetNotice(false);
  };
  const resetSelected = () => {
    const original = defaultSkillProfiles().find((profile) => profile.id === selectedId);
    if (original) updateProfile(selectedId, original);
    setResetNotice(true);
  };

  return (
    <section className="space-y-5" aria-label="Skills de edición">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">ESPECIALISTAS DE EDICIÓN</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Skills del estudio</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Configura cada especialidad. Sus ajustes ejecutables pasan al contrato que usa el motor de video.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-zinc-300">{activeCount} activas</span>
          <span className="rounded-full border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-emerald-200">{renderCount} con motor disponible</span>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-xs leading-5 text-amber-100/80">
        Los cambios se guardan en este navegador para el portafolio actual. La sincronización entre dispositivos y los agentes Claude/Gemini aún requieren conexión real; ninguna skill los invoca desde esta pantalla.
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar skills por categoría">
        {CATEGORIES.map((item) => (
          <button key={item.id} type="button" onClick={() => {
            setCategory(item.id);
            const first = item.id === "todas" ? SKILL_CATALOG[0] : SKILL_CATALOG.find((skill) => skill.category === item.id);
            if (first) setSelectedId(first.id);
          }} aria-pressed={category === item.id} className={`shrink-0 rounded-full px-4 py-2 text-xs transition ${category === item.id ? "bg-violet-500 text-white" : "border border-white/10 bg-white/5 text-zinc-400 hover:text-white"}`}>{item.label}</button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <div className="grid content-start gap-3 sm:grid-cols-2">
          {visible.map((skill) => {
            const profile = profileById.get(skill.id);
            const active = profile?.enabled ?? skill.defaultEnabled;
            const selectedCard = selectedId === skill.id;
            return (
              <article key={skill.id} className={`min-w-0 rounded-3xl border p-4 transition ${selectedCard ? "border-violet-400/60 bg-violet-400/10" : "border-white/8 bg-white/[.03] hover:border-white/20"}`}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setSelectedId(skill.id)} aria-label={`Configurar ${skill.name}`} className="flex min-w-0 items-center gap-3 text-left">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-xl" aria-hidden="true">{skill.icon}</span>
                    <span className="min-w-0"><strong className="block truncate text-sm font-medium text-white">{skill.name}</strong><small className="mt-0.5 block text-[11px] capitalize text-zinc-500">{skill.category}</small></span>
                  </button>
                  <label className="shrink-0" title={active ? `Desactivar ${skill.name}` : `Activar ${skill.name}`}>
                    <span className="sr-only">{skill.name} activa</span>
                    <input type="checkbox" checked={active} onChange={(event) => updateProfile(skill.id, { enabled: event.target.checked })} className="h-5 w-5 accent-violet-500" />
                  </label>
                </div>
                <p className="mt-3 min-h-10 text-xs leading-5 text-zinc-400">{skill.description}</p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] ${STATUS[skill.execution].className}`}>{STATUS[skill.execution].label}</span>
                  <button type="button" onClick={() => setSelectedId(skill.id)} className="flex items-center gap-1 text-xs text-violet-200 hover:text-white"><Settings2 size={14} />Ajustes</button>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="h-fit rounded-3xl border border-white/10 bg-[#15111d] p-5 xl:sticky xl:top-5" aria-label={`Ajustes de ${selected.name}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-400/10 text-2xl" aria-hidden="true">{selected.icon}</span>
              <div className="min-w-0"><p className="text-[10px] uppercase tracking-[.18em] text-violet-300">Configuración</p><h3 className="truncate text-lg font-semibold text-white">{selected.name}</h3></div>
            </div>
            <button type="button" onClick={resetSelected} title="Restaurar valores de esta skill" aria-label={`Restaurar ${selected.name}`} className="rounded-xl border border-white/10 p-2.5 text-zinc-400 hover:text-white"><RotateCcw size={16} /></button>
          </div>

          <div className={`mt-4 rounded-2xl border px-4 py-3 text-xs leading-5 ${STATUS[selected.execution].className}`}>
            <strong className="block">{STATUS[selected.execution].label}</strong>
            <span className="mt-1 block opacity-85">{selected.capability}</span>
          </div>

          <div className="mt-5 flex items-center gap-2 text-sm font-medium text-zinc-200"><SlidersHorizontal size={16} className="text-violet-300" />Ajustes</div>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">El estilo elegido manda hasta que cambies un control aquí. Restaurar vuelve a usar ese estilo.</p>
          <div className="mt-3 space-y-2">
            {selected.settings.map((setting) => <SettingControl key={`${selected.id}-${setting.key}`} definition={setting} value={selectedProfile.settings[setting.key] ?? setting.defaultValue} onChange={(value) => updateSetting(selected.id, setting.key, value)} />)}
          </div>

          <label htmlFor={`instruction-${selected.id}`} className="mt-5 block text-sm font-medium text-zinc-200">Instrucción editorial</label>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">Se guarda en el plan. El motor solo ejecuta los ajustes compatibles que aparecen arriba.</p>
          <textarea id={`instruction-${selected.id}`} rows={4} maxLength={1200} value={selectedProfile.instruction} onChange={(event) => updateProfile(selected.id, { instruction: event.target.value })} className="mt-2 w-full resize-y rounded-2xl border border-white/10 bg-black/20 p-3 text-sm leading-5 text-zinc-200 outline-none focus:border-violet-400/70" />

          <p role="status" className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500"><Check size={13} className="text-emerald-300" />{resetNotice ? "Valores originales restaurados" : "Guardado automáticamente en este navegador"}</p>
        </aside>
      </div>
    </section>
  );
}
