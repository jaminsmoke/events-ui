import { folderName } from "../core/repo";

/** Nombre, ruta y botón para cambiar de repo. Solo aparece cuando ya hay uno. */
export function BarraRepo({
  repo,
  ocupado,
  onCambiar,
}: {
  repo: string;
  ocupado: boolean;
  onCambiar: () => void;
}) {
  return (
    <div className="repo-bar">
      <span className="repo-name">{folderName(repo)}</span>
      <span className="repo-path mono">{repo}</span>
      <button className="btn ghost" onClick={onCambiar} disabled={ocupado}>
        Cambiar
      </button>
    </div>
  );
}
