/** La copia optimista de fases de la fila.
 *
 *  Antes esto era el escenario e2e `copia-optimista-fases`: retenía el PATCH
 *  con `route` para que la relectura del mapa llegara con la escritura en
 *  vuelo. La ventana se puede reproducir sin navegador: el padre repinta la
 *  fila con arrays nuevos del mismo contenido mientras el guardado sigue
 *  pendiente. La fila decide con `mismasFases`, y eso es lo que se prueba.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { createElement } = await import("react");
const { act, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { NodeRow } = await import("../src/mapa/fila.tsx");

/** El ítem en roadmap: una fase con un requisito sin marcar. */
function item({ hecho = false, tituloFase = "Única" } = {}) {
  return {
    uid: "i1",
    title: "Copia optimista",
    description: "",
    status: "roadmap",
    rejected_description: "",
    fases: [
      {
        orden: 1,
        titulo: tituloFase,
        estado: "pendiente",
        nota: "",
        entered_at: "2026-01-01T00:00:00Z",
        requisitos: [{ orden: 1, titulo: "Comprobar", hecho }],
      },
    ],
  };
}

/** Un guardado que se queda en vuelo hasta que la prueba lo suelta. */
function montar(onEditar) {
  const guardados = [];
  const props = (datos) => ({
    node: { key: datos.uid, title: datos.title, total: 0, kids: [], item: datos },
    nodo: "items",
    volando: () => false,
    catalogo: [],
    onEditar: (uid, cambios) => {
      guardados.push(cambios);
      return onEditar(uid, cambios);
    },
  });
  const util = render(createElement(NodeRow, props(item())));
  return { guardados, util, props };
}

/** Abre los controles y devuelve la casilla del requisito. */
function editar() {
  fireEvent.click(screen.getByRole("button", { name: "Editar" }));
  return screen.getByRole("checkbox", { name: "Requisito Comprobar" });
}

test("la casilla se marca al instante y una relectura con el mismo contenido no la suelta", async () => {
  let soltar;
  const enVuelo = new Promise((resolver) => {
    soltar = resolver;
  });
  const { guardados, util, props } = montar(() => enVuelo);
  const casilla = editar();

  fireEvent.click(casilla);
  assert.equal(casilla.checked, true, "la casilla no se marcó al instante");
  assert.equal(guardados.length, 1, "el PATCH no salió");
  assert.equal(
    guardados[0].fases[0].requisitos[0].hecho,
    true,
    "el PATCH no lleva el requisito marcado",
  );
  assert.ok(!("entered_at" in guardados[0].fases[0]), "el PATCH no debe llevar entered_at");

  // El SSE relee el mapa: mismos datos en objetos y arrays nuevos.
  const releido = JSON.parse(JSON.stringify(item()));
  util.rerender(createElement(NodeRow, props(releido)));
  assert.equal(
    screen.getByRole("checkbox", { name: "Requisito Comprobar" }).checked,
    true,
    "la relectura del mapa desmarcó la casilla",
  );

  await act(async () => {
    soltar();
    await enVuelo;
  });
  await waitFor(() =>
    assert.equal(screen.getByRole("checkbox", { name: "Requisito Comprobar" }).checked, true),
  );
  // El core confirma: el mapa ya trae el requisito marcado y no hay salto.
  util.rerender(createElement(NodeRow, props(item({ hecho: true }))));
  assert.equal(
    screen.getByRole("checkbox", { name: "Requisito Comprobar" }).checked,
    true,
    "la confirmación del core desmarcó la casilla",
  );
  util.unmount();
});

test("si otro cliente cambia las fases, manda el mapa", () => {
  const { util, props } = montar(() => new Promise(() => {}));
  const casilla = editar();
  fireEvent.click(casilla);
  assert.equal(casilla.checked, true);

  // Otra pestaña renombra la fase: no coincide ni con la base ni con la copia.
  util.rerender(createElement(NodeRow, props(item({ tituloFase: "Renombrada fuera" }))));
  assert.ok(screen.getByText(/Renombrada fuera/), "no se pinta lo que trae el mapa");
  assert.equal(
    screen.getByRole("checkbox", { name: "Requisito Comprobar" }).checked,
    false,
    "con otro contenido, la copia optimista no debe mandar",
  );
  util.unmount();
});

test("si el guardado falla, la copia se suelta y vuelve el mapa", async () => {
  const { util, props } = montar(() => Promise.reject(new Error("sin conexión")));
  const casilla = editar();
  fireEvent.click(casilla);
  assert.equal(casilla.checked, true);

  await screen.findByText("sin conexión");
  await waitFor(() =>
    assert.equal(
      screen.getByRole("checkbox", { name: "Requisito Comprobar" }).checked,
      false,
      "tras el fallo debe verse la lista del mapa",
    ),
  );
  util.unmount();
});
