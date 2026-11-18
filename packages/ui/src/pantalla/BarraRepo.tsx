import { folderName } from "../core/repo";

/** Nombre, ruta y botón para cambiar de repo. Solo aparece cuando ya hay uno.
 *  `ruta` es la carpeta resuelta (de la proyección): si no viene, se enseña
 *  lo que hay —antes se repetía el nombre dos veces («Lab1 Lab1»). */
export function BarraRepo({
  repo,
  ruta,
  ocupado,
  onCambiar,
}: {
  repo: string;
  ruta?: string | null;
  ocupado: boolean;
  onCambiar: () => void;
}) {
  return (
    <div className="repo-bar">
      <span className="repo-name">{folderName(repo)}</span>
      <span className="repo-path mono">{ruta ?? repo}</span>
      <button className="btn ghost" onClick={onCambiar} disabled={ocupado}>
        Cambiar
      </button>
    </div>
  );
}
