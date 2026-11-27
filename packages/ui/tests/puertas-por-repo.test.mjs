/** Las puertas del repo se leen una vez, no cada vez que se abre el panel.
 *
 *  `usePuertas` vive en `PanelDerecho`: cerrar y reabrir el panel vuelve a
 *  pedir `/puertas` aunque el repo no haya cambiado. El dato es del repo, así
 *  que la lectura sube a `App` y el panel la recibe por props.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8");

test("las puertas se piden en App y el panel solo las recibe", async () => {
  const app = await leer("src/App.tsx");
  const panel = await leer("src/pantalla/PanelDerecho.tsx");
  assert.match(app, /usePuertas\(repo\)/, "App no pide las puertas del repo");
  assert.doesNotMatch(
    panel,
    /usePuertas/,
    "el panel vuelve a pedir /puertas cada vez que se monta",
  );
});
