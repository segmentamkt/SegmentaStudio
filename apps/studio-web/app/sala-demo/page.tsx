import { notFound } from "next/navigation";
import { OrdenDemo } from "./orden-demo";
import { RecursosDemo } from "./recursos-demo";
import { SalaDemo } from "./sala-demo";

/** Banco de pruebas local: sala de edición, ?vista=orden («Así quedará tu video») y ?vista=recursos (imágenes con IA). No existe en producción. */
export default async function SalaDemoPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const view = (await searchParams).vista;
  return view === "orden" ? <OrdenDemo /> : view === "recursos" ? <RecursosDemo /> : <SalaDemo />;
}
