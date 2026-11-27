/** La carpeta se manda al core una vez, no una vez por repintado.
 *
 *  Antes esto era el escenario e2e `config-una-vez`, que contaba los `PUT
 *  /config` desde el navegador y esperaba 700 ms y 1,5 s a que pasaran las
 *  relecturas del SSE. La regla vive en `usePersistirRepo`: aquí se monta con
 *  un `PUT` falso y se repinta como lo hace `App` cuando llega un evento.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-dom.mjs";

const { renderHook, waitFor } = await import("@testing-library/react");
const { usePersistirRepo } = await import("../src/core/usePersistirRepo.ts");

/** Un `PUT` falso que cuenta carpetas y se resuelve cuando se le dice. */
function contador() {
  const carpetas = [];
  let resolver;
  const pendiente = new Promise((listo) => {
    resolver = listo;
  });
  return {
    carpetas,
    put: (repo) => {
      carpetas.push(repo);
      return pendiente;
    },
    resolver: () => resolver(),
  };
}

test("la carpeta se manda una vez y un repintado del SSE no la repite", async () => {
  const { carpetas, put, resolver } = contador();
  const { rerender, unmount } = renderHook(
    ({ repo, enviar }) => usePersistirRepo(repo, enviar),
    { initialProps: { repo: "lab", enviar: put } },
  );

  await waitFor(() => assert.equal(carpetas.length, 1, "la carga no mandó la carpeta"));
  assert.equal(carpetas[0], "lab");
  assert.equal(localStorage.getItem("eui.repo"), "lab", "no se recordó la carpeta");

  resolver();
  await waitFor(() => assert.equal(carpetas.length, 1));

  // Un evento del SSE: mismo repo y una función `put` nueva en cada render.
  const otraPut = contador().put;
  rerender({ repo: "lab", enviar: otraPut });
  await waitFor(() => assert.equal(carpetas.length, 1, "el repintado repitió el PUT"));
  unmount();
});

test("con el PUT en vuelo, un repintado tampoco lo multiplica", async () => {
  const { carpetas, put, resolver } = contador();
  const { rerender, unmount } = renderHook(
    ({ repo, enviar }) => usePersistirRepo(repo, enviar),
    { initialProps: { repo: "lab", enviar: put } },
  );
  await waitFor(() => assert.equal(carpetas.length, 1));

  // El core no ha contestado todavía y el mapa se relee.
  rerender({ repo: "lab", enviar: contador().put });
  assert.equal(carpetas.length, 1, "el repintado duplicó un PUT en vuelo");

  resolver();
  await waitFor(() => assert.equal(carpetas.length, 1));
  unmount();
});

test("cambiar de carpeta manda la nueva y sin carpeta no se manda nada", async () => {
  const { carpetas, put, resolver } = contador();
  const { rerender, unmount } = renderHook(
    ({ repo, enviar }) => usePersistirRepo(repo, enviar),
    { initialProps: { repo: null, enviar: put } },
  );
  assert.deepEqual(carpetas, [], "sin carpeta no debe haber PUT");

  rerender({ repo: "lab", enviar: put });
  await waitFor(() => assert.deepEqual(carpetas, ["lab"]));
  resolver();

  const nuevo = contador();
  rerender({ repo: "otra", enviar: nuevo.put });
  await waitFor(() => assert.deepEqual(nuevo.carpetas, ["otra"], "no se mandó la carpeta nueva"));
  assert.equal(localStorage.getItem("eui.repo"), "otra");
  unmount();
});
