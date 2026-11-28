/** ¿El esquema se sale de la ventana del tablero?
 *
 *  Es lo único que depende de dónde esté la cámara: arrastrar cambia los
 *  cantos y hay que ofrecer reencuadrar. La medida de los nodos, en cambio, va
 *  en coordenadas del mapa y solo la mueve el zoom (o un cambio de tamaño).
 *
 *  Vivía dentro de `cables.ts`, entre la medición de las cajas y el trazado;
 *  aquí se prueba sin montar el hook entero.
 */
export function recortadoDe(
  map: HTMLElement,
  board: HTMLElement | null,
  insetDerecha = 0,
): boolean {
  if (!board) return false;
  const vista = map.getBoundingClientRect();
  const hueco = board.getBoundingClientRect();
  // El panel derecho tapa el canto sin encoger la caja: lo tapado también
  // cuenta como fuera de la vista, o el aviso mentiría.
  return (
    vista.left < hueco.left - 1 ||
    vista.right > hueco.right - insetDerecha + 1 ||
    vista.top < hueco.top - 1 ||
    vista.bottom > hueco.bottom + 1
  );
}
