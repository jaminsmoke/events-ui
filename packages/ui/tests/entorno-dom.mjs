/** El entorno jsdom que comparten las pruebas de componente.
 *
 *  Node no trae DOM: aquí se monta uno, se expone en `globalThis` y se registra
 *  `tsx` para poder importar los `.tsx` con su JSX sin compilar el paquete.
 *  Este fichero no es un `.test.mjs` a propósito: `node --test` solo corre los
 *  que terminan en `.test.mjs` y este se importa desde ellos.
 */
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

// Sin el tsconfig del paquete, `tsx` compila el JSX en modo clásico y pide un
// `React` global. La ruta va relativa a este fichero.
process.env.TSX_TSCONFIG_PATH = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
register();

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const clave of [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "KeyboardEvent",
  "MouseEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  globalThis[clave] = dom.window[clave];
}
// `navigator` es de solo lectura en Node: se define, no se asigna.
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
// React 19 avisa (y pierde act) si el entorno no se declara.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom no maqueta: `getClientRects` devuelve vacío y el `Modal` creería que
// no hay ningún enfocable dentro del diálogo. Un rectángulo para todo deja
// probar el foco inicial y el ciclo de Tab como en el navegador.
const RECT = {
  width: 10,
  height: 10,
  top: 0,
  left: 0,
  right: 10,
  bottom: 10,
  x: 0,
  y: 0,
  toJSON() {
    return { ...this };
  },
};
dom.window.Element.prototype.getClientRects = function () {
  return [RECT];
};

export { dom };
