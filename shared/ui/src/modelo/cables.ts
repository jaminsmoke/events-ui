/** Las formas de los cables y del nodo de rechazo, sin React ni DOM.
 *
 *  Vivían dentro de `mapa/cables.ts`, mezcladas con el hook que mide el DOM:
 *  el inspector (`pantalla/`) importaba el hook solo por estos tipos. Aquí
 *  quedan como modelo y el hook las reexporta para no mover a sus clientes.
 */
import type { LaneId } from "./carriles";
import type { Punto } from "./geometria";
import type { Union } from "./protocolos";

/** El nodo Git cierra la línea, pero no es un carril de items: solo aporta
 *  su color y su cable. */
export type DestinoCable = LaneId | "git";

/** Un cable entre etapas de la línea, ya medido en píxeles del mapa.
 *  `lane` es el carril de destino: da el color y por dónde viaja la chispa.
 *  `origenLane` permite distinguir el cable de ida del de vuelta cuando los
 *  dos llegan al mismo carril. `uniones` son las uniones de protocolo que
 *  cruza (tabla en `protocolos.ts`); `nudo` es el nudo del que sale, si sale de
 *  alguno, y manda su compuerta dentro del rombo. `rama` marca los retornos de
 *  la revisión rechazada, que salen del nudo de abajo y no del flujo principal.
 *  `puntos` es la ruta ortogonal —solo tramos horizontales y verticales— y
 *  `chevron` guarda dónde cae la flecha de dirección dentro de esa ruta.
 *  `presion` es lo que espera en el origen: el cable engorda con lo que se
 *  acumula antes de la compuerta, no con lo que ya llegó al destino. */
export type Cable = {
  id: string;
  lane: DestinoCable;
  origenLane: LaneId | "root";
  destinoLane: DestinoCable;
  uniones: readonly Union[];
  rama?: boolean;
  /** Archivar no es una unión de protocolo: la compuerta se abre porque el
   *  destino está disponible, no porque una fila la permita. */
  abierta?: boolean;
  /** El nudo del que sale el cable: su compuerta va dentro de su rombo. */
  nudo?: string;
  presion: number;
  puntos: Punto[];
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Dónde va la compuerta de protocolo y su ángulo en grados, listo para
   *  `rotate`. Lo fija `repartirCompuertas`, que es la única regla de sitio. */
  compuerta: { x: number; y: number; angulo: number };
  /** Dónde va el chevrón de dirección y su ángulo, sin depender del movimiento. */
  chevron: { x: number; y: number; angulo: number };
  /** Longitud del trazado en px: la chispa tarda más si es largo. */
  longitud: number;
};

/** El nodo de «Revisión rechazada»: una bifurcación, no un carril. No guarda
 *  items; solo dice por dónde puede volver una revisión que no se aprueba.
 *  Sus nudos —el de arriba y los del tronco— viven en la lista de nudos del
 *  mapa, como los demás. */
export type RamaRechazo = {
  caja: { x: number; y: number; w: number; h: number };
  /** El tramo vertical desde el nudo del cable hasta el canto superior. */
  tronco: string;
  /** El tronco único del que se despega cada vuelta, ya horizontal. */
  bus: string | null;
};
