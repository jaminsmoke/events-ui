import { useMemo } from "react";

import type { WorkItem } from "../core/api";
import { buildTree } from "./arbol";
import type { Tree } from "./arbol";

/** Una fila quemándose en Eliminadas: solo UI, antes del borrado real. */
export type Quema = { id: number; uid: string; title: string };

/** El árbol del mapa, con las filas que se están quemando en Eliminadas.
 *
 *  No hay status `eliminadas` en el almacén: esas filas se inyectan aquí
 *  mientras dura la animación y desaparecen cuando el borrado termina. */
export function useArbolMapa(
  ideas: WorkItem[] | null,
  quemas: readonly Quema[],
): Tree | null {
  return useMemo(() => {
    if (!ideas) return null;
    const ocultas = new Set(quemas.map((quema) => quema.uid));
    const base = buildTree(ideas.filter((idea) => !ocultas.has(idea.uid)));
    if (quemas.length === 0) return base;
    return {
      ...base,
      carriles: base.carriles.map((lane) => {
        if (lane.tone !== "eliminadas") return lane;
        return {
          ...lane,
          total: quemas.length,
          kids: quemas.map((quema) => ({
            key: `quema-${quema.id}`,
            title: quema.title,
            total: 0,
            kids: [],
          })),
        };
      }),
    };
  }, [ideas, quemas]);
}
