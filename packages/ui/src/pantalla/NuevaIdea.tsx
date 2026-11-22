import { useState } from "react";
import type { FormEvent } from "react";

import type { IdeaCreate } from "../core/api";

/** Nuevo ítem: título obligatorio, descripción opcional. El `body` se
 *  compone contra `IdeaCreate` del contrato generado, así que un enum mal
 *  puesto no compila. */
export function NuevaIdea({
  onCrear,
  onCerrar,
}: {
  onCrear: (body: IdeaCreate) => Promise<unknown>;
  onCerrar: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const title = titulo.trim();
    if (!title || guardando) return;
    setGuardando(true);
    setFallo(null);
    try {
      await onCrear({
        title,
        description: descripcion.trim(),
        content: "",
        kind: "idea",
        status: "draft",
        tags: [],
      });
      onCerrar();
    } catch (err) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form className="nueva" onSubmit={(e) => void enviar(e)}>
      <input
        className="mono"
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Título del ítem"
        aria-label="Título del ítem"
        autoFocus
      />
      <input
        className="mono"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Descripción (opcional)"
        aria-label="Descripción del ítem"
      />
      <div className="nueva-acciones">
        <button className="btn" type="submit" disabled={guardando || !titulo.trim()}>
          Crear ítem
        </button>
        <button className="btn ghost" type="button" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
      {fallo && <p className="hint error">{fallo}</p>}
    </form>
  );
}
