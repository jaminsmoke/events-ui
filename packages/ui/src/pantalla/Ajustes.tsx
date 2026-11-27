import type { Actualizacion } from "../core/actualizacion";
import { Modal } from "./Modal";

/** Diálogo de Ajustes: solo actualizaciones.
 *
 *  Los avisos del sistema se retiraron (lanzaban una notificación por cada
 *  evento de cada ítem). El botón «Ajustes» vive ahora únicamente donde hay
 *  actualizador —desktop—, así que aquí no queda nada más que ajustar y
 *  cerrar es la única salida. */
export function Ajustes({
  actualizacion,
  onCerrar,
}: {
  actualizacion: Actualizacion;
  onCerrar: () => void;
}) {
  const comprobando =
    actualizacion.estado === "comprobando" || actualizacion.estado === "descargando";

  return (
    <Modal etiqueta="Ajustes" onCerrar={onCerrar}>
      <h2>Actualizaciones</h2>
      <p className="hint">Versión actual: {actualizacion.version}</p>
      <button
        className="btn ghost"
        type="button"
        onClick={actualizacion.comprobar}
        disabled={comprobando}
      >
        {comprobando ? "Buscando…" : "Buscar actualizaciones"}
      </button>
      {actualizacion.nueva && (
        <p className="hint">
          Hay una versión nueva: {actualizacion.nueva.version}. Cierra este
          diálogo para instalarla desde el aviso.
        </p>
      )}
      {actualizacion.mensaje && <p className="hint">{actualizacion.mensaje}</p>}

      <div className="modal-acciones">
        <button className="btn" type="button" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
