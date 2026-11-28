/** El clic en el fondo del diálogo: cierra; el de dentro, no.
 *
 *  El resto del marco —foco inicial, ciclo de Tab, Escape y vuelta del foco—
 *  se prueba en `modales-teclado.test.mjs` sobre `Ajustes` y `EditorItem`, que
 *  usan el mismo `Modal`. Aquí queda lo único que esos dos no cubren, con el
 *  entorno compartido (`entorno-dom.mjs`) en vez de montar jsdom otra vez.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { createElement } = await import("react");
const { fireEvent, render, screen } = await import("@testing-library/react");
const { Modal } = await import("../src/pantalla/Modal.tsx");

test("el clic en el fondo cierra y el de dentro no", () => {
  let cerrado = 0;
  const util = render(
    createElement(
      Modal,
      { etiqueta: "Diálogo de prueba", onCerrar: () => cerrado++ },
      createElement("button", { type: "button" }, "Aceptar"),
    ),
  );
  const dialogo = screen.getByRole("dialog", { name: "Diálogo de prueba" });

  fireEvent.click(dialogo);
  assert.equal(cerrado, 0, "el clic dentro no debe cerrar");

  fireEvent.click(dialogo.parentElement);
  assert.equal(cerrado, 1, "el clic en el fondo cierra");

  util.unmount();
});
