import type { Idea } from "../core/api";

export type Status = Idea["status"];

/** Los dos carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `ideas.status`. `draft` aún no tiene
 *  carril: vive en el cajón de Ideas, donde se crea. `proposed`/`accepted`
 *  están en cola; `rejected`/`superseded` cierran la rama en Descartadas.
 *  En cuanto una idea recibe carril, deja el cajón: no se ve en los dos
 *  sitios a la vez. Un carril de verdad solo hará falta cuando las columnas
 *  sean datos (nombre, orden, por repo), no dos constantes.
 */
export const LANES = [
  { id: "cola", title: "En cola" },
  { id: "descartadas", title: "Descartadas" },
] as const;

export type LaneId = (typeof LANES)[number]["id"];

export function laneOf(status: Status): LaneId | null {
  if (status === "rejected" || status === "superseded") return "descartadas";
  if (status === "proposed" || status === "accepted") return "cola";
  return null;
}
