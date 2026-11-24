#!/usr/bin/env node
// `eui-guard` no aplica reglas: llama a `eui guard` y devuelve su veredicto.
// Las reglas viven en el core, que es el único que sabe evaluar el mapa.

import { spawnSync } from "node:child_process";

const resultado = spawnSync("eui", ["guard", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (resultado.error) {
  console.error(
    "eui-guard necesita el CLI `eui` en el PATH (lo instala la app Events UI).",
  );
  process.exit(2);
}

process.exit(resultado.status ?? 2);
