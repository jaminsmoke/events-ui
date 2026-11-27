/** Marca de la prueba manual que está corriendo en la ventana.
 *
 *  La ejecución vive en React: si el proceso termina (cierre, crash) antes de
 *  pedir el reinicio, el laboratorio se queda con las ideas y los eventos de la
 *  prueba. La marca deja constancia en `localStorage` con un latido; al reabrir
 *  el mismo laboratorio, una marca sin latido reciente se cobra vaciándolo y
 *  una con latido reciente se respeta: hay otra ejecución viva y no es nuestra.
 *
 *  No sustituye al reinicio: es el recordatorio de que quedó pendiente. */

/** Un latido más viejo que esto es una ejecución muerta. El latido se escribe
 *  cada pocos segundos mientras la prueba corre, así que hay margen de sobra. */
const VIGENTE_MS = 12_000;

export type Marca = { ejecucion: string; prueba: string; latido: number };

const clave = (repo: string) => `eui.prueba:${repo}`;

function escribir(repo: string, marca: Marca): void {
  try {
    localStorage.setItem(clave(repo), JSON.stringify(marca));
  } catch {
    // Sin storage no hay recuperación posible; la prueba sigue igual.
  }
}

export function marcaDe(repo: string): Marca | null {
  try {
    const crudo = localStorage.getItem(clave(repo));
    if (!crudo) return null;
    const dato: unknown = JSON.parse(crudo);
    if (
      typeof dato !== "object" ||
      dato === null ||
      !("ejecucion" in dato) ||
      typeof dato.ejecucion !== "string" ||
      !("prueba" in dato) ||
      typeof dato.prueba !== "string" ||
      !("latido" in dato) ||
      typeof dato.latido !== "number"
    ) {
      return null;
    }
    return { ejecucion: dato.ejecucion, prueba: dato.prueba, latido: dato.latido };
  } catch {
    return null;
  }
}

export type EstadoMarca = "vigente" | "pendiente" | "ninguna";

/** Decide qué es una marca sin tocar el almacén: latido fresco = otra
 *  ejecución viva; latido viejo = una prueba que murió sin limpiar. */
export function estadoDeMarca(marca: Marca | null, ahora: number): EstadoMarca {
  if (!marca) return "ninguna";
  return ahora - marca.latido < VIGENTE_MS ? "vigente" : "pendiente";
}

/** Otra ejecución está viva ahora mismo en este laboratorio. */
export function pruebaVigente(repo: string): Marca | null {
  const marca = marcaDe(repo);
  return estadoDeMarca(marca, Date.now()) === "vigente" ? marca : null;
}

/** La prueba murió sin limpiar: queda una marca sin latido reciente. */
export function pruebaPendiente(repo: string): Marca | null {
  const marca = marcaDe(repo);
  return estadoDeMarca(marca, Date.now()) === "pendiente" ? marca : null;
}

/** Reclama el laboratorio para una ejecución: gana la última y las demás ven
 *  el latido fresco. */
export function tomar(repo: string, prueba: string): Marca {
  const marca = { ejecucion: crypto.randomUUID(), prueba, latido: Date.now() };
  escribir(repo, marca);
  return marca;
}

export function latir(repo: string, ejecucion: string): void {
  const marca = marcaDe(repo);
  if (!marca || marca.ejecucion !== ejecucion) return;
  escribir(repo, { ...marca, latido: Date.now() });
}

/** Suelta la marca, solo si sigue siendo de esta ejecución. */
export function soltar(repo: string, ejecucion: string): void {
  const marca = marcaDe(repo);
  if (!marca || marca.ejecucion !== ejecucion) return;
  try {
    localStorage.removeItem(clave(repo));
  } catch {
    // Sin storage no quedaba nada que soltar.
  }
}
