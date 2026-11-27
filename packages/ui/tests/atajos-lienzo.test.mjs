/** Los atajos del lienzo conectados de verdad: flechas, Enter y Escape.
 *
 *  `siguienteIndice` ya tiene sus casos puros en `atajos.test.mjs`; aquí se
 *  monta el hook con estado real para ver que las flechas recorren las
 *  paradas, Enter abre el Inspector de lo marcado y Escape suelta y cierra.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { useState } = await import("react");
const { act, renderHook } = await import("@testing-library/react");
const { useAtajosLienzo } = await import("../src/mapa/atajos.ts");

const paradas = [
  { tipo: "cajon" },
  { tipo: "carril", clave: "lane-cola" },
  { tipo: "item", uid: "i1" },
];

function montar({ gitActivo = false } = {}) {
  const visto = { irGit: 0, irDocumentos: 0 };
  const util = renderHook(() => {
    const [seleccion, setSeleccion] = useState(null);
    const [vistaDerecha, setVistaDerecha] = useState(null);
    useAtajosLienzo({
      paradas,
      seleccion,
      setSeleccion,
      panel: null,
      setPanel: () => {},
      vistaDerecha,
      setVistaDerecha,
      archivoAbierto: null,
      setArchivoAbierto: () => {},
      ventanaEstrecha: false,
      setPane: () => {},
      gitActivo,
      irGit: () => visto.irGit++,
      irDocumentos: () => visto.irDocumentos++,
    });
    return { seleccion, vistaDerecha };
  });
  return { ...util, visto };
}

/** Una tecla de verdad en `document`, como la manda el navegador. */
const tecla = (key) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

test("dos flechas llevan al carril Backlog y Enter abre el Inspector", () => {
  const { result, unmount, visto } = montar();
  tecla("ArrowRight");
  assert.deepEqual(result.current.seleccion, { tipo: "cajon" }, "la primera flecha entra");
  tecla("ArrowRight");
  assert.deepEqual(result.current.seleccion, { tipo: "carril", clave: "lane-cola" });

  tecla("Enter");
  assert.equal(result.current.vistaDerecha, "inspector", "Enter no abrió el Inspector");
  assert.equal(visto.irGit, 0, "un carril no debe abrir Git");
  unmount();
});

test("la flecha izquierda vuelve a la parada anterior", () => {
  const { result, unmount } = montar();
  tecla("ArrowRight");
  tecla("ArrowRight");
  tecla("ArrowLeft");
  assert.deepEqual(result.current.seleccion, { tipo: "cajon" });
  unmount();
});

test("Escape suelta la selección y el siguiente cierra el panel", () => {
  const { result, unmount } = montar();
  tecla("ArrowRight");
  tecla("Enter");
  assert.equal(result.current.vistaDerecha, "inspector");

  tecla("Escape");
  assert.equal(result.current.seleccion, null, "Escape no soltó la selección");
  assert.equal(result.current.vistaDerecha, "inspector", "Escape cerró el panel de más");

  tecla("Escape");
  assert.equal(result.current.vistaDerecha, null, "el segundo Escape no cerró el panel");
  unmount();
});

test("los atajos no se disparan detrás de un diálogo", () => {
  const dialogo = document.createElement("div");
  dialogo.setAttribute("role", "dialog");
  document.body.append(dialogo);
  const { result, unmount } = montar();

  tecla("ArrowRight");
  assert.equal(result.current.seleccion, null, "la flecha movió el lienzo tras el diálogo");

  dialogo.remove();
  unmount();
});
