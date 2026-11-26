/** Cuándo se avisa: la política, sin React ni `localStorage`.
 *
 *  `avisos.ts` guarda los ajustes de esta máquina; aquí se decide si un
 *  evento o un error merece una notificación con esos ajustes y el estado de
 *  la ventana. Así la regla se puede probar sin navegador.
 */
import type { Ajustes } from "./avisos";

/** Qué clase de aviso se está decidiendo. */
export type ClaseAviso = "evento" | "error";

export function avisaEventos(ajustes: Ajustes): boolean {
  return ajustes.verbosidad === "eventos" || ajustes.verbosidad === "todo";
}

export function avisaErrores(ajustes: Ajustes): boolean {
  return ajustes.verbosidad === "errores" || ajustes.verbosidad === "todo";
}

/** ¿Toca avisar? La verbosidad elige la clase y `soloFondo`, con la ventana
 *  delante, la silencia. */
export function puedeAvisar(
  ajustes: Ajustes,
  clase: ClaseAviso,
  ventanaOculta: boolean,
): boolean {
  const encendido = clase === "evento" ? avisaEventos(ajustes) : avisaErrores(ajustes);
  return encendido && (!ajustes.soloFondo || ventanaOculta);
}

/** Los eventos posteriores al último visto. El primer lote del SSE (`previo`
 *  nulo) es el historial y no avisa. */
export function eventosNuevos<T extends { id: number }>(
  eventos: readonly T[],
  previo: number | null,
): T[] {
  if (previo === null) return [];
  return eventos.filter((evento) => evento.id > previo);
}
