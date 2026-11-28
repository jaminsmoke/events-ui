/** El borrador de etiquetas del editor y los guardados que no las tocan.
 *
 *  Antes esto era el escenario e2e `editor-conserva-etiquetas`, que además
 *  pagaba el viaje de UI: abrir el mapa, desplegar la fila y esperar 2,5 s al
 *  refresco periódico. Lo que de verdad se prueba es el contrato del editor
 *  con su API (`onCargar`/`onGuardar`): que la carga sea una sola, que un
 *  refresco del padre no pise el borrador y que guardar sin etiquetas
 *  cargadas no las mande. El core conserva las guardadas, y eso lo fija
 *  `shared/core/tests/test_etiquetas.py`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { createElement } = await import("react");
const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { EditorItem } = await import("../src/pantalla/EditorItem.tsx");

/** El editor con su API falsa: cuenta cargas y guardados. */
function montar(cargar) {
  const visto = { cargas: 0, guardados: [], cerrado: 0 };
  const props = (onCargar) => ({
    titulo: "Titulo de etiquetas",
    descripcion: "Texto original",
    onCargar,
    onGuardar: (cambios) => {
      visto.guardados.push(cambios);
      return Promise.resolve();
    },
    onCerrar: () => {
      visto.cerrado++;
    },
  });
  const contador = () => {
    visto.cargas++;
    return cargar();
  };
  const util = render(createElement(EditorItem, props(contador)));
  return {
    visto,
    util,
    /** Un refresco del mapa: props nuevas, con otra lectura detrás. */
    refrescar: () =>
      util.rerender(
        createElement(EditorItem, props(async () => ({ tags: ["otras", "del", "mapa"] }))),
      ),
  };
}

test("el borrador de tags sobrevive al refresco y la carga no se repite", async () => {
  const { visto, util, refrescar } = montar(async () => ({ tags: ["base", "q3"] }));
  const tags = await screen.findByLabelText("Tags");
  await waitFor(() => assert.equal(tags.disabled, false));
  assert.equal(tags.value, "base, q3", "no se precargaron las etiquetas");

  fireEvent.change(tags, { target: { value: "base, q3, tocado" } });
  // El padre se repinta (mapa refrescado por un cambio externo) con funciones
  // nuevas: la lectura no debe repetirse ni pisar lo escrito.
  refrescar();
  assert.equal(screen.getByLabelText("Tags").value, "base, q3, tocado");
  assert.equal(visto.cargas, 1, "el refresco volvió a pedir el ítem");
  util.unmount();
});

test("guardar manda el borrador de etiquetas y cierra", async () => {
  const { visto, util } = montar(async () => ({ tags: ["base", "q3"] }));
  const tags = await screen.findByLabelText("Tags");
  await waitFor(() => assert.equal(tags.disabled, false));
  fireEvent.change(tags, { target: { value: "base, q3, tocado" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

  await waitFor(() => assert.equal(visto.guardados.length, 1));
  assert.deepEqual(visto.guardados[0].tags, ["base", "q3", "tocado"]);
  assert.equal(visto.cerrado, 1);
  util.unmount();
});

test("si la lectura falla, cambiar el título no manda `tags`", async () => {
  const { visto, util } = montar(async () => null);
  await screen.findByText(/No se pudieron cargar las etiquetas/);
  assert.equal(screen.getByLabelText("Tags").disabled, false);

  fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Titulo retocado" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

  await waitFor(() => assert.equal(visto.guardados.length, 1));
  assert.equal(visto.guardados[0].title, "Titulo retocado");
  assert.ok(
    !("tags" in visto.guardados[0]),
    "mandar `tags` con el campo vacío borraría las guardadas",
  );
  util.unmount();
});

test("si la lectura falla pero se escriben etiquetas, se mandan", async () => {
  const { visto, util } = montar(async () => {
    throw new Error("fallo de lectura");
  });
  await screen.findByText(/No se pudieron cargar las etiquetas/);

  fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "nuevas, a mano" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

  await waitFor(() => assert.equal(visto.guardados.length, 1));
  assert.deepEqual(visto.guardados[0].tags, ["nuevas", "a mano"]);
  util.unmount();
});
