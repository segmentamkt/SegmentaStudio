import { notFound } from "next/navigation";
import { OrdenDemo } from "./orden-demo";
import { RecursosDemo } from "./recursos-demo";
import { LineaDemo } from "./linea-demo";
import { InicioDemo } from "./inicio-demo";
import { SalaDemo } from "./sala-demo";

/** Banco de pruebas local: sala de edición, ?vista=orden («Así quedará tu video»), ?vista=recursos (imágenes con IA) y ?vista=linea (línea de tiempo) y ?vista=inicio (inicio de Studio). No existe en producción. */
export default async function SalaDemoPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const view = (await searchParams).vista;
  return view === "orden" ? <OrdenDemo /> : view === "recursos" ? <RecursosDemo /> : view === "linea" ? <LineaDemo /> : view === "inicio" ? <InicioDemo /> : <SalaDemo />;
}
