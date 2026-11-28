import type { NivelArbol, NodoArbol } from "./api";

/** Los hijos de cada nivel, por ruta; la raíz es la clave `""`. */
export type Niveles = Record<string, NodoArbol[]>;

/** ¿Mismos hijos en el mismo orden? Se compara de uno en uno: ni cadenas ni
 *  JSON, y se corta en el primer hijo distinto. */
function iguales(antes: NodoArbol[], ahora: NodoArbol[]): boolean {
  if (antes === ahora) return true;
  if (antes.length !== ahora.length) return false;
  return antes.every((hijo, i) => {
    const otro = ahora[i];
    return otro !== undefined && hijo.nombre === otro.nombre && hijo.tipo === otro.tipo;
  });
}

/** ¿El mismo contenido en otro orden? Solo se llama cuando `iguales` falla:
 *  el orden de una carpeta no es un cambio, y el pane se queda con el que ya
 *  tenía en vez de repintarse. */
function reordenados(antes: NodoArbol[], ahora: NodoArbol[]): boolean {
  if (antes.length !== ahora.length) return false;
  const claves = ahora.map((hijo) => `${hijo.tipo}\u0000${hijo.nombre}`).sort();
  return antes.every((hijo, i) => `${hijo.tipo}\u0000${hijo.nombre}` === claves[i]);
}

/** Los niveles recién pedidos, comparados con los que ya se pintaban.
 *
 *  Cada nivel se mira por su cuenta y, si no cambió, se conserva el array
 *  anterior tal cual: el mapa no se serializa entero en cada latido y los
 *  niveles quietos no se repintan. `cambio` dice si hay algo nuevo que
 *  enseñar, para que el hook no toque el estado cuando no lo hay. */
export function mezclarNiveles(
  antes: Niveles,
  niveles: NivelArbol[],
): { hijos: Niveles; cambio: boolean } {
  const hijos: Niveles = {};
  let cambio = Object.keys(antes).length !== niveles.length;
  for (const nivel of niveles) {
    const ahora = nivel.hijos ?? [];
    const previos = antes[nivel.ruta];
    if (previos && (iguales(previos, ahora) || reordenados(previos, ahora))) {
      hijos[nivel.ruta] = previos;
    } else {
      hijos[nivel.ruta] = ahora;
      cambio = true;
    }
  }
  return { hijos, cambio };
}
