import type { Idea } from "../core/api";

export type Status = Idea["status"];

/** Los dos carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `ideas.status`. `rejected`/`superseded`
 *  cierran la rama; el resto sigue en cola. Un carril de verdad solo hará falta
 *  cuando las columnas sean datos (nombre, orden, por repo), no dos constantes.
 */
export const LANES = [
  { id: "cola", title: "En cola" },
  { id: "descartadas", title: "Descartadas" },
] as const;

export type LaneId = (typeof LANES)[number]["id"];

export function laneOf(status: Status): LaneId {
  return status === "rejected" || status === "superseded" ? "descartadas" : "cola";
}
