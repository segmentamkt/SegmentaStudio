"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Film, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "../../lib/supabase/browser";
import { accountAuthErrorMessage, validAccountPassword } from "../../lib/account-auth";

type Mode = "login" | "forgot" | "reset";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("reset") === "1") {
      const frame = requestAnimationFrame(() => setMode("reset"));
      return () => cancelAnimationFrame(frame);
    }
    if (query.get("error") === "oauth") {
      const frame = requestAnimationFrame(() => setError("El enlace de acceso venció o no se pudo abrir. Solicita uno nuevo."));
      return () => cancelAnimationFrame(frame);
    }
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const auth = createClient().auth;
      if (mode === "login") {
        const { error: authError } = await auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (authError) throw new Error(accountAuthErrorMessage(authError));
        const access = await fetch("/api/auth/check", { cache: "no-store" });
        if (!access.ok) {
          if (access.status === 401 || access.status === 403) {
            await auth.signOut({ scope: "local" });
            throw new Error("Esta cuenta no tiene acceso al estudio. Usa el correo de la cuenta anfitriona.");
          }
          throw new Error("La cuenta se verificó, pero el estudio no respondió. Intenta entrar de nuevo.");
        }
        setPassword("");
        window.location.replace("/");
      } else if (mode === "forgot") {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login?reset=1")}`;
        const { error: resetError } = await auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
        if (resetError) throw new Error(accountAuthErrorMessage(resetError));
        setNotice("Si el correo pertenece a la cuenta anfitriona, recibirás un enlace para guardar tu contraseña. Ábrelo en este mismo navegador; revisa también Spam. Tus proyectos se conservan.");
      } else {
        if (!validAccountPassword(password) || password !== repeat) throw new Error("Usa una contraseña de 8 a 72 caracteres y repítela igual.");
        const reset = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
        if (!reset.ok) {
          const result = await reset.json().catch(() => ({})) as { error?: string };
          throw new Error(result.error || "No pudimos guardar la nueva contraseña. Solicita otro enlace.");
        }
        await auth.refreshSession();
        setPassword(""); setRepeat("");
        window.location.replace("/");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar el acceso.");
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (next: Mode) => { setMode(next); setError(""); setNotice(""); setPassword(""); setRepeat(""); };
  const input = "mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white outline-none transition focus:border-violet-400/60";

  return <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#070910] px-4 py-8 text-white">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_12%,rgba(139,92,246,.22),transparent_42%)]" />
    <section className="relative w-full max-w-md rounded-[2rem] border border-white/10 bg-[#111521]/95 p-6 shadow-2xl sm:p-9">
      <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400"><Film size={23} /></span><div><p className="text-lg font-semibold">Segmenta Studio</p><p className="text-[10px] uppercase tracking-[.22em] text-zinc-400">Editor cloud</p></div></div>
      <div className="mt-9"><span className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">Acceso anfitrión</span><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{mode === "forgot" ? "Recuperar acceso" : mode === "reset" ? "Nueva contraseña" : "Entra a tu estudio"}</h1><p className="mt-2 text-sm leading-6 text-zinc-400">{mode === "login" ? "Tus proyectos, videos y ediciones están protegidos con tu cuenta." : mode === "forgot" ? "Te enviaremos un enlace al correo de tu cuenta." : "Define una contraseña nueva para volver a entrar."}</p></div>
      {error && <p role="alert" className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="mt-6 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
      <form onSubmit={submit} className="mt-7 space-y-5">
        {mode !== "reset" && <label className="block text-sm font-medium text-zinc-300">Usuario (correo electrónico)<div className="relative"><Mail size={17} className="absolute left-4 top-[22px] text-zinc-500" /><input className={`${input} pl-11`} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></div></label>}
        {mode !== "forgot" && <label className="block text-sm font-medium text-zinc-300">{mode === "reset" ? "Nueva contraseña" : "Contraseña"}<div className="relative"><LockKeyhole size={17} className="absolute left-4 top-[22px] text-zinc-500" /><input className={`${input} pl-11 pr-12`} type={showPassword ? "text" : "password"} autoComplete={mode === "reset" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === "reset" ? 8 : undefined} maxLength={72} required /><button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-[21px] text-zinc-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}
        {mode === "reset" && <label className="block text-sm font-medium text-zinc-300">Repetir contraseña<input className={input} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} minLength={8} maxLength={72} required /></label>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50">{busy && <LoaderCircle size={17} className="animate-spin" />}{mode === "login" ? "Entrar al estudio" : mode === "forgot" ? "Enviar enlace" : "Guardar contraseña"}</button>
      </form>
      {mode === "login" ? <button type="button" onClick={() => changeMode("forgot")} className="mt-6 w-full text-sm text-violet-200 hover:text-white">Olvidé mi contraseña</button> : <button type="button" onClick={() => changeMode("login")} className="mt-6 w-full text-sm text-violet-200 hover:text-white">Volver a iniciar sesión</button>}
    </section>
  </main>;
}
