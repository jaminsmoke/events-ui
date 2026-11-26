import { BarraRepo } from "./BarraRepo";

/** La cabecera: el repo abierto y las entradas globales (nuevo ítem, ajustes
 *  y pruebas). Los botones que dependen del envoltorio no se pintan si no
 *  hay dónde: sin `avisar` no hay ajustes que guardar y sin panel de pruebas
 *  inyectado no hay lanzador que abrir. */
export function BarraSuperior({
  repo,
  ruta,
  ocupado,
  conAjustes,
  puedeProbar,
  laboratorio,
  onCambiar,
  onNuevo,
  onAjustes,
  onPruebas,
}: {
  repo: string | null;
  ruta?: string | null;
  ocupado: boolean;
  conAjustes: boolean;
  puedeProbar: boolean;
  laboratorio: boolean;
  onCambiar: () => void;
  onNuevo: () => void;
  onAjustes: () => void;
  onPruebas: () => void;
}) {
  return (
    <header className="topbar">
      <h1>Events UI</h1>
      {/* Una sola entrada al selector: en vacío lo lleva el hero de abajo, así
          que la barra solo aparece cuando ya hay repo elegido. */}
      {repo && (
        <BarraRepo repo={repo} ruta={ruta} ocupado={ocupado} onCambiar={onCambiar} />
      )}
      {repo && (
        <button className="btn" onClick={onNuevo}>
          Nuevo ítem
        </button>
      )}
      {conAjustes && (
        <button className="btn ghost" onClick={onAjustes}>
          Ajustes
        </button>
      )}
      {repo && puedeProbar && laboratorio && (
        <button className="btn ghost" onClick={onPruebas}>
          Pruebas
        </button>
      )}
    </header>
  );
}
