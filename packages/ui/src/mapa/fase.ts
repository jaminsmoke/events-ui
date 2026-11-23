/** Lo que necesitan las fases fuera del editor: su tipo, sus etiquetas y el
 *  formato con el que viajan en el PATCH. */

import type { Idea, IdeaUpdate } from "../core/api";

/** Estados de una fase (`work_item_fase`, 0021). */
export const ESTADOS_FASE = ["pendiente", "completada", "fallida", "rechazada"] as const;
export type Fase = NonNullable<Idea["fases"]>[number];

/** Las fases en el formato del PATCH: sin `entered_at` (lo pone el core) ni
 *  `done_at` (lo pone al marcar). Lo comparten la fila y la ficha. */
export function comoFases(fases: readonly Fase[]): NonNullable<IdeaUpdate["fases"]> {
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

/** Nombre de cada estado de fase para la ficha, en español. */
export const ETIQUETA_FASE: Record<string, string> = {
  pendiente: "Pendiente",
  completada: "Completada",
  fallida: "Fallida",
  rechazada: "Rechazada",
};
