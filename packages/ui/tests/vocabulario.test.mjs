// La UI habla de ítems; «idea» solo sobrevive en la lectura de eventos que ya
// estaban escritos antes de la 0034. Esta prueba impide que vuelva el nombre
// viejo a los identificadores o al copy, sin tocar esa compatibilidad.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
// Ficheros con `idea` a propósito: el cliente generado y el lector del log
// histórico. No son vocabulario vivo de la pantalla.
const LEGADO = new Set(["core/schema.ts", "core/useEmpujeMapa.ts", "core/useEventos.ts"]);
const IDENTIFICADOR = /\b(ideas|idea|[A-Za-z]*Idea[A-Za-z]*)\b/;
const COPY = /\b(nueva|editar|descartar)\s+idea\b/i;

function fuentes(directorio) {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(entrada.name) ? [ruta] : [];
  });
}

test("la UI llama ítem a la ficha, no idea", () => {
  const fallos = [];
  for (const archivo of fuentes(SRC)) {
    const rel = path.relative(SRC, archivo).split(path.sep).join("/");
    if (LEGADO.has(rel)) continue;
    readFileSync(archivo, "utf8")
      .split(/\r?\n/)
      .forEach((linea, indice) => {
        if (IDENTIFICADOR.test(linea) || COPY.test(linea)) {
          fallos.push(`${rel}:${indice + 1}: ${linea.trim()}`);
        }
      });
  }
  assert.deepEqual(fallos, [], `Queda vocabulario viejo:\n${fallos.join("\n")}`);
});

test("el lector conserva los eventos idea.* que ya estaban escritos", () => {
  const empuje = readFileSync(path.join(SRC, "core", "useEmpujeMapa.ts"), "utf8");
  for (const tipo of ["idea.created", "idea.deleted", "idea.status"]) {
    assert.ok(empuje.includes(`"${tipo}"`), `falta el evento histórico ${tipo}`);
  }
  const eventos = readFileSync(path.join(SRC, "core", "useEventos.ts"), "utf8");
  assert.ok(eventos.includes("`idea.${tipo}`"), "falta el alias de lectura idea.*");
});
