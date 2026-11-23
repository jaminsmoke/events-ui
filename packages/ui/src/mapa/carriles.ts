import type { Idea } from "../core/api";

export type Status = Idea["status"];

/** Los carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `ideas.status`. `draft` es la entrada,
 *  donde se crea; `proposed` está en cola; `roadmap`, `verificacion` y
 *  `revision_aprobada` son las fichas del flujo completo; y
 *  `rejected`/`superseded` cierran la rama en Descartadas. `eliminadas` es
 *  solo representación en el mapa: no hay status persistido; las filas que
 *  llegan ahí se queman y desaparecen. En cuanto una idea recibe carril,
 *  deja la entrada: no se ve en los dos sitios a la vez. Un carril de verdad
 *  solo hará falta cuando las columnas sean datos (nombre, orden, por repo),
 *  no constantes.
 */
export const LANES = [
  { id: "cola", title: "Backlog" },
  { id: "roadmap", title: "Roadmap" },
  { id: "verificacion", title: "Verificación" },
  { id: "revision_aprobada", title: "Revisión" },
  { id: "historial", title: "Changelog" },
  { id: "descartadas", title: "Descartadas" },
  { id: "eliminadas", title: "Eliminadas" },
] as const;

export type LaneId = (typeof LANES)[number]["id"];

/** Palabra del estado para la UI, en español: el contrato habla `draft`/
 *  `proposed` pero el mapa se lee en español. Los nombres son los mismos
 *  carriles: `draft` es la entrada, `proposed` vive en la cola y el resto en
 *  su carril. Vive aquí, junto a `Status`, para compartirla sin exportar
 *  constantes desde un módulo de componentes (Fast Refresh). */
export const ETIQUETA_ESTADO: Record<string, string> = {
  draft: "Entrada",
  proposed: "Backlog",
  roadmap: "Roadmap",
  verificacion: "Verificación",
  revision_aprobada: "Revisión",
  historial: "Changelog",
  rejected: "Descartado",
  superseded: "Reemplazado",
};

/** El título legible de un carril o de un extremo de cable: `root` es la
 *  Entrada y `git` no es un carril de ideas. */
export function tituloCarril(lane: string): string {
  if (lane === "root") return "Entrada";
  return LANES.find((carril) => carril.id === lane)?.title ?? (lane === "git" ? "Git" : lane);
}

export function laneOf(status: Status): LaneId | null {
  if (status === "rejected" || status === "superseded") return "descartadas";
  if (status === "proposed") return "cola";
  if (status === "roadmap") return "roadmap";
  if (status === "verificacion") return "verificacion";
  if (status === "revision_aprobada") return "revision_aprobada";
  if (status === "historial") return "historial";
  // `eliminadas` no sale de un status: solo vive en la UI mientras se quema.
  return null;
}

/** ¿Se puede pedir la eliminación definitiva? Solo desde Descartadas. */
export function sePuedeEliminar(status: Status | undefined): boolean {
  return status === "rejected" || status === "superseded";
}
