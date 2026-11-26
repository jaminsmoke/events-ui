/** Las lecturas que pertenecen a un repo no deben sobrevivir al cambio.
 *
 *  Estas pruebas miran la frontera: aborto en los visores, persistencia en la
 *  selección y borrado que comprueba el repo tras la espera.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8");

test("las lecturas de archivo se abortan al cambiar", async () => {
  for (const ruta of [
    "src/core/useImagen.ts",
    "src/core/useArchivo.ts",
  ]) {
    const fuente = await leer(ruta);
    assert.match(fuente, /AbortController/, `${ruta} no crea un aborto`);
    assert.match(fuente, /\.abort\(\)/, `${ruta} no aborta al desmontar`);
  }
});

test("la persistencia del repo vive en la selección, no en useItems", async () => {
  const items = await leer("src/core/useItems.ts");
  const app = await leer("src/App.tsx");
  assert.doesNotMatch(items, /localStorage|PUT\("\/config"/, "useItems sigue persistiendo");
  assert.match(app, /localStorage\.setItem/, "la selección no recuerda el repo");
  assert.match(app, /PUT\("\/config"/, "la selección no comparte el repo con el core");
});

test("el borrado comprueba el repo después de la espera", async () => {
  const app = await leer("src/App.tsx");
  assert.match(app, /repoAlBorrar/, "el borrado no captura el repo");
  assert.match(app, /repoRef\.current/, "el borrado no comprueba el repo actual");
});
