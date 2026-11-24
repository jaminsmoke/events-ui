// Lo que el paquete sabe de la política, sin lógica propia: el esquema y los
// presets son datos, y quien aplica las reglas es el core (`eui guard`). Si el
// paquete reimplementara las guardas habría dos verdades y una se quedaría atrás.

import { readFileSync } from "node:fs";

const leer = (nombre) =>
  JSON.parse(readFileSync(new URL(nombre, import.meta.url), "utf8"));

/** La política de partida: las puertas de la v1, todas puestas. */
export const protocolos = leer("./protocolos.json");

/** El JSON Schema de `.EUI/protocolos.json`. */
export const esquema = leer("./schema.json");

/** Los identificadores de las puertas que este paquete conoce. */
export const PUERTAS = protocolos.puertas.map((puerta) => puerta.id);

/** Dónde se copia la política dentro del repo. */
export const ARCHIVO = ".EUI/protocolos.json";
