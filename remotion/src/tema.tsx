import { createContext, useContext } from "react";
import { AMARILLO, MORADO, VIOLETA } from "./util";

// Colores de marca del proyecto (plantilla de marca); por defecto, los de Kiko.
export type Tema = { morado: string; violeta: string; amarillo: string };
export const TEMA_KIKO: Tema = { morado: MORADO, violeta: VIOLETA, amarillo: AMARILLO };
export const TemaContexto = createContext<Tema>(TEMA_KIKO);
export const useTema = () => useContext(TemaContexto);
