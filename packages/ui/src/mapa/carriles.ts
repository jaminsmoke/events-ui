import type { WorkItem } from "../core/api";
import type { components } from "../core/schema";

export type Status = WorkItem["status"];

/** Los carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `items.status`. `draft` es la entrada,
 *  donde se crea; `proposed` está en cola; `roadmap`, `verificacion` y
 *  `revision_aprobada` son las fichas del flujo completo; y
 *  `rejected`/`superseded` cierran la rama en Descartadas. `eliminadas` es
 *  solo representación en el mapa: no hay status persistido; las filas que
 *  llegan ahí se queman y desaparecen. En cuanto un ítem recibe carril,
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

/** El grupo de flujo de un carril: el que publica `GET /protocolos`. Sale del
 *  contrato generado (`Protocolo`), no de una lista copiada a mano. */
export type Grupo = components["schemas"]["Protocolo"]["origen"];

/** La única tabla estado → carril y grupo.
 *
 *  Antes el mapa estaba en cinco sitios —`_grupo` del core, `laneOf`, los
 *  estados por carril del panel, `A_GRUPO` y el enum zod—: un cambio de flujo
 *  obligaba a cinco ediciones y una podía quedarse atrás, con la UI ofreciendo
 *  un traslado que el core rechazaba. `carril: null` es la Entrada, que no
 *  tiene carril: se crea allí y de allí sale. `eliminadas` no aparece porque no
 *  hay estado persistido. En el core, `_grupo` sigue siendo la verdad que
 *  impone el PATCH; esta tabla es su espejo de lectura en la UI.
 */
export const CARRIL_DE_ESTADO: Record<Status, { carril: LaneId | null; grupo: Grupo }> = {
  draft: { carril: null, grupo: "draft" },
  proposed: { carril: "cola", grupo: "proposed" },
  roadmap: { carril: "roadmap", grupo: "roadmap" },
  verificacion: { carril: "verificacion", grupo: "verificacion" },
  revision_aprobada: { carril: "revision_aprobada", grupo: "revision_aprobada" },
  historial: { carril: "historial", grupo: "historial" },
  rejected: { carril: "descartadas", grupo: "rejected" },
  superseded: { carril: "descartadas", grupo: "rejected" },
};

/** Los grupos del flujo, en el orden en que aparecen en la tabla.
 *
 *  No se escriben aparte: salen de `CARRIL_DE_ESTADO`, que es el único sitio
 *  que reparte estados. `superseded` comparte el de `rejected`, así que el
 *  `Set` lo deja una vez. Es la lista con la que `useProtocolos` construye su
 *  enum zod. El `as` es solo porque `z.enum` pide una tupla no vacía, y la
 *  tabla siempre tiene algún grupo. */
export const GRUPOS = [
  ...new Set(Object.values(CARRIL_DE_ESTADO).map((ficha) => ficha.grupo)),
] as [Grupo, ...Grupo[]];

/** Todos los estados en el orden del flujo, para recorrerlos y buscar salidas. */
export const ESTADOS = Object.keys(CARRIL_DE_ESTADO) as readonly Status[];

/** Los estados de un carril, en el orden del flujo. */
export function estadosDeCarril(lane: LaneId): readonly Status[] {
  return ESTADOS.filter((estado) => CARRIL_DE_ESTADO[estado].carril === lane);
}

/** Los estados sin carril propio: la Entrada. */
export const ESTADOS_ENTRADA: readonly Status[] = ESTADOS.filter(
  (estado) => CARRIL_DE_ESTADO[estado].carril === null,
);

/** Los estados de cada carril, para la ficha del panel: sale de la tabla. */
export const ESTADOS_POR_CARRIL: Record<LaneId, readonly Status[]> = Object.fromEntries(
  LANES.map((carril) => [carril.id, estadosDeCarril(carril.id)]),
) as Record<LaneId, readonly Status[]>;

/** El grupo de un estado para mover: `superseded` cuenta como `rejected`
 *  (la ficha lo distingue, el carril no) —igual que en el core. */
export function grupoDeEstado(status: Status): Grupo {
  return CARRIL_DE_ESTADO[status].grupo;
}

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
 *  Entrada y `git` no es un carril de items. */
export function tituloCarril(lane: string): string {
  if (lane === "root") return "Entrada";
  return LANES.find((carril) => carril.id === lane)?.title ?? (lane === "git" ? "Git" : lane);
}

export function laneOf(status: Status): LaneId | null {
  // `eliminadas` no sale de un status: solo vive en la UI mientras se quema.
  return CARRIL_DE_ESTADO[status].carril;
}

/** ¿Se puede pedir la eliminación definitiva? Solo desde Descartadas. */
export function sePuedeEliminar(status: Status | undefined): boolean {
  return status === "rejected" || status === "superseded";
}
