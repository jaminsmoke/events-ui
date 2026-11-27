// El marco de los diálogos, en jsdom: Escape cierra, el fondo cierra y el clic
// dentro no, y al desmontar el foco vuelve a donde estaba. `tsx` registra el
// cargador para importar el .tsx con su JSX sin compilar el paquete entero.
import assert from "node:assert/strict";
import { test } from "node:test";

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

const { createElement } = await import("react");
const { fireEvent, render, screen } = await import("@testing-library/react");
const { Modal } = await import("../src/pantalla/Modal.tsx");

/** Monta el diálogo con un botón dentro y apunta si se cerró. */
function montar() {
  const veces = { cerrar: 0 };
  const util = render(
    createElement(
      Modal,
      { etiqueta: "Diálogo de prueba", onCerrar: () => veces.cerrar++ },
      createElement("button", { type: "button" }, "Aceptar"),
    ),
  );
  return { ...veces, util, cerrar: () => veces.cerrar };
}

test("Escape cierra el diálogo", () => {
  const { cerrar, util } = montar();
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(cerrar(), 1);
  util.unmount();
});

test("el clic en el fondo cierra y el de dentro no", () => {
  const { cerrar, util } = montar();
  const dialogo = screen.getByRole("dialog", { name: "Diálogo de prueba" });
  fireEvent.click(dialogo);
  assert.equal(cerrar(), 0);
  fireEvent.click(dialogo.parentElement);
  assert.equal(cerrar(), 1);
  util.unmount();
});

test("al desmontar, el foco vuelve a donde estaba", () => {
  const previo = document.createElement("button");
  previo.textContent = "Abrir";
  document.body.append(previo);
  previo.focus();
  const { util } = montar();
  const dialogo = screen.getByRole("dialog", { name: "Diálogo de prueba" });
  assert.equal(document.activeElement, dialogo, "el foco entra al diálogo");
  util.unmount();
  assert.equal(document.activeElement, previo, "el foco vuelve al botón que abrió");
  previo.remove();
});
