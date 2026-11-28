import type { ProyeccionRepo } from "../core/api";
import { folderName } from "../core/repo";

/** El estado del repo en la barra inferior: carpeta, rama y commit, y los
 *  contadores de ítems, eventos y estados. */
export function BarraProyeccion({ proyeccion }: { proyeccion: ProyeccionRepo }) {
  return (
    <div className="proyeccion" aria-label="Estado del repo">
      <strong>{folderName(proyeccion.repo)}</strong>
      {proyeccion.branch && (
        <em>
          {" "}
          {proyeccion.branch}
          {proyeccion.commit ? ` · ${proyeccion.commit}` : ""}
        </em>
      )}
      {" · "}
      {proyeccion.items} ítems · {proyeccion.events} eventos
      {Object.entries(proyeccion.por_estado).map(([estado, n]) => (
        <span key={estado}>
          {" · "}
          {estado}: {n}
        </span>
      ))}
    </div>
  );
}
