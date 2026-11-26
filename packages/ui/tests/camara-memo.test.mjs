/** La cámara mueve `vista` en cada `pointermove`; el mapa no debe re-renderizarse.
 *
 *  `Lienzo` va memoizado y `App` le pasa acciones y animación estables, para
 *  que el arrastre solo cambie el `transform` del contenedor.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8");

test("el lienzo no se repinta al mover la cámara", async () => {
  const lienzo = await leer("src/mapa/Lienzo.tsx");
  const app = await leer("src/App.tsx");
  assert.match(lienzo, /memo\(/, "Lienzo no está memoizado");
  assert.match(app, /const acciones = useMemo/, "acciones se recrea en cada render");
  assert.match(app, /const animacion = useMemo/, "animacion se recrea en cada render");
});
