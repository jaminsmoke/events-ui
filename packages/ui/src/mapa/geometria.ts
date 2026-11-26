/** Geometría del mapa: puntos, rutas y reparto de compuertas.
 *
 *  Aquí no hay DOM ni React. El hook de `cables.ts` mide las cajas de cada
 *  nodo en coordenadas locales del mapa y le pasa esos números a estas
 *  funciones; todo lo que se puede probar sin ventana vive aquí.
 */

import type { Union } from "./protocolos";

/** Un punto del trazado, en píxeles locales del mapa. */
export type Punto = { x: number; y: number };

/** Medidas de la celda de protocolo. Las comparte `compuertas.tsx`, y el rombo
 *  de un nudo se dimensiona con ellas para que sus celdas quepan dentro. */
export const CELDA = { ancho: 10, alto: 18 } as const;

/** Aire entre dos celdas del mismo nudo y margen hasta el filo del rombo. */
const HUECO_CELDA = 4;
const MARGEN_NUDO = 3;

/** Un nudo del mapa: un rombo donde el flujo se bifurca. Cada cable que sale
 *  de él lleva su compuerta dentro, y `lado` se deriva de cuántas lleva
 *  (ver `repartirCompuertas`). */
export type Nudo = {
  id: string;
  x: number;
  y: number;
  lado: number;
  /** Los nudos de la revisión rechazada se pintan con su propio color. */
  rechazo?: boolean;
};

/** Lo mínimo que necesita un cable para que su compuerta se coloque: su ruta,
 *  el nudo del que sale y las uniones que cruza. `Cable` lo cumple entero. */
export type TramoCompuerta = {
  puntos: readonly Punto[];
  nudo?: string;
  uniones: readonly Union[];
  /** Archivar no es una unión: la compuerta se abre porque el destino está
   *  disponible. Una compuerta apagada no ocupa sitio en el rombo. */
  abierta?: boolean;
  compuerta: { x: number; y: number; angulo: number };
};

/** Velocidad de la chispa en px/s, con tope para no sobrevivir a la ventana
 *  de actividad (1,15 s), que desmonta las chispas. */
export function duracionChispa(longitud: number): number {
  return Math.min(1.05, Math.max(0.42, longitud / 90));
}

/** Longitud de una ruta de puntos. */
export function largo(puntos: readonly Punto[]): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]!;
    const b = puntos[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Pinta una ruta ortogonal. Solo hay `M` y `L`: cada tramo es horizontal o
 *  vertical, sin curvas libres, como una pista de circuito impreso. */
export function trazoDe(puntos: readonly Punto[]): string {
  return puntos.map((punto, i) => `${i === 0 ? "M" : "L"} ${punto.x} ${punto.y}`).join(" ");
}

/** Punto y ángulo a una fracción de la longitud total. Sirve para colocar la
 *  compuerta y el chevrón sobre un tramo recto de la ruta. */
export function puntoEnTrazo(
  puntos: readonly Punto[],
  fraccion: number,
): { x: number; y: number; angulo: number } {
  if (puntos.length === 0) return { x: 0, y: 0, angulo: 0 };
  const primero = puntos[0]!;
  if (puntos.length === 1) return { ...primero, angulo: 0 };

  let restante = Math.max(0, Math.min(1, fraccion)) * largo(puntos);
  let ultimoAngulo = 0;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]!;
    const b = puntos[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const tramo = Math.hypot(dx, dy);
    if (tramo === 0) continue;
    const angulo = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (restante <= tramo) {
      const t = restante / tramo;
      return { x: a.x + dx * t, y: a.y + dy * t, angulo };
    }
    restante -= tramo;
    ultimoAngulo = angulo;
  }
  const ultimo = puntos[puntos.length - 1]!;
  return { x: ultimo.x, y: ultimo.y, angulo: ultimoAngulo };
}

/** Hacia dónde sale del nudo el cable, en grados. Ordena las celdas de un
 *  mismo nudo como su abanico de ramas: primero la que sigue de largo y
 *  después la que se abre. */
export function salida(tramo: { puntos: readonly Punto[] }, nudo: Nudo): number {
  const i = tramo.puntos.findIndex(
    (punto) => Math.abs(punto.x - nudo.x) < 0.5 && Math.abs(punto.y - nudo.y) < 0.5,
  );
  const desde = tramo.puntos[Math.max(0, i)] ?? tramo.puntos[0];
  const hasta = tramo.puntos[Math.max(0, i) + 1] ?? tramo.puntos[tramo.puntos.length - 1];
  if (!desde || !hasta) return 0;
  return (Math.atan2(hasta.y - desde.y, hasta.x - desde.x) * 180) / Math.PI;
}

/** La regla de sitio de las compuertas, en un solo lugar: la celda de protocolo
 *  vive dentro del rombo del nudo del que sale su cable y, si el cable no sale
 *  de un nudo, en el punto medio de su trazado.
 *
 *  Cuando un nudo tiene varias celdas (archivar abre dos compuertas, la de Git
 *  y la del Historial) se reparten en fila alrededor del centro, en el orden de
 *  sus ramas, y el rombo crece justo lo que hace falta para que quepan dentro.
 *  Así el código y el mapa cuentan lo mismo: cada unión de `protocolos.ts` es
 *  una caja, y cada caja está donde está su cable. */
export function repartirCompuertas(tramos: TramoCompuerta[], nudos: readonly Nudo[]): void {
  const porNudo = new Map<string, TramoCompuerta[]>();
  for (const tramo of tramos) {
    // Una compuerta que no se dibuja (el paso a Git sin work tree) no ocupa
    // sitio: la otra del nudo se queda centrada.
    if (!tramo.nudo || (tramo.uniones.length === 0 && !tramo.abierta)) continue;
    const suyos = porNudo.get(tramo.nudo);
    if (suyos) suyos.push(tramo);
    else porNudo.set(tramo.nudo, [tramo]);
  }
  for (const nudo of nudos) {
    const celdas = porNudo.get(nudo.id);
    if (!celdas) continue;
    celdas.sort((a, b) => salida(a, nudo) - salida(b, nudo));
    const ancho = celdas.length * CELDA.ancho + (celdas.length - 1) * HUECO_CELDA;
    celdas.forEach((tramo, i) => {
      tramo.compuerta = {
        x: nudo.x + (i - (celdas.length - 1) / 2) * (CELDA.ancho + HUECO_CELDA),
        y: nudo.y,
        angulo: 0,
      };
    });
    // El rombo circunscribe la fila de celdas: media diagonal = medio ancho
    // más media celda, y el lado que le corresponde.
    nudo.lado = Math.ceil((ancho / 2 + CELDA.alto / 2 + MARGEN_NUDO) * Math.SQRT2);
  }
}
