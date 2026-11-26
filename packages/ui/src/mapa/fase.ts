/** Lo que necesitan las fases fuera del editor: su tipo, sus etiquetas y el
 *  formato con el que viajan en el PATCH. */

import type { WorkItem, WorkItemUpdate } from "../core/api";

/** Estados de una fase (`work_item_fase`, 0021). */
export const ESTADOS_FASE = ["pendiente", "completada", "fallida", "rechazada"] as const;
export type Fase = NonNullable<WorkItem["fases"]>[number];

/** Las fases en el formato del PATCH: sin `entered_at` (lo pone el core) ni
 *  `done_at` (lo pone al marcar). Lo comparten la fila y la ficha. */
export function comoFases(fases: readonly Fase[]): NonNullable<WorkItemUpdate["fases"]> {
  return fases.map(({ orden, titulo, estado, nota, requisitos }) => ({
    orden,
    titulo,
    estado,
    nota,
    requisitos: (requisitos ?? []).map(({ orden: suOrden, titulo: suTitulo, hecho }) => ({
      orden: suOrden,
      titulo: suTitulo,
      hecho,
    })),
  }));
}

/** ¿Las dos listas son las mismas fases, requisitos incluidos?
 *
 *  El mapa trae arrays nuevos en cada relectura (el SSE relee por cada
 *  evento), así que la copia optimista no puede compararse por identidad.
 *  `entered_at` y `done_at` no cuentan: los pone el core y no cambian lo que
 *  el usuario ve. */
export function mismasFases(a: readonly Fase[], b: readonly Fase[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((fase, indice) => {
    const otra = b[indice];
    if (!otra) return false;
    if (
      fase.orden !== otra.orden ||
      fase.titulo !== otra.titulo ||
      fase.estado !== otra.estado ||
      fase.nota !== otra.nota
    ) {
      return false;
    }
    const requisitos = fase.requisitos ?? [];
    const otros = otra.requisitos ?? [];
    return (
      requisitos.length === otros.length &&
      requisitos.every((requisito, j) => {
        const otro = otros[j];
        if (!otro) return false;
        return (
          requisito.orden === otro.orden &&
          requisito.titulo === otro.titulo &&
          requisito.hecho === otro.hecho
        );
      })
    );
  });
}

/** Nombre de cada estado de fase para la ficha, en español. */
export const ETIQUETA_FASE: Record<string, string> = {
  pendiente: "Pendiente",
  completada: "Completada",
  fallida: "Fallida",
  rechazada: "Rechazada",
};
