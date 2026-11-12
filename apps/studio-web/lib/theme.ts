/** Tema de Studio: oscuro por defecto; "light" se guarda en este navegador. */
export type StudioTheme = "dark" | "light";
export const THEME_STORAGE_KEY = "segmenta.theme";
export const THEME_COLORS: Record<StudioTheme, string> = { dark: "#070910", light: "#f6f7fb" };

/** Lee el tema guardado antes de pintar, para que la página no parpadee al cargar. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="light"){document.documentElement.dataset.theme="light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","${THEME_COLORS.light}")}}catch(e){}`;
