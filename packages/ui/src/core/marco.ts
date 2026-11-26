/** Las medidas del marco viven en `marco.css` y en ningún otro sitio. TS las
 *  lee del DOM para que la cámara descuente el panel que hay de verdad. */
export type MedidaMarco =
  | "--ancho-rail"
  | "--ancho-pane"
  | "--ancho-resumen"
  | "--ancho-minimo-paneles";

export function medidaMarco(nombre: MedidaMarco): number {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre);
  const numero = Number.parseFloat(valor);
  return Number.isFinite(numero) ? numero : 0;
}
