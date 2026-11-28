/** El lienzo emite selecciones desde sus zonas de golpe y marca lo elegido.
 *
 *  El e2e `inspector` pulsaba la fila, el cable y el nudo con el ratón en el
 *  navegador; la geometría ya está en `geometria.test.mjs` y aquí se comprueba
 *  el cableado de cada elemento: qué emite y qué clase lleva al estar elegido.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { createElement, createRef } = await import("react");
const { fireEvent, render } = await import("@testing-library/react");
const { VistaItems } = await import("../src/mapa/VistaItems.tsx");
const { buildTree } = await import("../src/mapa/arbol.ts");

const item = {
  uid: "i1",
  title: "Idea de inspector",
  description: "Descripción que vive en el panel.",
  status: "proposed",
  rejected_description: "",
};

const cable = {
  id: "etapa-cola",
  lane: "cola",
  origenLane: "root",
  destinoLane: "cola",
  uniones: [["draft", "proposed"]],
  presion: 1,
  puntos: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  d: "M 0 0 L 100 0",
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 0,
  nudo: "entrada-cola",
  compuerta: { x: 50, y: 0, angulo: 0 },
  chevron: { x: 50, y: 0, angulo: 0 },
  longitud: 100,
};
const nudo = { id: "entrada-cola", x: 50, y: 0, lado: 24 };

const acciones = {
  puedeIr: () => true,
  exigeFases: () => false,
  exigeFasesListas: () => false,
  exigeFasesCompletas: () => false,
  onMover: () => {},
  onEditar: () => Promise.resolve(),
  onBorrar: () => Promise.resolve(),
  onCargar: () => Promise.resolve(null),
  onPideEditar: () => {},
};

function montar(seleccion) {
  const selecciones = [];
  const util = render(
    createElement(VistaItems, {
      mapa: "items",
      tree: buildTree([item]),
      items: [item],
      commits: [],
      cerrados: new Set(),
      onToggle: () => {},
      refs: {
        cajon: createRef(),
        // Los carriles guardan por id en un mapa, como en `App`; un `createRef`
        // dejaría `current` en null y el ref de cada carril escribiría en null.
        carriles: { current: {} },
        git: createRef(),
        cambios: createRef(),
        commits: createRef(),
      },
      cables: [cable],
      nudos: [nudo],
      rama: null,
      chispas: [],
      cableDeChispa: () => undefined,
      seleccion,
      onSeleccionar: (elegida) => selecciones.push(elegida),
      paso: () => ({ abierta: true, exige: [] }),
      animacion: { volando: () => false, pulsos: [], destelloDe: () => undefined },
      acciones,
      proyeccion: { git: false },
      gitActivo: false,
      vuelos: [],
      onAterrizado: () => {},
      vuelosGit: [],
      onAterrizadoGit: () => {},
      onAbrirGit: () => {},
      onAbrirDocumentos: () => {},
      onDialogoGit: () => {},
    }),
  );
  return { selecciones, util };
}

test("la cabecera de la fila selecciona el ítem y la fila se marca", () => {
  const { selecciones, util } = montar({ tipo: "item", uid: "i1" });
  const fila = util.container.querySelector('.row[data-uid="i1"]');
  assert.ok(fila, "el ítem no está en el lienzo");
  assert.ok(fila.classList.contains("seleccionada"), "la fila elegida no se marca");

  fireEvent.click(fila.querySelector(".row-head"));
  assert.deepEqual(selecciones.at(-1), { tipo: "item", uid: "i1" });
  util.unmount();
});

test("la cabecera del carril lo selecciona y el nodo se marca", () => {
  const { selecciones, util } = montar({ tipo: "carril", clave: "lane-cola" });
  const carril = util.container.querySelector(".node.lane-cola");
  assert.ok(carril, "Backlog no está en el lienzo");
  assert.ok(carril.classList.contains("seleccionado"), "el carril elegido no se marca");

  fireEvent.click(carril.querySelector(".node-head"));
  assert.deepEqual(selecciones.at(-1), { tipo: "carril", clave: "lane-cola" });
  util.unmount();
});

test("la zona de golpe del cable lo selecciona y el trazo se marca", () => {
  const { selecciones, util } = montar({ tipo: "cable", id: "etapa-cola" });
  assert.equal(
    util.container.querySelectorAll(".wire.seleccionado").length,
    1,
    "el cable elegido no se marca",
  );

  const golpe = util.container.querySelector('.wire-hit[data-cable="etapa-cola"]');
  assert.ok(golpe, "el cable no tiene zona de golpe");
  fireEvent.click(golpe);
  assert.deepEqual(selecciones.at(-1), { tipo: "cable", id: "etapa-cola" });
  util.unmount();
});

test("la zona de golpe del nudo lo selecciona y el rombo se marca", () => {
  const { selecciones, util } = montar({ tipo: "nudo", id: "entrada-cola" });
  assert.equal(
    util.container.querySelectorAll(".nudo.seleccionado").length,
    1,
    "el nudo elegido no se marca",
  );

  const golpe = util.container.querySelector('.nudo-hit[data-nudo="entrada-cola"]');
  assert.ok(golpe, "el nudo no tiene zona de golpe");
  fireEvent.click(golpe);
  assert.deepEqual(selecciones.at(-1), { tipo: "nudo", id: "entrada-cola" });
  util.unmount();
});
