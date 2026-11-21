/** Lo que se puede seleccionar en el lienzo.
 *
 *  La selección es una clave, no una copia: el Inspector resuelve con ella el
 *  elemento en los datos que ya tiene el mapa. Los elementos que todavía no
 *  tienen ficha propia (carril, idea, cambios, cable) se seleccionan ya en
 *  esta fase; sus campos llegan en los pasos siguientes del roadmap. */
export type Seleccion =
  | { tipo: "cajon" }
  | { tipo: "carril"; clave: string }
  | { tipo: "idea"; uid: string }
  | { tipo: "puente" }
  | { tipo: "git" }
  | { tipo: "commits" }
  | { tipo: "cambios" }
  | { tipo: "cambio"; ruta: string }
  | { tipo: "commit"; hash: string }
  | { tipo: "cable"; id: string }
  | { tipo: "nudo"; id: string };

/** Etiqueta de cada clase de elemento, para el Inspector. */
export const ETIQUETA_SELECCION: Record<Seleccion["tipo"], string> = {
  cajon: "Entrada",
  carril: "Carril",
  idea: "Idea",
  puente: "Entregar a Git",
  git: "Nodo de Git",
  commits: "Commits",
  cambios: "Cambios sin commit",
  cambio: "Archivo sin commit",
  commit: "Commit",
  cable: "Cable y compuerta",
  nudo: "Nudo y compuertas",
};

/** Clave estable del elemento: tipo más identidad, sin repetir el mapa. */
export function claveSeleccion(seleccion: Seleccion): string {
  switch (seleccion.tipo) {
    case "cajon":
    case "puente":
    case "git":
    case "commits":
    case "cambios":
      return seleccion.tipo;
    case "carril":
      return `carril:${seleccion.clave}`;
    case "idea":
      return `idea:${seleccion.uid}`;
    case "cambio":
      return `cambio:${seleccion.ruta}`;
    case "commit":
      return `commit:${seleccion.hash}`;
    case "cable":
      return `cable:${seleccion.id}`;
    case "nudo":
      return `nudo:${seleccion.id}`;
  }
}

/** ¿La selección actual es este elemento? Compara por clave, así que un objeto
 *  nuevo con la misma identidad cuenta como el mismo elemento. */
export function mismoElemento(
  actual: Seleccion | null | undefined,
  elemento: Seleccion,
): boolean {
  return actual != null && claveSeleccion(actual) === claveSeleccion(elemento);
}
