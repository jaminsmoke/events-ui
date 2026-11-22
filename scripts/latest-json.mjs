// Genera `latest.json`, el manifiesto que consulta el updater de Tauri.
//
// Uso (lo llama el workflow de release con el NSIS ya firmado):
//
//   node scripts/latest-json.mjs --version 0.3.1 --tag v0.3.1 \
//     --repo jaminsmoke/events-ui \
//     --artifact "Events UI_0.3.1_x64-setup.exe" \
//     --signature .../Events\ UI_0.3.1_x64-setup.exe.sig \
//     --notes "…" --output latest.json
//
// La firma es el contenido literal del `.sig`: el updater lo compara con la
// clave pública de `tauri.conf.json`, no con el fichero. El Windows x64 usa
// el instalador NSIS per-user, el mismo que se descarga a mano.

import { readFileSync, writeFileSync } from "node:fs";

function leerArgumentos(argumentos) {
  const valores = {};
  for (let i = 0; i < argumentos.length; i += 1) {
    const clave = argumentos[i];
    if (!clave.startsWith("--")) throw new Error(`argumento inesperado: ${clave}`);
    const valor = argumentos[i + 1];
    if (valor === undefined || valor.startsWith("--")) {
      throw new Error(`falta el valor de ${clave}`);
    }
    valores[clave.slice(2)] = valor;
    i += 1;
  }
  return valores;
}

const args = leerArgumentos(process.argv.slice(2));
for (const requerido of ["version", "tag", "repo", "artifact", "signature", "output"]) {
  if (!args[requerido]) throw new Error(`falta --${requerido}`);
}

// El tag y la versión son la misma cosa (el workflow ya lo comprueba antes);
// si aquí no cuadran, el manifiesto apuntaría a una release que no existe.
if (args.tag !== `v${args.version}`) {
  throw new Error(`el tag ${args.tag} no corresponde a la versión ${args.version}`);
}
if (!args.artifact.includes(args.version)) {
  throw new Error(`el artefacto ${args.artifact} no lleva la versión ${args.version}`);
}

const firma = readFileSync(args.signature, "utf8").trim();
if (!firma) throw new Error(`la firma ${args.signature} está vacía`);

const manifiesto = {
  version: args.version,
  notes: args.notes || `Events UI ${args.tag}`,
  // El updater compara fechas ISO 8601; sin milisegundos es el formato de
  // los ejemplos de Tauri y evita diferencias entre plataformas.
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature: firma,
      url: `https://github.com/${args.repo}/releases/download/${args.tag}/${encodeURIComponent(
        args.artifact,
      )}`,
    },
  },
};

writeFileSync(args.output, `${JSON.stringify(manifiesto, null, 2)}\n`, "utf8");
console.log(`latest.json: ${manifiesto.version} · ${manifiesto.platforms["windows-x86_64"].url}`);
