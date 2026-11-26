import { useState } from "react";

import { Modal } from "./Modal";

/** Diálogo al descartar: el motivo del rechazo se guarda en la tabla de
 *  descartes, junto con la fecha. Es opcional —descartar sin motivo sigue descartando—,
 *  pero sin él la ficha queda con la descripción vacía. */
export function DescartaItem({
  titulo,
  onDescartar,
  onCerrar,
}: {
  titulo: string;
  onDescartar: (motivo: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const descartar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrabajando(true);
    setFallo(null);
    try {
      await onDescartar(motivo.trim());
      onCerrar();
    } catch (err: unknown) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Modal etiqueta="Descartar ítem" onCerrar={onCerrar}>
      <form onSubmit={descartar}>
          <h2>Descartar ítem</h2>
          <p className="hint">«{titulo}» pasa a Descartadas. La descripción inicial se conserva.</p>
          <label>
            Motivo del rechazo
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="¿Por qué se descarta?"
              aria-label="Motivo del rechazo"
              autoFocus
            />
          </label>
          {fallo && <p className="hint error">{fallo}</p>}
          <div className="modal-acciones">
            <button className="btn" type="submit" disabled={trabajando}>
              Descartar
            </button>
            <button className="btn ghost" type="button" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
      </form>
    </Modal>
  );
}
