import type { Idea } from "../core/api";

export type Status = Idea["status"];

/** Los carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `ideas.status`. `draft` es la entrada,
 *  donde se crea; `proposed` está en cola; `roadmap`, `verificacion` y
 *  `revision_aprobada` son las fichas del flujo completo; y
 *  `rejected`/`superseded` cierran la rama en Descartadas. En cuanto una
 *  idea recibe carril, deja la entrada: no se ve en los dos sitios a la vez.
 *  Un carril de verdad solo hará falta cuando las columnas sean datos
 *  (nombre, orden, por repo), no constantes.
 */
export const LANES = [
  { id: "cola", title: "En cola" },
  { id: "roadmap", title: "En roadmap" },
  { id: "verificacion", title: "En verificación" },
  { id: "revision_aprobada", title: "Revisión aprobada" },
  { id: "descartadas", title: "Descartadas" },
] as const;

export type LaneId = (typeof LANES)[number]["id"];

export function laneOf(status: Status): LaneId | null {
  if (status === "rejected" || status === "superseded") return "descartadas";
  if (status === "proposed") return "cola";
  if (status === "roadmap") return "roadmap";
  if (status === "verificacion") return "verificacion";
  if (status === "revision_aprobada") return "revision_aprobada";
  return null;
}
