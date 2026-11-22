import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** La raíz que se abre en la app llega al fichero de configuración y `eui`
 *  doctor la ve: eso es lo que deja trabajar al CLI (y luego al MCP) sin que
 *  ningún agente tenga que hablar con la API cruda. */
export default {
  nombre: "config-compartida",
  descripcion: "Abrir una carpeta la deja en config.json y `eui doctor` la encuentra",
  run: async ({ page, UI, CORE, tmp, esperar, expect }) => {
    const configPath = path.join(tmp, "config.json");
    const lab = path.join(tmp, "repos", "lab");
    // Windows puede devolver la ruta corta (`JAMINS~1`) en un lado y la larga
    // en el otro: `.native` es el que expande los nombres 8.3.
    const igual = (a, b) =>
      Boolean(a) &&
      realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await page.locator(".board").waitFor();

    // El `PUT /config` lo hace la UI al cargar el mapa por primera vez.
    let observado = "(sin leer)";
    try {
      await esperar(() => {
        try {
          observado = JSON.parse(readFileSync(configPath, "utf8")).repo ?? "(sin repo)";
          return igual(observado, lab);
        } catch (err) {
          observado = err instanceof Error ? err.message : String(err);
          return false;
        }
      }, "la raíz elegida en config.json");
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}; ` +
          `esperaba ${lab}, en config.json había ${observado}`,
      );
    }

    const cli = (args) =>
      execFileSync("uv", ["run", "--directory", "services/core", "python", "-m", "events_core.cli", ...args], {
        encoding: "utf8",
        env: { ...process.env, EVENTSUI_CONFIG: configPath },
        shell: process.platform === "win32",
      });

    const salida = cli(["doctor", "--url", CORE, "--json"]);
    const informe = JSON.parse(salida);
    expect(informe.ok === true, `doctor no salió en verde: ${salida}`);
    const estados = Object.fromEntries(informe.comprobaciones.map((c) => [c.nombre, c.estado]));
    expect(estados["conexión"] === "ok", `sin conexión con el core: ${salida}`);
    expect(estados["versión"] === "ok", `la versión no coincide: ${salida}`);
    expect(estados["raíz"] === "ok", `doctor no ve la raíz: ${salida}`);
    expect(estados["escritura"] === "ok", `la raíz no es escribible: ${salida}`);

    // Y la lectura usa esa misma raíz sin `--repo`.
    const ideas = JSON.parse(cli(["idea", "list", "--url", CORE, "--json"]));
    expect(Array.isArray(ideas), "`eui idea list --json` debe devolver una lista");
  },
};
