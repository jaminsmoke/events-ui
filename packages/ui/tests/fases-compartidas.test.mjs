/** La fila y la ficha comparten la lista de fases.
 *
 *  Dos editores separados ya divergieron una vez (la ficha no cerraba fases
 *  igual que la fila). `FasesLista` es la única UI; la ficha solo aporta el
 *  marco y los archivos.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8");

test("fila y ficha comparten la lista de fases", async () => {
  const fases = await leer("src/mapa/fases.tsx");
  const ficha = await leer("src/mapa/ficha-fases.tsx");
  assert.match(fases, /export function FasesLista/, "falta FasesLista");
  assert.match(ficha, /FasesLista/, "la ficha no usa FasesLista");
  assert.doesNotMatch(
    ficha,
    /<ol className="ficha-fases">/,
    "la ficha sigue pintando su propia lista",
  );
});
