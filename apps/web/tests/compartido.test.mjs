/** El contrato de `core/vX.Y.Z` que comparten el desktop y el envoltorio web.
 *
 *  Misma tabla que las pruebas de `apps/desktop/src-tauri/src/versiones.rs`.
 *  Si una de las dos implementaciones se desvía, su prueba falla.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { carpetaCompartida, versionDe, versionesABorrar } from "../bin/compartido.mjs";

test("la carpeta compartida es core/vX.Y.Z sobre los datos del usuario", () => {
  assert.equal(
    carpetaCompartida({
      env: { LOCALAPPDATA: "C:/Users/x/AppData/Local" },
      sistema: "win32",
      version: "0.5.15",
    }),
    join("C:/Users/x/AppData/Local", "EventsUI", "core", "v0.5.15"),
  );
  assert.equal(
    carpetaCompartida({
      env: { HOME: "/Users/x" },
      sistema: "darwin",
      version: "0.5.15",
    }),
    join("/Users/x", "Library", "Application Support", "EventsUI", "core", "v0.5.15"),
  );
  assert.equal(
    carpetaCompartida({
      env: { XDG_DATA_HOME: "/home/x/.local/share" },
      sistema: "linux",
      version: "0.5.15",
    }),
    join("/home/x/.local/share", "eventsui", "core", "v0.5.15"),
  );
  assert.equal(
    carpetaCompartida({
      env: { HOME: "/home/x" },
      sistema: "linux",
      version: "0.5.15",
    }),
    join("/home/x/.local/share", "eventsui", "core", "v0.5.15"),
  );
  assert.equal(
    carpetaCompartida({
      env: { EUI_CORE_DIR: "/tmp/core" },
      sistema: "linux",
      version: "0.5.15",
    }),
    "/tmp/core",
  );
});

test("la retención es la actual más la anterior y las posteriores", () => {
  const nombres = ["v0.5.4", "v0.5.5", "v0.5.6", "v0.5.7", "v0.6.0", "basura", "v0.5.7-rc1"];
  assert.deepEqual(versionesABorrar(nombres, "v0.5.7"), ["v0.5.4", "v0.5.5"]);
});

test("una carpeta que no es versión no cuenta", () => {
  assert.deepEqual(versionesABorrar(["basura", "v0.4", "v0.5.7"], "v0.5.7"), []);
  assert.deepEqual(versionesABorrar(["v0.5.7"], "no-es-version"), []);
});

test("las versiones se leen con y sin v", () => {
  assert.deepEqual(versionDe("v0.5.7"), [0, 5, 7]);
  assert.deepEqual(versionDe("0.5.7"), [0, 5, 7]);
});
