/** Los dos envoltorios comparten un solo preset de Vite.
 *
 *  El preset vive en `packages/config/vite.base.mjs`; cada app solo declara su
 *  puerto (y desktop, el watcher que ignora Rust). Se comparan las
 *  configuraciones **resueltas** con la API de Vite, no el texto.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveConfig } from "vite";

import { presetVite } from "../../../packages/config/vite.base.mjs";

const require = createRequire(import.meta.url);
const puertoCore = require("../../../services/core/src/events_core/puerto.json");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// El entorno del e2e fija otros puertos; aquí se prueba el defecto.
delete process.env.EVENTSUI_UI_PORT;
delete process.env.EVENTSUI_CORE_URL;

test("el preset resuelve puerto, proxy, preview y build en un solo sitio", async () => {
  const config = presetVite({ puerto: 15999, ignorar: ["**/src-tauri/target/**"] });
  assert.equal(typeof config, "function");
  const resuelto = await config({ mode: "development", command: "serve" });

  assert.equal(resuelto.server.port, 15999);
  assert.equal(resuelto.server.strictPort, true);
  assert.equal(resuelto.preview.port, 15999);
  assert.equal(resuelto.preview.strictPort, true);
  assert.equal(resuelto.build.target, "chrome105");
  assert.equal(resuelto.build.emptyOutDir, true);
  assert.deepEqual(resuelto.server.watch.ignored, ["**/src-tauri/target/**"]);

  const proxy = resuelto.server.proxy["/api"];
  assert.equal(proxy.target, `http://127.0.0.1:${puertoCore.core}`);
  assert.equal(proxy.changeOrigin, true);
  assert.equal(proxy.rewrite("/api/log"), "/log");
});

test("las dos apps resuelven el mismo preset y solo cambian puerto y watcher", async () => {
  const web = await resolveConfig(
    {
      root: path.join(raiz, "apps/web"),
      configFile: path.join(raiz, "apps/web/vite.config.ts"),
    },
    "serve",
  );
  const desktop = await resolveConfig(
    {
      root: path.join(raiz, "apps/desktop"),
      configFile: path.join(raiz, "apps/desktop/vite.config.ts"),
    },
    "serve",
  );

  assert.equal(web.server.port, 15174);
  assert.equal(desktop.server.port, 15175);
  assert.equal(web.preview.port, 15174);
  assert.equal(desktop.preview.port, 15175);
  assert.equal(web.build.target, desktop.build.target);
  assert.equal(web.build.outDir, desktop.build.outDir);
  assert.equal(web.server.proxy["/api"].target, desktop.server.proxy["/api"].target);
  assert.equal(
    web.server.proxy["/api"].rewrite("/api/mapa"),
    desktop.server.proxy["/api"].rewrite("/api/mapa"),
  );
  assert.deepEqual(desktop.server.watch.ignored, ["**/src-tauri/target/**"]);
  assert.ok(!web.server.watch?.ignored?.length, "la web no ignora nada");
});
