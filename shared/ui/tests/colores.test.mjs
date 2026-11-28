/** Los colores de estado se declaran una vez, en `base.css`.
 *
 *  Ocho literales estaban repetidos por las hojas (`#3fb950` diez veces,
 *  `#7ee2a8` siete…): cambiar el verde de «hecho» obligaba a tocar seis
 *  ficheros. Ahora cada hoja usa su variable y esto lo vigila.
 *
 *  Las variantes con alfa (`#3fb95033`) sí siguen literales: un hex con
 *  transparencia no se puede escribir con un `var()`.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const ESTILOS = new URL("../src/styles/", import.meta.url);
const LITERALES = [
  "#3fb950", // --ok
  "#7ee2a8", // --ok-texto
  "#2b5c3f", // --ok-borde
  "#122719", // --ok-fondo
  "#33465e", // --borde-tenue
  "#d29922", // --warn
  "#f85149", // --bad
  "#58a6ff", // --accent
];

const base = readFileSync(new URL("base.css", ESTILOS), "utf8");
const hojas = readdirSync(ESTILOS).filter((nombre) => nombre.endsWith(".css"));

test("cada color de estado se declara en :root", () => {
  for (const literal of LITERALES) {
    assert.match(base, new RegExp(`${literal};`, "i"), `falta ${literal} en base.css`);
  }
});

test("ninguna otra hoja repite el literal de seis cifras", () => {
  const sobran = [];
  for (const hoja of hojas.filter((nombre) => nombre !== "base.css")) {
    const texto = readFileSync(new URL(hoja, ESTILOS), "utf8").toLowerCase();
    for (const literal of LITERALES) {
      const veces = texto.match(new RegExp(literal + "(?![0-9a-f])", "g"))?.length ?? 0;
      if (veces > 0) sobran.push(`${hoja}: ${literal} ×${veces}`);
    }
  }
  assert.deepEqual(sobran, [], "usa la variable en vez del literal");
});
