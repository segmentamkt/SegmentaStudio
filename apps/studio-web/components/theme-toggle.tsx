"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { THEME_COLORS, THEME_STORAGE_KEY, type StudioTheme } from "../lib/theme";

const listeners = new Set<() => void>();

function currentTheme(): StudioTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setStudioTheme(theme: StudioTheme) {
  const root = document.documentElement;
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* El tema vale para esta visita. */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useStudioTheme(): StudioTheme {
  return useSyncExternalStore(subscribe, currentTheme, () => "dark");
}

/** Botón de sol/luna: cambia entre modo oscuro (por defecto) y claro, y lo recuerda en este navegador. */
export function ThemeToggle({ className = "", withLabel = false }: { className?: string; withLabel?: boolean }) {
  const theme = useStudioTheme();
  const next: StudioTheme = theme === "light" ? "dark" : "light";
  const label = next === "light" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return (
    <button
      type="button"
      onClick={() => setStudioTheme(next)}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/10 ${withLabel ? "px-3 py-2 text-xs font-semibold" : "size-9"} ${className}`}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
      {withLabel && <span>{next === "light" ? "Modo claro" : "Modo oscuro"}</span>}
    </button>
  );
}
