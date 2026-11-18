import { useEffect, useState } from "react";

import type { IdeaUpdate } from "../core/api";

/** Diálogo de edición de una idea: título, descripción, `kind` y `tags`.
 *
 *  `kind`/`tags` no vienen en el mapa, así que al abrirse se pide la idea
 *  completa (`onCargar`) y se precarga el formulario. Cerrar es cancelar:
 *  sin guardar no se toca nada.
 */
export function EditorIdea({
  titulo,
  descripcion,
  onCargar,
  onGuardar,
  onCerrar,
}: {
  titulo: string;
  descripcion: string;
  onCargar: () => Promise<{ kind?: string; tags?: string[] | null } | null>; 
  onGuardar: (cambios: IdeaUpdate) => Promise<void>;
  onCerrar: () => void;
}) {
  const [tituloLocal, setTituloLocal] = useState(titulo);
  const [descripcionLocal, setDescripcionLocal] = useState(descripcion);
  const [kind, setKind] = useState<string>("idea");
  const [tags, setTags] = useState("");
  const [cargada, setCargada] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let viva = true;
    onCargar()
      .then((completa) => {
        if (!viva || !completa) return;
        setKind(completa.kind ?? "idea");
        setTags((completa.tags ?? []).join(", "));
        setCargada(true);
      })
      .catch(() => {
        if (viva) setFallo("No se pudo cargar el tipo y las tags; se abre con valores vacíos.");
      });
    return () => {
      viva = false;
    };
  }, [onCargar]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tituloLocal.trim()) return;
    setTrabajando(true);
    setFallo(null);
    try {
      await onGuardar({
        title: tituloLocal.trim(),
        description: descripcionLocal.trim(),
        kind: kind as IdeaUpdate["kind"],
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCerrar();
    } catch (err: unknown) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <dialog
        className="modal"
        open
        aria-label="Editar idea"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <form onSubmit={guardar}>
          <h2>Editar idea</h2>
          {!cargada && <p className="hint">Cargando tipo y tags…</p>}
          <label>
            Título
            <input
              value={tituloLocal}
              onChange={(e) => setTituloLocal(e.target.value)}
              aria-label="Título"
              autoFocus
            />
          </label>
          <label>
            Descripción
            <input
              value={descripcionLocal}
              onChange={(e) => setDescripcionLocal(e.target.value)}
              placeholder="Descripción"
              aria-label="Descripción"
            />
          </label>
          <label>
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
              <option value="idea">idea</option>
              <option value="adr">adr</option>
              <option value="note">note</option>
            </select>
          </label>
          <label>
            Tags
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tags, separados por comas"
              aria-label="Tags"
            />
          </label>
          {fallo && <p className="hint error">{fallo}</p>}
          <div className="modal-acciones">
            <button className="btn" type="submit" disabled={trabajando || !tituloLocal.trim()}>
              Guardar
            </button>
            <button className="btn ghost" type="button" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
