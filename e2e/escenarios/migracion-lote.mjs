import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** La migración completa, por el CLI y contra el core real: `check`, `apply`,
 *  repetir el plan (mismo lote, sin duplicar) y `undo` (borra el lote). No usa
 *  la API cruda: es el mismo camino que recorrería un agente. */
export default {
  nombre: "migracion-lote",
  descripcion: "`eui migrate check/apply/undo` aplica el plan y lo deshace contra el core real",
  run: async ({ CORE, tmp, expect, api }) => {
    const lab = path.join(tmp, "repos", "lab");
    const docs = path.join(lab, "docs");
    mkdirSync(docs, { recursive: true });
    const markdown = "# Backlog\n\n## Login\n\n- [ ] formulario\n\n## Panel\n\n- [ ] lista\n";
    writeFileSync(path.join(docs, "backlog.md"), markdown, "utf8");
    const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");

    const plan = {
      version: 1,
      ideas: [
        {
          ref: "login",
          title: "Login",
          status: "proposed",
          kind: "idea",
          origen: { ruta: "docs/backlog.md", desde_linea: 3, hasta_linea: 5, sha256 },
        },
        {
          ref: "panel",
          title: "Panel",
          status: "proposed",
          kind: "idea",
          depende_de: ["login"],
          origen: { ruta: "docs/backlog.md", desde_linea: 7, hasta_linea: 9, sha256 },
        },
      ],
    };
    const planPath = path.join(tmp, "plan.json");
    writeFileSync(planPath, JSON.stringify(plan), "utf8");

    const cli = (args) =>
      execFileSync(
        "uv",
        [
          "run",
          "--directory",
          "services/core",
          "python",
          "-m",
          "events_core.cli",
          ...args,
          "--repo",
          lab,
          "--url",
          CORE,
          "--json",
        ],
        {
          encoding: "utf8",
          timeout: 60_000,
          shell: process.platform === "win32",
          env: {
            ...process.env,
            EVENTSUI_CONFIG: path.join(tmp, "config.json"),
            EVENTSUI_REPOS_ROOT: path.join(tmp, "repos"),
          },
        },
      );

    const comprobado = JSON.parse(cli(["migrate", "check", planPath]));
    expect(comprobado.ok === true, `check no salió en verde: ${JSON.stringify(comprobado)}`);

    const aplicado = JSON.parse(cli(["migrate", "apply", planPath]));
    expect(aplicado.repetido === false, `el primer apply no creó lote: ${JSON.stringify(aplicado)}`);
    // El plan va con el nombre viejo (`ideas`) a propósito: el core lo acepta.
    expect(aplicado.items === 2, `el lote no trajo dos ideas: ${JSON.stringify(aplicado)}`);

    const repetido = JSON.parse(cli(["migrate", "apply", planPath]));
    expect(repetido.repetido === true, "repetir el plan no devolvió un lote repetido");
    expect(repetido.lote === aplicado.lote, "repetir el plan devolvió otro lote");

    const antes = await api("/items?repo=lab");
    expect(antes.status === 200, `no se pudo listar: ${antes.status}`);
    expect(antes.data.length === 2, `el lote no dejó dos ideas: ${antes.data.length}`);
    expect(
      antes.data.every((idea) => idea.status === "proposed"),
      "alguna idea del lote no está en proposed",
    );
    const uids = Object.fromEntries(aplicado.creadas.map((c) => [c.ref, c.uid]));
    const dependiente = antes.data.find((idea) => idea.uid === uids.panel);
    expect(
      dependiente?.depende_de.includes(uids.login) === true,
      "`depende_de` no se resolvió al uid de la otra idea del lote",
    );

    const deshecho = JSON.parse(cli(["migrate", "undo", aplicado.lote]));
    expect(deshecho.borradas === 2, `undo inesperado: ${JSON.stringify(deshecho)}`);

    const despues = await api("/items?repo=lab");
    expect(despues.data.length === 0, "quedaron ideas tras deshacer el lote");
  },
};
