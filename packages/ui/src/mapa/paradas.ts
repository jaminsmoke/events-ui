import type { CommitGit, ProyeccionRepo, WorkItem } from "../core/api";
import { LANES } from "../modelo/carriles";
import type { Nudo } from "../modelo/geometria";
import type { Seleccion } from "../modelo/seleccion";
import type { MapaLienzo } from "../pantalla/Actividad";
import type { Cable } from "../modelo/cables";

/** La navegación del teclado por las paradas del lienzo.
 *
 *  Flechas y Enter recorren lo que se puede seleccionar en el orden en que se
 *  lee el mapa. La regla es una sola: si no hay selección, la primera flecha
 *  entra por el principio (o por el final, si va hacia atrás) y el resto
 *  avanza en circular.
 */
/** La parada siguiente en circular. `actual` es -1 cuando no hay selección;
 *  sin paradas devuelve -1. */
export function siguienteIndice(total: number, actual: number, salto: number): number {
  if (total <= 0) return -1;
  if (actual < 0) return salto > 0 ? 0 : total - 1;
  return (actual + salto + total) % total;
}

/** Las paradas del mapa, en el orden en que se lee el lienzo: la Entrada, los
 *  carriles, los ítems, los nudos, los cables y los puentes. En el Mapa de Git:
 *  nodo, historial, commits y cambios. En Documentos: el Changelog y sus
 *  archivados.
 *
 *  Es lógica pura: el mapa y sus medidas entran por argumento, así que se
 *  prueba sin React y `App` solo la memoriza. */
export function paradasDe({
  mapa,
  proyeccion,
  commits,
  items,
  nudos,
  cables,
}: {
  mapa: MapaLienzo;
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  items: readonly WorkItem[] | null | undefined;
  nudos: readonly Nudo[];
  cables: readonly Cable[];
}): Seleccion[] {
  if (mapa === "git") {
    const cambios = proyeccion?.git_cambios ?? [];
    return [
      { tipo: "git" },
      { tipo: "commits" },
      ...commits.map((commit) => ({ tipo: "commit" as const, hash: commit.hash })),
      ...(cambios.length > 0 ? [{ tipo: "cambios" as const }] : []),
      ...cambios.map((cambio) => ({ tipo: "cambio" as const, ruta: cambio.ruta })),
    ];
  }
  if (mapa === "documentos") {
    return [
      { tipo: "carril", clave: "lane-historial" },
      ...(items ?? [])
        .filter((item) => item.status === "historial")
        .map((item) => ({ tipo: "item" as const, uid: item.uid })),
    ];
  }
  return [
    { tipo: "cajon" },
    ...LANES.filter((lane) => lane.id !== "historial").map((lane) => ({
      tipo: "carril" as const,
      clave: `lane-${lane.id}`,
    })),
    ...(items ?? [])
      .filter((item) => item.status !== "historial")
      .map((item) => ({ tipo: "item" as const, uid: item.uid })),
    ...nudos.map((nudo) => ({ tipo: "nudo" as const, id: nudo.id })),
    ...cables.map((cable) => ({ tipo: "cable" as const, id: cable.id })),
    { tipo: "puente" },
    { tipo: "puente_documentos" },
  ];
}
