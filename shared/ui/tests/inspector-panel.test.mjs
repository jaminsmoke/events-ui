/** Las fichas del Inspector, montadas con datos falsos.
 *
 *  Antes esto era el escenario e2e `inspector`: creaba un ítem por la API y
 *  recorría el lienzo pulsando filas, cables y nudos para leer el panel. Lo que
 *  cambia con la selección es el panel, así que aquí se le dan las selecciones
 *  y los datos ya resueltos; el lienzo y su cableado tienen su propia prueba.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { createElement } = await import("react");
const { fireEvent, render } = await import("@testing-library/react");
const { PanelDerecho } = await import("../src/pantalla/PanelDerecho.tsx");

/** Dos ítems: el seleccionado, con fases y una dependencia ya en el mapa. */
const item = {
  uid: "i1",
  title: "Idea de inspector",
  description: "Descripción que vive en el panel.",
  status: "proposed",
  rejected_description: "",
  depende_de: ["i0"],
  fases: [
    { orden: 1, titulo: "Diálogo", estado: "completada", nota: "", entered_at: "2026-01-01" },
    { orden: 2, titulo: "Cierre", estado: "pendiente", nota: "", entered_at: "2026-01-02" },
  ],
};
const previo = {
  uid: "i0",
  title: "Antes del inspector",
  description: "",
  status: "roadmap",
  rejected_description: "",
};
const items = [item, previo];

/** El cable Entrada→Backlog y el nudo del que sale, ya medidos. */
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

function montar(seleccion, extra = {}) {
  const selecciones = [];
  const util = render(
    createElement(PanelDerecho, {
      vista: "inspector",
      onVista: () => {},
      repo: "lab",
      archivoAbierto: null,
      proyeccion: null,
      onIgnorarAlmacen: () => Promise.resolve(),
      commits: [],
      seleccion,
      items,
      cables: [cable],
      nudos: [nudo],
      paso: () => ({ abierta: true, exige: [] }),
      puertas: [],
      falloPuertas: null,
      acciones: {
        onMover: () => {},
        onEditar: () => Promise.resolve(),
        onBorrar: () => Promise.resolve(),
        onPideEditar: () => {},
      },
      onSeleccionar: (elegida) => selecciones.push(elegida),
      onAbrirArchivo: () => {},
      conectado: true,
      onClose: () => {},
      ...extra,
    }),
  );
  return { selecciones, util };
}

const texto = (util) => util.container.textContent ?? "";

test("sin selección el Inspector explica cómo empezar", () => {
  const { util } = montar(null);
  assert.match(texto(util), /Nada seleccionado/);
  util.unmount();
});

test("la ficha del ítem trae descripción, fases, dependencias y acciones", () => {
  const { util } = montar({ tipo: "item", uid: "i1" });
  const ficha = texto(util);
  assert.match(ficha, /Idea de inspector/);
  assert.match(ficha, /Descripción que vive en el panel\./);
  assert.match(ficha, /1 de 2 completadas/, "no resume las fases");
  assert.match(ficha, /Dependencias/);
  assert.match(ficha, /Antes del inspector/, "no resuelve el título de la dependencia");
  assert.match(ficha, /Acciones/);
  assert.match(ficha, /Ninguna puerta activa\./);
  util.unmount();
});

test("la ficha del carril lista sus ítems y sus salidas, y elegir uno lo selecciona", () => {
  const { selecciones, util } = montar({ tipo: "carril", clave: "lane-cola" });
  const ficha = texto(util);
  assert.match(ficha, /Backlog/, "no nombra el carril");
  assert.match(ficha, /Salidas del protocolo/);
  assert.match(ficha, /→ Roadmap/, "no enseña la salida a Roadmap");
  assert.match(ficha, /paso libre/, "no explica la compuerta de la salida");
  assert.match(ficha, /Idea de inspector/, "no lista los ítems del carril");

  const boton = util.container.querySelector(".inspector-item");
  assert.ok(boton, "la ficha no ofrece el ítem");
  fireEvent.click(boton);
  assert.deepEqual(selecciones.at(-1), { tipo: "item", uid: "i1" });
  util.unmount();
});

test("la ficha del cable explica su compuerta", () => {
  const { util } = montar({ tipo: "cable", id: "etapa-cola" });
  const ficha = texto(util);
  assert.match(ficha, /Cable a Backlog/);
  assert.match(ficha, /Compuerta/);
  assert.match(ficha, /Entrada → Backlog/);
  assert.match(ficha, /paso libre/);
  util.unmount();
});

test("la ficha del nudo reúne las compuertas que salen de él", () => {
  const { util } = montar({ tipo: "nudo", id: "entrada-cola" });
  const ficha = texto(util);
  assert.match(ficha, /Nudo del flujo/);
  assert.match(ficha, /1 compuerta/);
  assert.match(ficha, /Entrada → Backlog/);
  assert.match(ficha, /paso libre/);
  util.unmount();
});

test("el puente sin work tree dice por qué está apagado", () => {
  const { util } = montar(
    { tipo: "puente" },
    { proyeccion: { git: false, branch: null, commit: null, git_root: null } },
  );
  const ficha = texto(util);
  assert.match(ficha, /Entregar a Git/);
  assert.match(ficha, /apagado/);
  assert.match(ficha, /Sin repositorio local/);
  util.unmount();
});
