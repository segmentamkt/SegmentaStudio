import { notFound } from "next/navigation";
import { EditorDemo } from "./editor-demo";

/** Banco local del editor con datos de prueba. No existe en producción. */
export default function SalaDemoEditorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EditorDemo />;
}
