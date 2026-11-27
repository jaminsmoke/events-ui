/** Guardar la carpeta en el core se reintenta si el core no contesta.
 *
 *  Antes se marcaba como persistida antes del PUT: con el core caído nunca se
 *  reintentaba y el CLI y el MCP se quedaban con la raíz anterior. La cuenta
 *  vive en `persistirRepo`, con el reloj inyectado para poder medirla.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { persistirRepo } from "../src/core/persistir.ts";

const reposar = () => new Promise((listo) => setTimeout(listo, 0));

test("un PUT fallido se reintenta hasta que el core contesta", async () => {
  const programados = [];
  let llamadas = 0;
  const put = () => {
    llamadas += 1;
    return llamadas === 1 ? Promise.reject(new Error("core caído")) : Promise.resolve();
  };
  let guardado = 0;

  const parar = persistirRepo("C:/repo", put, {
    espera: 5_000,
    alGuardar: () => {
      guardado += 1;
    },
    programar: (fn, ms) => {
      programados.push({ fn, ms });
      return programados.length;
    },
    cancelar: () => {},
  });

  await reposar();
  assert.equal(llamadas, 1, "no intentó guardar al empezar");
  assert.equal(programados.length, 1, "no programó el reintento");
  assert.equal(programados[0].ms, 5_000, "el reintento no espera lo acordado");
  assert.equal(guardado, 0, "dio por guardado un PUT que falló");

  programados[0].fn();
  await reposar();
  assert.equal(llamadas, 2, "el reintento no volvió a pedir el PUT");
  assert.equal(guardado, 1, "no avisó del guardado bueno");
  assert.equal(programados.length, 1, "vuelve a reintentar tras un guardado bueno");

  parar();
});

test("parar corta el reintento pendiente", async () => {
  const programados = [];
  let llamadas = 0;
  const parar = persistirRepo(
    "C:/repo",
    () => {
      llamadas += 1;
      return Promise.reject(new Error("core caído"));
    },
    {
      programar: (fn) => {
        programados.push(fn);
        return programados.length;
      },
      cancelar: () => {},
    },
  );
  await reposar();
  parar();
  programados[0]();
  await reposar();
  assert.equal(llamadas, 1, "siguió reintentando después de parar");
});

test("App da la carpeta por guardada solo cuando el core contesta", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const envio = app.indexOf("persistirRepo(repo");
  const marca = app.indexOf("persistido.current = repo");
  assert.ok(envio >= 0, "App no usa el guardado con reintento");
  assert.ok(marca > envio, "App marca la carpeta antes de mandarla al core");
  assert.match(app, /alGuardar: \(\) => \{/, "App no espera la confirmación del core");
});
