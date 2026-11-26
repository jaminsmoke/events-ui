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
