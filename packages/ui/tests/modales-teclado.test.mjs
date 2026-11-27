/** El foco, Tab y Escape de los diálogos, y los dos que los usan.
 *
 *  Antes esto era el escenario e2e `modales-teclado`: abría Ajustes y el
 *  editor de un ítem en el navegador para comprobar lo mismo. El marco es el
 *  mismo `Modal` para los cinco diálogos, así que probarlo con sus dos casos
 *  —uno con el foco inicial en un campo, otro con el `autoFocus` de React— y
 *  las llamadas falsas del editor cubre lo que el viaje de UI añadía.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { createElement } = await import("react");
const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { Ajustes } = await import("../src/pantalla/Ajustes.tsx");
const { EditorItem } = await import("../src/pantalla/EditorItem.tsx");

/** Un botón fuera del diálogo: es el origen al que el foco debe volver. */
function botonOrigen() {
  const boton = document.createElement("button");
  boton.textContent = "Abrir";
  document.body.append(boton);
  boton.focus();
  return boton;
}

/** El diálogo tal como lo monta la app: sin `autoFocus` en ningún campo. */
function montarAjustes() {
  const visto = { guardado: null, cerrado: 0 };
  const util = render(
    createElement(Ajustes, {
      ajustes: { verbosidad: "todo", soloFondo: false },
      onGuardar: (ajustes) => {
        visto.guardado = ajustes;
      },
      onCerrar: () => {
        visto.cerrado++;
      },
    }),
  );
  return { visto, util };
}

test("Ajustes: el foco entra, Shift+Tab no se escapa y cerrar lo devuelve", () => {
  const origen = botonOrigen();
  const { visto, util } = montarAjustes();
  const dialogo = screen.getByRole("dialog", { name: "Ajustes" });

  assert.ok(dialogo.contains(document.activeElement), "el foco no entró al diálogo");
  assert.equal(
    document.activeElement.getAttribute("aria-label"),
    "Qué avisar",
    "el foco inicial debe ser el primer enfocable",
  );

  // Shift+Tab desde el primero da la vuelta al último: no sale del diálogo.
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  assert.ok(dialogo.contains(document.activeElement), "Tab se escapó del diálogo");
  assert.equal(document.activeElement.textContent, "Cancelar", "Shift+Tab no dio la vuelta");

  // Cerrar con el botón y desmontar devuelve el foco a quien lo abrió.
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  assert.equal(visto.cerrado, 1);
  util.unmount();
  assert.equal(document.activeElement, origen, "el foco no volvió al origen");
  origen.remove();
});

test("Ajustes: Escape cierra aunque el foco se haya ido fuera", () => {
  const origen = botonOrigen();
  const { visto, util } = montarAjustes();
  // Como al pulsar la barra superior: el foco se queda en el botón de fuera.
  origen.focus();
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(visto.cerrado, 1, "Escape no cerró el diálogo");
  util.unmount();
  assert.equal(document.activeElement, origen);
  origen.remove();
});

/** El editor, con su API falsa: la carga de etiquetas y el guardado. */
function montarEditor({ cargar, guardar = () => Promise.resolve() }) {
  const visto = { cargas: 0, guardados: [], cerrado: 0 };
  const util = render(
    createElement(EditorItem, {
      titulo: "Idea de modales",
      descripcion: "Texto original",
      onCargar: () => {
        visto.cargas++;
        return cargar();
      },
      onGuardar: (cambios) => {
        visto.guardados.push(cambios);
        return guardar();
      },
      onCerrar: () => {
        visto.cerrado++;
      },
    }),
  );
  return { visto, util };
}

test("EditorItem: el autoFocus del título gana al primer enfocable", async () => {
  const origen = botonOrigen();
  const { visto, util } = montarEditor({ cargar: async () => ({ tags: ["ux", "mapa"] }) });

  // React enfoca el campo con `autoFocus` al montar; el marco no lo pisa.
  assert.equal(
    document.activeElement.getAttribute("aria-label"),
    "Título",
    "el foco inicial debe quedarse en el título",
  );
  await waitFor(() => assert.equal(screen.getByLabelText("Tags").disabled, false));
  assert.equal(screen.getByLabelText("Tags").value, "ux, mapa", "no se precargaron las tags");
  assert.equal(visto.cargas, 1, "la carga de tags debe hacerse una sola vez");

  util.unmount();
  assert.equal(document.activeElement, origen);
  origen.remove();
});

test("EditorItem: guardar manda título, descripción y etiquetas y cierra", async () => {
  const { visto, util } = montarEditor({ cargar: async () => ({ tags: ["ux"] }) });
  await waitFor(() => assert.equal(screen.getByLabelText("Tags").disabled, false));

  fireEvent.change(screen.getByLabelText("Descripción"), {
    target: { value: "Texto nuevo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

  await waitFor(() => assert.equal(visto.guardados.length, 1));
  assert.deepEqual(visto.guardados[0], {
    title: "Idea de modales",
    description: "Texto nuevo",
    tags: ["ux"],
  });
  assert.equal(visto.cerrado, 1, "guardar debe cerrar el editor");
  util.unmount();
});

test("EditorItem: sin etiquetas cargadas, guardar no manda `tags` (no las borra)", async () => {
  const { visto, util } = montarEditor({ cargar: async () => null });
  await waitFor(() => screen.getByText(/No se pudieron cargar las etiquetas/));

  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(visto.guardados.length, 1));
  assert.deepEqual(visto.guardados[0], {
    title: "Idea de modales",
    description: "Texto original",
  });
  util.unmount();
});
