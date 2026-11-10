import { notFound } from "next/navigation";
import { SalaDemo } from "./sala-demo";

/** Banco de pruebas local de la sala de edición. No existe en producción. */
export default function SalaDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SalaDemo />;
}
