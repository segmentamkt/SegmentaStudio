"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LogOut, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { confirmedEmail, validAccountPassword } from "../lib/account-auth";
import { createClient, ensureBrowserSession } from "../lib/supabase/browser";

type Mode = "create" | "login" | "profile" | "verify" | "set-password" | "forgot" | "reset";

export function AccountAccess(props: { projectCount: number; reset?: boolean; setup?: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<Mode>(props.reset ? "reset" : props.setup ? "set-password" : "create");
  const [registrationKind, setRegistrationKind] = useState<"link" | "signup">("link");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then((result: { data: { user: User | null } }) => {
      if (!active) return;
      const next = result.data.user;
      setUser(next);
      setName(String(next?.user_metadata?.full_name || ""));
      setEmail(String(next?.email || ""));
      if (!props.reset) setMode(next?.is_anonymous || !next?.email ? "create" : props.setup ? "set-password" : "profile");
    });
    return () => { active = false; };
  }, [props.reset, props.setup]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar el acceso."); }
    finally { setBusy(false); }
  };
  const refreshUser = async () => {
    const { data, error: authError } = await createClient().auth.getUser();
    if (authError) throw authError;
    setUser(data.user);
    return data.user;
  };
  const finishPassword = async () => {
    if (!validAccountPassword(password)) throw new Error("La contraseña debe tener entre 8 y 72 caracteres.");
    if (password !== repeat) throw new Error("Las contraseñas no coinciden.");
    const current = await refreshUser();
    if (!current || current.is_anonymous || !current.email_confirmed_at) throw new Error("Primero verifica el correo de esta cuenta.");
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) throw updateError;
    setPassword(""); setRepeat("");
    await createClient().auth.refreshSession();
    await refreshUser();
    await props.onChanged();
    setMode("profile"); setNotice("Cuenta protegida. Ya puedes entrar desde otro dispositivo con tu correo y contraseña.");
  };
  const createAccount = () => run(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error("Escribe un correo válido. Será tu usuario para entrar.");
    if (!name.trim()) throw new Error("Escribe el nombre que verán en tu cuenta.");
    if (!validAccountPassword(password) || password !== repeat) throw new Error("Usa una contraseña de 8 a 72 caracteres y repítela igual.");
    const supabase = createClient();
    const before = await refreshUser();
    if (!before) throw new Error("No encontramos tu sesión actual. Recarga el estudio.");
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(props.projectCount > 0 ? "/?access=setup" : "/?access=1")}`;
    if (props.projectCount > 0) {
      setRegistrationKind("link");
      // A new signUp would allocate a new user ID and orphan the current projects.
      const { data, error: linkError } = await supabase.auth.updateUser({ email: normalizedEmail, data: { full_name: name.trim().slice(0, 80) } }, { emailRedirectTo: redirect });
      if (linkError) throw new Error(`${linkError.message}. Conservamos tus proyectos; no creamos una cuenta separada.`);
      if (data.user?.id !== before.id) throw new Error("La cuenta cambió durante la vinculación. No establecimos contraseña.");
      const after = await refreshUser();
      if (confirmedEmail(after, normalizedEmail)) { await finishPassword(); return; }
      setMode("verify"); setNotice("Confirma el correo con el enlace recibido o escribe aquí el código de 6 dígitos. Luego terminaremos de guardar la contraseña.");
    } else {
      setRegistrationKind("signup");
      const { data, error: signupError } = await supabase.auth.signUp({ email: normalizedEmail, password, options: { data: { full_name: name.trim().slice(0, 80) }, emailRedirectTo: redirect } });
      if (signupError) throw signupError;
      if (data.session) {
        setPassword(""); setRepeat("");
        await refreshUser(); await props.onChanged();
        setMode("profile"); setNotice("Cuenta creada. Ya puedes entrar desde otros dispositivos.");
      } else { setMode("verify"); setNotice("Revisa tu correo para confirmar la cuenta. Después vuelve a entrar con tu usuario y contraseña."); }
    }
  });
  const verifyEmail = () => run(async () => {
    if (!/^\d{6,8}$/.test(otp.trim())) throw new Error("Escribe el código recibido por correo.");
    const supabase = createClient();
    const before = user;
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp.trim(), type: registrationKind === "link" ? "email_change" : "signup" });
    if (verifyError) throw verifyError;
    if (registrationKind === "link" && before?.id && data.user?.id !== before.id) throw new Error("La verificación abrió otra cuenta. No cambiamos la contraseña del proyecto anónimo.");
    const after = await refreshUser();
    if (!after) throw new Error("No pudimos confirmar la sesión después del código.");
    if (registrationKind === "link") { setMode("set-password"); setNotice("Correo verificado. Confirma la contraseña para terminar."); }
    else { await props.onChanged(); setMode("profile"); setNotice("Correo confirmado. Tu cuenta está lista."); }
  });
  const login = () => run(async () => {
    if (props.projectCount > 0 && user?.is_anonymous && !confirmSwitch) throw new Error("Marca la casilla para reconocer que las producciones de esta visita no pasarán a la otra cuenta.");
    const { error: loginError } = await createClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (loginError) throw loginError;
    setPassword(""); setRepeat("");
    await refreshUser(); await props.onChanged();
    setMode("profile"); setNotice("Entraste a tu cuenta. Tus proyectos de esa cuenta están disponibles.");
  });
  const sendReset = () => run(async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error("Escribe el correo de tu cuenta.");
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/?access=reset")}`;
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: redirect });
    if (resetError) throw resetError;
    setNotice("Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.");
  });
  const changeName = () => run(async () => {
    if (!name.trim()) throw new Error("Escribe el nombre de la cuenta.");
    const { error: updateError } = await createClient().auth.updateUser({ data: { full_name: name.trim().slice(0, 80) } });
    if (updateError) throw updateError;
    await refreshUser(); await props.onChanged(); setNotice("Nombre actualizado.");
  });
  const changePassword = () => run(async () => {
    if (!validAccountPassword(password) || password !== repeat) throw new Error("Usa una contraseña de 8 a 72 caracteres y repítela igual.");
    if (!currentPassword) throw new Error("Escribe la contraseña actual para cambiarla.");
    const { error: updateError } = await createClient().auth.updateUser({ password, current_password: currentPassword });
    if (updateError) throw updateError;
    setPassword(""); setRepeat(""); setCurrentPassword(""); setNotice("Contraseña actualizada.");
  });
  const signOut = () => run(async () => {
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) throw signOutError;
    await ensureBrowserSession(); await refreshUser(); await props.onChanged();
    setMode("create"); setNotice("Saliste de la cuenta. Puedes seguir explorando el estudio como visitante.");
  });
  const input = "mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white outline-none focus:border-violet-400/50";
  const label = "block text-xs font-medium text-zinc-300";
  const submit = "w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40";
  const isAnonymous = Boolean(user?.is_anonymous || !user?.email);
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Cuenta y acceso" className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#111521] p-5 text-white shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-3"><div><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-400/15 text-violet-200"><UserRound size={20} /></span><h2 className="mt-3 text-xl font-semibold">Cuenta y acceso</h2><p className="mt-1 text-xs leading-5 text-zinc-400">Usuario: tu correo electrónico. El nombre es cómo aparecerás en el estudio.</p></div><button type="button" aria-label="Cerrar cuenta" onClick={props.onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5"><X size={16} /></button></div>
      {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs leading-5 text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs leading-5 text-red-200">{error}</p>}
      {isAnonymous && mode !== "verify" && mode !== "set-password" && mode !== "reset" && mode !== "forgot" && <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-black/30 p-1"><button type="button" onClick={() => { setMode("create"); setError(""); setNotice(""); }} className={`rounded-lg px-3 py-2 text-xs ${mode === "create" ? "bg-white text-black" : "text-zinc-400"}`}>Guardar mi acceso</button><button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }} className={`rounded-lg px-3 py-2 text-xs ${mode === "login" ? "bg-white text-black" : "text-zinc-400"}`}>Ya tengo cuenta</button></div>}
      {mode === "create" && <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void createAccount(); }}><p className="rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-3 text-xs leading-5 text-zinc-300">{props.projectCount > 0 ? `Vincularemos esta sesión a tu correo para conservar ${props.projectCount} proyecto${props.projectCount === 1 ? "" : "s"}.` : "Crea un acceso para abrir tus futuros proyectos desde computador o celular."}</p><label className={label}>Nombre<input className={input} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><label className={label}>Usuario (correo electrónico)<input className={input} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className={label}>Contraseña<div className="relative"><input className={`${input} pr-12`} type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required /><button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-4 text-zinc-400">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><label className={label}>Repetir contraseña<input className={input} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} minLength={8} maxLength={72} required /></label><button className={submit} disabled={busy} type="submit">{busy ? "Guardando acceso…" : "Crear usuario y contraseña"}</button><p className="text-[11px] leading-5 text-zinc-500">La contraseña se envía directamente a Supabase Auth. Segmenta Studio no la guarda en los proyectos.</p></form>}
      {mode === "verify" && <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void verifyEmail(); }}><p className="text-xs leading-5 text-zinc-400">Enviamos la verificación a <strong className="text-white">{email}</strong>. Puedes abrir el enlace del correo o introducir el código aquí.</p><label className={label}>Código de correo<input className={input} inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} maxLength={8} placeholder="6 dígitos" /></label><button className={submit} type="submit" disabled={busy}>Verificar correo</button><button type="button" onClick={() => void run(async () => { const next = await refreshUser(); if (confirmedEmail(next, email)) { setMode(registrationKind === "link" ? "set-password" : "profile"); setNotice(registrationKind === "link" ? "Correo verificado. Termina de guardar la contraseña." : "Cuenta confirmada. Ya puedes entrar."); } else setNotice("El correo aún no aparece verificado. Abre el enlace o introduce el código."); })} className="w-full text-xs text-violet-200">Ya abrí el enlace de verificación</button></form>}
      {(mode === "set-password" || mode === "reset") && <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void run(finishPassword); }}><p className="text-xs text-zinc-400">{mode === "reset" ? "Elige una contraseña nueva para recuperar tu cuenta." : "Tu correo está verificado. Define la contraseña final de esta cuenta."}</p><label className={label}>Nueva contraseña<input className={input} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required /></label><label className={label}>Repetir contraseña<input className={input} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} minLength={8} maxLength={72} required /></label><button className={submit} disabled={busy} type="submit">Guardar contraseña</button></form>}
      {mode === "login" && <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void login(); }}><label className={label}>Usuario (correo electrónico)<input className={input} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className={label}>Contraseña<input className={input} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{isAnonymous && props.projectCount > 0 && <label className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100"><input type="checkbox" checked={confirmSwitch} onChange={(event) => setConfirmSwitch(event.target.checked)} className="mt-1 accent-amber-400" />Entiendo que los {props.projectCount} proyectos de esta visita no se trasladarán a la otra cuenta. Para conservarlos, usaré “Guardar mi acceso”.</label>}<button className={submit} disabled={busy || (isAnonymous && props.projectCount > 0 && !confirmSwitch)} type="submit">{busy ? "Entrando…" : "Entrar"}</button><button type="button" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }} className="w-full text-xs text-violet-200">Olvidé mi contraseña</button></form>}
      {mode === "forgot" && <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void sendReset(); }}><p className="text-xs leading-5 text-zinc-400">Recibirás un enlace para establecer una contraseña nueva.</p><label className={label}>Correo de tu cuenta<input className={input} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button type="submit" disabled={busy} className={submit}><Mail size={14} className="mr-1 inline" />Enviar enlace de recuperación</button><button type="button" onClick={() => setMode("login")} className="w-full text-xs text-violet-200">Volver a entrar</button></form>}
      {mode === "profile" && user && !user.is_anonymous && <div className="mt-5 space-y-4"><div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="flex items-center gap-2 text-sm font-medium text-emerald-200"><ShieldCheck size={16} />Acceso con cuenta</p><p className="mt-2 break-all text-xs text-zinc-300">{user.email}</p></div><form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void changeName(); }}><label className={label}>Nombre visible<input className={input} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label><button type="submit" disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Guardar nombre</button></form><details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm"><KeyRound size={15} className="mr-2 inline" />Cambiar contraseña</summary><form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void changePassword(); }}><label className={label}>Contraseña actual<input className={input} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label className={label}>Nueva contraseña<input className={input} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required /></label><label className={label}>Repetir nueva contraseña<input className={input} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} minLength={8} maxLength={72} required /></label><button type="submit" disabled={busy} className={submit}>Actualizar contraseña</button></form></details><button type="button" onClick={() => void signOut()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-zinc-300"><LogOut size={16} />Salir de esta cuenta</button></div>}
      <p className="mt-5 flex items-center gap-2 text-[11px] text-zinc-500"><CheckCircle2 size={13} />La entrada libre sigue disponible.</p>
    </section>
  </div>;
}
