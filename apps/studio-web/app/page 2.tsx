import { Check, Cloud, Film, Gauge, MonitorUp, Scissors, ShieldCheck, Sparkles, Waves } from "lucide-react";

const tools = [
  { icon: Scissors, title: "Contrato de edición", copy: "Convierte tu instrucción en cortes, orden, subtítulos, ritmo y efectos verificables." },
  { icon: Waves, title: "Auditoría de timeline", copy: "Detecta tiempos muertos, solapamientos y elementos editoriales ausentes antes del render." },
  { icon: ShieldCheck, title: "Control de entrega", copy: "No permite marcar un video como terminado hasta comprobar archivo, imagen, audio y estilo." },
  { icon: Gauge, title: "Diagnóstico preciso", copy: "Localiza la etapa que falló y ordena una reparación sin repetir todo el proyecto." },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#080b12] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(circle_at_50%_-10%,rgba(109,94,252,.34),transparent_55%)]" />
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-7">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_0_30px_rgba(109,94,252,.35)]"><Film size={20} /></span>
          <div><p className="text-sm font-semibold tracking-wide">KIKO</p><p className="text-[10px] uppercase tracking-[.24em] text-zinc-500">Video Director</p></div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_#6ee7b7]" /> Nube privada</div>
      </nav>

      <section className="relative mx-auto max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200"><Sparkles size={13} /> Dirección editorial para Kiko Studio</div>
          <h1 className="text-balance text-5xl font-semibold leading-[1.04] tracking-[-.045em] sm:text-7xl">La edición no se declara lista. <span className="bg-gradient-to-r from-violet-300 via-white to-cyan-300 bg-clip-text text-transparent">Se demuestra.</span></h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-400">Esta skill traduce tu idea en un plan estricto, vigila la línea de tiempo y rechaza cualquier render que no incluya los subtítulos, cortes, sonido y efectos que pediste.</p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {tools.map(({ icon: Icon, title, copy }) => (
            <article key={title} className="group rounded-3xl border border-white/8 bg-white/[.035] p-6 backdrop-blur transition hover:border-violet-400/25 hover:bg-white/[.055]">
              <div className="mb-5 flex items-start justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-violet-300"><Icon size={20} /></span><Check size={16} className="text-emerald-300" /></div>
              <h2 className="font-medium tracking-tight">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{copy}</p>
            </article>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
          <article className="rounded-3xl border border-white/8 bg-gradient-to-br from-violet-500/10 to-cyan-400/5 p-7">
            <div className="flex items-center gap-3"><MonitorUp size={19} className="text-cyan-300" /><h2 className="font-medium">Cómo queda conectado</h2></div>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {["Tú describes la edición", "La nube crea y valida el contrato", "Tu Mac procesa y verifica el video"].map((label, i) => <div key={label} className="rounded-2xl border border-white/8 bg-black/15 p-4"><p className="text-xs font-medium text-violet-300">0{i + 1}</p><p className="mt-2 text-sm leading-5 text-zinc-300">{label}</p></div>)}
            </div>
          </article>
          <article className="rounded-3xl border border-white/8 bg-white/[.035] p-7">
            <Cloud size={20} className="text-violet-300" /><h2 className="mt-5 font-medium">Tus videos permanecen locales</h2><p className="mt-2 text-sm leading-6 text-zinc-500">La nube recibe el libreto, los metadatos y las reglas de edición. El metraje original y el render se procesan en Kiko Studio.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
