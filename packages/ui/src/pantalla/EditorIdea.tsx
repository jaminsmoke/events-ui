import { useEffect, useRef, useState } from "react";

import type { IdeaUpdate } from "../core/api";

/** Diálogo de edición de una idea: título, descripción y `tags`.
 *
 *  Solo hay un tipo —la idea—: no hay selector de tipo (nota/ADR no han
 *  sido pensados). Las `tags` no vienen en el mapa, así que al abrirse se
 *  pide la idea completa (`onCargar`) y se precargan. Cerrar es cancelar:
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
  onCargar: () => Promise<{ tags?: string[] | null } | null>; 
  onGuardar: (cambios: IdeaUpdate) => Promise<void>;
  onCerrar: () => void;
}) {
  const [tituloLocal, setTituloLocal] = useState(titulo);
  const [descripcionLocal, setDescripcionLocal] = useState(descripcion);
  const [tags, setTags] = useState("");
  const [estadoCarga, setEstadoCarga] = useState<"cargando" | "lista" | "fallida">("cargando");
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  // El mapa se refresca cada dos segundos y `onCargar`/`onGuardar` son
  // funciones nuevas en cada render del padre. La carga de tags se hace una
  // sola vez al abrirse: si dependiera de esas funciones, cada refresco
  // volvería a pedir la idea y pisaría el borrador mientras se escribe.
  const cargarRef = useRef(onCargar);
  const tagsModificadosRef = useRef(false);
  useEffect(() => {
    cargarRef.current = onCargar;
  }, [onCargar]);
  useEffect(() => {
    let viva = true;
    cargarRef
      .current()
      .then((completa) => {
        if (!viva) return;
        if (!completa) {
          setEstadoCarga("fallida");
          setFallo(
            "No se pudieron cargar las etiquetas. Al guardar sin editarlas, se conservan las actuales.",
          );
          return;
        }
        if (!tagsModificadosRef.current) {
          setTags((completa.tags ?? []).join(", "));
        }
        setEstadoCarga("lista");
      })
      .catch(() => {
        if (!viva) return;
        setEstadoCarga("fallida");
        setFallo(
          "No se pudieron cargar las etiquetas. Al guardar sin editarlas, se conservan las actuales.",
        );
      });
    return () => {
      viva = false;
    };
  }, []);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tituloLocal.trim()) return;
    setTrabajando(true);
    setFallo(null);
    try {
      const cambios: IdeaUpdate = {
        title: tituloLocal.trim(),
        description: descripcionLocal.trim(),
      };
      // Si la lectura de las etiquetas falló (o aún no volvió) y el campo no
      // se tocó, no hay que enviar `tags`: hacerlo con el input vacío
      // borraría las que la idea ya tuviera. Si el campo sí se tocó, se
      // respeta lo escrito, aunque sea quitar todas las etiquetas.
      if (estadoCarga === "lista" || tagsModificadosRef.current) {
        cambios.tags = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }
      await onGuardar(cambios);
      onCerrar();
    } catch (err: unknown) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setTrabajando(false);
    }
  };

  // `div` con role="dialog", no el elemento `<dialog>`: con `open` y sin
  // `showModal()` Chrome pinta el cuadro bien pero el hit-test del ratón se
  // rompe (mousedown sobre el botón, mouseup fuera del diálogo) y Guardar/
  // Cancelar morían sin hacer nada. Los otros modales ya usan esta forma.
  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-label="Editar idea"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <form onSubmit={guardar}>
          <h2>Editar idea</h2>
          {estadoCarga === "cargando" && <p className="hint">Cargando tags…</p>}
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
            Tags
            <input
              value={tags}
              onChange={(e) => {
                tagsModificadosRef.current = true;
                setTags(e.target.value);
              }}
              placeholder="tags, separados por comas"
              aria-label="Tags"
              disabled={estadoCarga === "cargando"}
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
      </div>
    </div>
  );
}
