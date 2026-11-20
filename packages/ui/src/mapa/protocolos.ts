/** Las compuertas de protocolo del mapa, en un solo sitio.
 *
 *  Cada cable del flujo cruza una o varias uniones de carriles (la allowlist
 *  `protocolo_flujo` del core). Antes esa lista estaba partida en dos: la
 *  geometría de `cables.ts` y el `UNION` de `compuertas.tsx`, y podían decir
 *  cosas distintas. Ahora la geometría y el dibujo leen de aquí, así que el
 *  mapa no puede enseñar una unión que el código no conozca ni al revés.
 *
 *  La tabla no dice dónde va la celda: eso lo decide una sola regla en
 *  `cables.ts` — dentro del rombo del nudo del que sale el cable y, si el
 *  cable no nace de un nudo, en el punto medio de su trazado.
 */
import type { Status } from "./carriles";

/** Una unión permitida entre carriles: origen → destino. */
export type Union = readonly [Status, Status];

/** Los cables con compuerta, por id.
 *
 *  Un cable puede cruzar varias uniones: una idea se descarta desde la entrada
 *  y desde la cola, así que la compuerta del descarte se abre si cualquiera de
 *  las dos está permitida y suma las exigencias de ambas.
 *
 *  `[]` es archivar: no es una unión de protocolo, la compuerta se abre por
 *  disponibilidad del destino (tener work tree), no por una fila de la tabla. */
export const UNIONES: Record<string, readonly Union[]> = {
  "etapa-cola": [["draft", "proposed"]],
  "etapa-roadmap": [["proposed", "roadmap"]],
  "etapa-verificacion": [["roadmap", "verificacion"]],
  "etapa-revision": [["verificacion", "revision_aprobada"]],
  "descarte-entrada-cola": [
    ["draft", "rejected"],
    ["proposed", "rejected"],
  ],
  "rechazo-cola": [["verificacion", "proposed"]],
  "rechazo-roadmap": [["verificacion", "roadmap"]],
  "rechazo-descartadas": [["verificacion", "rejected"]],
  "etapa-git": [],
  "etapa-historial": [],
};
