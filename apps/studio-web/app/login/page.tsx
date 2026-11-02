"use client";

import { useState } from "react";
import { Film, LoaderCircle, Mail } from "lucide-react";
import { createClient } from "../../lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setLoading(false);
    if (result.error) return setMessage(result.error.message);
    if (mode === "signup" && !result.data.session) return setMessage("Revisa tu correo para confirmar la cuenta.");
    location.href = "/";
  };

  const google = async () => {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setMessage(error.message); setLoading(false); }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#070910] p-5 text-white">
      <section className="w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[.035] p-7 shadow-2xl">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400"><Film /></span>
        <p className="mt-6 text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">Kiko Studio Cloud</p>
        <h1 className="mt-2 text-3xl font-semibold">Tu estudio, desde cualquier lugar</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">Inicia sesión para que cada cuenta conserve sus portafolios, libretos y tomas.</p>
        <button onClick={google} disabled={loading} className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-50">Continuar con Google</button>
        <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[.18em] text-zinc-700"><span className="h-px flex-1 bg-white/8" />o con correo<span className="h-px flex-1 bg-white/8" /></div>
        <label className="block text-xs text-zinc-500">Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40" /></label>
        <label className="mt-4 block text-xs text-zinc-500">Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40" /></label>
        {message ? <p className="mt-4 rounded-xl border border-violet-400/15 bg-violet-400/8 p-3 text-xs text-violet-100">{message}</p> : null}
        <button onClick={submit} disabled={loading || !email || password.length < 6} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3.5 text-sm font-semibold disabled:opacity-40">{loading ? <LoaderCircle className="animate-spin" size={17} /> : <Mail size={17} />}{mode === "login" ? "Entrar" : "Crear cuenta"}</button>
        <button onClick={() => setMode((value) => value === "login" ? "signup" : "login")} className="mt-4 w-full text-xs text-zinc-500 hover:text-white">{mode === "login" ? "¿Primera vez? Crear una cuenta" : "Ya tengo cuenta"}</button>
      </section>
    </main>
  );
}
