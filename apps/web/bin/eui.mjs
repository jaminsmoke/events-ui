#!/usr/bin/env node
// Envoltorio de `eui`: el paquete lleva dentro los binarios de cada plataforma
// (`native/<os>-<arch>/`) y aquí se elige el de esta máquina.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aquí = dirname(fileURLToPath(import.meta.url));
const clave = `${process.platform}-${process.arch}`;
const carpeta = join(aquí, "..", "native", clave);
const binario = join(carpeta, process.platform === "win32" ? "eui.exe" : "eui");

const resultado = spawnSync(binario, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, EUI_WEB_DIST: join(aquí, "..", "dist") },
});

if (resultado.error) {
  console.error(`eui: este paquete no trae binario para ${clave} (${carpeta}).`);
  process.exit(1);
}
process.exit(resultado.status ?? 1);
