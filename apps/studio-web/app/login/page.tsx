"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { createClient } from "../../lib/supabase/browser";

export default function LoginPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const enter = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error: anonymousError } = await supabase.auth.signInAnonymously();
        if (anonymousError) {
          setError(anonymousError.message);
          return;
        }
      }
      location.replace("/");
    };
    enter();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07070b] px-5 text-white">
      <section className="w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
        <div className="text-xs font-bold tracking-[0.28em] text-violet-300">SEGMENTA STUDIO CLOUD</div>
        <LoaderCircle className="mx-auto mt-8 animate-spin text-violet-400" size={34} />
        <h1 className="mt-5 text-2xl font-semibold">Abriendo tu estudio</h1>
        <p className="mt-2 text-sm text-zinc-400">Entrada libre, sin correo ni contraseña.</p>
        {error ? <p className="mt-5 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p> : null}
      </section>
    </main>
  );
}
