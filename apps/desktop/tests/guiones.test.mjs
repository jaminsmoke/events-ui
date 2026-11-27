// Los guiones del laboratorio comparten `item`, `fase` y `exigirUid`: se
// prueban directamente y se construyen y ejecutan todos contra una API falsa,
// sin navegador. `guiones.ts` solo importa tipos, así que Node lo carga con su
// type stripping: lo que se prueba son los constructores, no la pantalla.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PRUEBAS, exigirUid, fase, item } from "../src/guiones.ts";

/** Una API de mentira que apunta lo que pide cada paso. */
function apiFalsa() {
  const llamadas = [];
  let n = 0;
  return {
    llamadas,
    crear: async (body) => {
      const uid = `uid-${++n}`;
      llamadas.push({ tipo: "crear", uid, body });
      return { uid };
    },
    mover: async (uid, status) => {
      llamadas.push({ tipo: "mover", uid, status });
    },
    editar: async (uid, cambios) => {
      llamadas.push({ tipo: "editar", uid, cambios });
    },
    commit: async (mensaje) => {
      llamadas.push({ tipo: "commit", mensaje });
    },
    // `commit-panel` se salta el paso si no hay cambios que commitear.
    cambios: 1,
    abrirMapa: (mapa) => {
      llamadas.push({ tipo: "abrirMapa", mapa });
    },
  };
}

test("fase() arma la fase y numera los requisitos", () => {
  const armada = fase(2, "Prueba", "completada", [["Uno", true], ["Dos", false]], "nota");
  assert.equal(armada.orden, 2);
  assert.equal(armada.estado, "completada");
  assert.equal(armada.nota, "nota");
  assert.equal(armada.requisitos.length, 2);
  assert.equal(armada.requisitos[1].orden, 2);
  assert.equal(armada.requisitos[1].hecho, false);
});

test("exigirUid avisa sin uid y lo devuelve cuando está", () => {
  let uid = null;
  const uidExigido = exigirUid(() => uid);
  assert.throws(uidExigido, /Falta el uid del ítem creado\./);
  uid = "abc";
  assert.equal(uidExigido(), "abc");
});

test("item() recuerda el uid y avisa si el core no devuelve el ítem", async () => {
  const creado = item(async () => ({ uid: "xyz" }));
  await creado.crear({ title: "T" });
  assert.equal(creado.uid(), "xyz");

  const sinIdea = item(async () => null);
  await assert.rejects(sinIdea.crear({ title: "T" }), /El core no devolvió el ítem creado\./);
});

test("los nueve guiones se construyen y corren con pasos y fases bien formadas", async () => {
  const ids = new Set();
  const fasesEnviadas = [];
  for (const prueba of PRUEBAS) {
    assert.ok(!ids.has(prueba.id), `id de prueba repetido: ${prueba.id}`);
    ids.add(prueba.id);
    const api = apiFalsa();
    const pasos = prueba.construir(api);
    assert.ok(pasos.length > 0, `«${prueba.id}» no tiene pasos`);
    const textos = new Set();
    for (const paso of pasos) {
      assert.notEqual(paso.texto.trim(), "", `«${prueba.id}» tiene un paso sin texto`);
      assert.ok(!textos.has(paso.texto), `«${prueba.id}» repite el texto «${paso.texto}»`);
      textos.add(paso.texto);
      // Los pasos de «mirar» solo duermen para que el ojo vea el estado.
      if (!paso.texto.startsWith("Mirar")) await paso.ejecutar();
    }
    for (const llamada of api.llamadas) {
      if (llamada.tipo === "editar" && llamada.cambios.fases) {
        fasesEnviadas.push(...llamada.cambios.fases);
      }
    }
  }
  assert.equal(ids.size, 9, `se esperaban 9 guiones y hay ${ids.size}`);
  assert.ok(fasesEnviadas.length > 0, "ningún guion envió fases");
  for (const enviada of fasesEnviadas) {
    assert.notEqual(enviada.titulo, "", "una fase sin título");
    assert.ok(
      Array.isArray(enviada.requisitos) && enviada.requisitos.length > 0,
      `la fase «${enviada.titulo}» sin requisitos`,
    );
    for (const requisito of enviada.requisitos) {
      assert.ok(
        requisito.orden >= 1 && requisito.titulo !== "" && typeof requisito.hecho === "boolean",
        `requisito mal formado en «${enviada.titulo}»`,
      );
    }
  }
});
