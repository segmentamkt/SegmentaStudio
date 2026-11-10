import { notFound } from "next/navigation";
import { OrdenDemo } from "./orden-demo";
import { SalaDemo } from "./sala-demo";

/** Banco de pruebas local de la sala de edición (y de «Así quedará tu video» con ?vista=orden). No existe en producción. */
export default async function SalaDemoPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (await searchParams).vista === "orden" ? <OrdenDemo /> : <SalaDemo />;
}
