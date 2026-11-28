import type { ProyeccionRepo } from "./api";

/** Una firma barata de la proyección del repo.
 *
 *  `useGit` la usa para no repintar el mapa en cada latido: cada respuesta trae
 *  objetos nuevos aunque nada cambie, y comparar serializando la proyección
 *  entera —con `git_cambios` dentro— pesa y serializa objetos de muchas claves.
 *  La firma recorre lo que se pinta: los escalares, `por_estado` y los
 *  archivos sin commit.
 */
export function firmaProyeccion(p: ProyeccionRepo): string {
  const conteos = Object.keys(p.por_estado)
    .sort()
    .map((estado) => `${estado}=${p.por_estado[estado]}`)
    .join(",");
  const cambios = p.git_cambios
    .map((cambio) => `${cambio.estado}:${cambio.origen ?? ""}:${cambio.ruta}`)
    .join("\n");
  const ignorado =
    p.eui_ignorado === null || p.eui_ignorado === undefined ? "" : p.eui_ignorado ? "1" : "0";
  return [
    p.repo,
    p.laboratorio ? "1" : "0",
    p.git ? "1" : "0",
    p.git_root ?? "",
    p.branch ?? "",
    p.commit ?? "",
    ignorado,
    p.items,
    p.events,
    p.ultima_actividad ?? "",
    conteos,
    cambios,
  ].join("|");
}
