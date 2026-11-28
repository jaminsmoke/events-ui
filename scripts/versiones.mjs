// Los ficheros que llevan la versión del producto: una sola lista.
//
// `bump.mjs` los escribe y `release.mjs` commitea lo que el bump cambió. Antes
// cada guion tenía la suya y ya divergieron: release seguía añadiendo
// `main.py`, que la versión dejó de tocar. Un fichero versionado nuevo se
// añade aquí y en ningún otro sitio; `check:versiones-ficheros` vigila que no
// vuelva a haber dos listas.

/** El `package.json` de la raíz: su `version` manda sobre las demás. */
export const RAIZ_JSON = "package.json";

/** Los ficheros con `version` en JSON, con el camino hasta el valor. */
export const ARCHIVOS = [
  { ruta: RAIZ_JSON, clave: "version" },
  { ruta: "packages/ui/package.json", clave: "version" },
  { ruta: "packages/protocols/package.json", clave: "version" },
  { ruta: "apps/desktop/package.json", clave: "version" },
  { ruta: "apps/web/package.json", clave: "version" },
  { ruta: "apps/desktop/src-tauri/tauri.conf.json", clave: "version" },
];

/** `Cargo.toml` no es JSON: su `version = "..."` se toca aparte. */
export const CARGO_PATH = "apps/desktop/src-tauri/Cargo.toml";

/** La versión del core, que publican Swagger, `/health` y el CLI. */
export const CORE_VERSION_PATH = "shared/core/src/events_core/__init__.py";

/** Lo que genera el propio release a partir de la versión; el bump no lo escribe. */
export const GENERADOS = [
  "pnpm-lock.yaml",
  "apps/desktop/src-tauri/Cargo.lock",
  "packages/ui/openapi.json",
  "packages/ui/src/core/schema.ts",
];

/** Lo que `release.mjs` commitea: lo versionado, lo generado y nada más. */
export const FICHEROS_DEL_RELEASE = [
  ...ARCHIVOS.map(({ ruta }) => ruta),
  CARGO_PATH,
  CORE_VERSION_PATH,
  ...GENERADOS,
];
