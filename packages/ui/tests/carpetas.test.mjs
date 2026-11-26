/** La ruta que se pide a `/fs` al bajar a una subcarpeta.
 *
 *  El separador lo manda la base: no se mezcla `C:\repo` con `/sub`. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { unirRuta } from "../src/core/repo.ts";

test("unirRuta conserva las barras normales", () => {
  assert.equal(unirRuta("/home/ana", "repo"), "/home/ana/repo");
  assert.equal(unirRuta("/home/ana/", "repo"), "/home/ana/repo");
});

test("unirRuta usa la barra invertida si la base es de Windows", () => {
  assert.equal(unirRuta("C:\\Users\\ana", "repo"), "C:\\Users\\ana\\repo");
  assert.equal(unirRuta("C:\\Users\\ana\\", "repo"), "C:\\Users\\ana\\repo");
});

test("unirRuta acepta una base con barras normales de Windows", () => {
  assert.equal(unirRuta("C:/Users/ana/", "repo"), "C:/Users/ana/repo");
});
