/** El modelo del lienzo no vive detrás del lienzo.
 *
 *  `pantalla/` importaba carriles, protocolos, selección, fase, fasesModelo y
 *  geometría desde `../mapa/…`. Ahora están en `src/modelo/` y esta guarda
 *  impide que vuelvan a `mapa/` o que alguien los importe desde allí fuera del
 *  propio lienzo.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const RAIZ = new URL("../src/", import.meta.url);
const MODELO = ["carriles", "protocolos", "seleccion", "fase", "fasesModelo", "geometria"];
const CODIGO = /\.tsx?$/;

test("el modelo vive en src/modelo y no queda copia en mapa", () => {
  for (const nombre of MODELO) {
    assert.doesNotThrow(
      () => readFileSync(new URL(`modelo/${nombre}.ts`, RAIZ)),
      `${nombre}.ts debería estar en src/modelo`,
    );
  }
  const enMapa = readdirSync(new URL("mapa/", RAIZ))
    .filter((archivo) => CODIGO.test(archivo))
    .map((archivo) => archivo.replace(CODIGO, ""))
    .filter((nombre) => MODELO.includes(nombre));
  assert.deepEqual(enMapa, [], "el modelo no puede volver a mapa/");
});

test("nadie fuera del lienzo importa el modelo desde ../mapa", () => {
  const sobran = [];
  for (const carpeta of ["", "pantalla/", "core/"]) {
    for (const archivo of readdirSync(new URL(carpeta, RAIZ)).filter((f) => CODIGO.test(f))) {
      const texto = readFileSync(new URL(carpeta + archivo, RAIZ), "utf8");
      for (const nombre of MODELO) {
        if (texto.includes(`mapa/${nombre}"`)) sobran.push(`${carpeta}${archivo} → ${nombre}`);
      }
    }
  }
  assert.deepEqual(sobran, [], "importa desde src/modelo");
});
