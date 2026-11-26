/** La ficha de fases: detalle de la fase y el visor de sus archivos. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkItem } from "../core/api";
import type { Status } from "./carriles";
import { ETIQUETA_FASE, type Fase } from "./fase";
import { conNota, conRequisito, progreso } from "./fasesModelo";
import { fechaCorta } from "./formato";
import { useGuardarFases } from "./useGuardarFases";

/** Un archivo anotado: ruta, estado y, si lo hay, su parche desplegable.
 *  Sin contenido (sin Git, sin commits o demasiado grande) queda la fila: la
 *  ruta y el estado ya informan. */
function ArchivoAnotado({
  archivo,
  clave,
  parche,
  desplegado,
  onAbrir,
}: {
  archivo: NonNullable<Fase["archivos"]>[number];
  /** Identifica el despliegue: la misma ruta puede estar en fase y requisito. */
  clave: string;
  parche?: string;
  desplegado: boolean;
  onAbrir: (clave: string | null) => void;
}) {
  // Un renombrado sin Git solo se ve así: de dónde vino y a dónde fue.
  const nombre = archivo.desde ? `${archivo.desde} → ${archivo.ruta}` : archivo.ruta;
  return (
    <li className="ficha-archivo">
      {parche ? (
        <button
          type="button"
          className="archivo-abrir"
          aria-expanded={desplegado}
          title="Ver el cambio"
          onClick={() => onAbrir(desplegado ? null : clave)}
        >
          <span className={`archivo-estado estado-${archivo.estado}`}>{archivo.estado}</span>
          <code>{nombre}</code>
          <span className="archivo-flecha" aria-hidden="true">
            {desplegado ? "▾" : "▸"}
          </span>
        </button>
      ) : (
        <span
          className="archivo-abrir"
          title="Sin contenido: sin Git, sin commits o demasiado grande"
        >
          <span className={`archivo-estado estado-${archivo.estado}`}>{archivo.estado}</span>
          <code>{nombre}</code>
        </span>
      )}
      {parche && desplegado && (
        <pre className="ficha-parche">
          {parche.split("\n").map((linea, indice) => (
            <span
              key={indice}
              className={
                linea.startsWith("+") && !linea.startsWith("+++")
                  ? "linea-mas"
                  : linea.startsWith("-") && !linea.startsWith("---")
                    ? "linea-menos"
                    : undefined
              }
            >
              {linea}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </li>
  );
}

/** La ficha de fases: el detalle completo (estado, nota y fecha), que la
 *  fila no enseña para no crecer. Solo lectura: editar es cosa de la fila. */
export function FichaFases({
  uid,
  estado,
  titulo,
  fases,
  alGuardar,
  cargarItem,
  onCerrar,
}: {
  uid?: string;
  /** El carril de el ítem: el motivo se toca en roadmap, como en la fila. */
  estado: Status;
  titulo: string;
  fases: readonly Fase[];
  /** La copia optimista vive en la fila; sin él, la ficha es de lectura. */
  alGuardar?: (siguientes: readonly Fase[]) => Promise<void>;
  /** La item completa: el mapa no trae el parche de cada archivo, solo el
   *  recuento. Sin esto, la ficha enseña rutas y estado, que ya vienen. */
  cargarItem?: (uid: string) => Promise<WorkItem | null>;
  onCerrar: () => void;
}) {
  const { guardando, fallo, guardar } = useGuardarFases(alGuardar);
  // El parche se pide al abrir la ficha y se mezcla por `fase:requisito:ruta`:
  // la lista que se edita sigue siendo la de la fila, y el contenido solo se
  // pinta. El requisito 0 es la fase entera.
  const [parches, setParches] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [abierto, setAbierto] = useState<string | null>(null);
  const vista = fases;
  const { hechas } = progreso(vista);

  useEffect(() => {
    if (!cargarItem || !uid) return;
    let vivo = true;
    void cargarItem(uid)
      .then((item) => {
        if (!vivo || !item) return;
        const mapa = new Map<string, string>();
        for (const fase of item.fases ?? []) {
          for (const archivo of fase.archivos ?? []) {
            if (archivo.contenido) mapa.set(`${fase.orden}:0:${archivo.ruta}`, archivo.contenido);
          }
          for (const requisito of fase.requisitos ?? []) {
            for (const archivo of requisito.archivos ?? []) {
              if (archivo.contenido) {
                mapa.set(`${fase.orden}:${requisito.orden}:${archivo.ruta}`, archivo.contenido);
              }
            }
          }
        }
        setParches(mapa);
      })
      .catch(() => {
        // Sin detalle la ficha sigue sirviendo: ruta, estado y fecha.
      });
    return () => {
      vivo = false;
    };
  }, [cargarItem, uid]);

  return createPortal(
    <div
      className="modal-fondo"
      role="presentation"
      // El tablero captura el puntero al arrastrar: sin cortarlo aquí, el
      // `mouseup` se va al mapa y el botón Cerrar no recibe el clic.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onCerrar}
    >
      <div
        className="modal"
        role="dialog"
        aria-label="Fases del ítem"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <h2>Fases de «{titulo}»</h2>
        <p className="hint">
          {hechas} de {vista.length} completadas
        </p>
        <ol className="ficha-fases">
          {vista.map((fase) => {
            const requisitos = fase.requisitos ?? [];
            const hechosReq = requisitos.filter((requisito) => requisito.hecho).length;
            return (
            <li key={fase.orden} className={`ficha-fase estado-${fase.estado}`}>
              <span className="ficha-fase-titulo">
                <span className="fase-indice">Fase {fase.orden}</span>
                {" · "}
                {fase.titulo}
              </span>
              {/* Mismo resumen que la fila; aquí la checklist ya está a la vista. */}
              <span className="fase-check">
                {hechosReq}/{requisitos.length}{" "}
                {requisitos.length === 1 ? "requisito" : "requisitos"}
              </span>
              <span className="fila-estado">{ETIQUETA_FASE[fase.estado] ?? fase.estado}</span>
              {alGuardar &&
              estado === "roadmap" &&
              (fase.estado === "fallida" || fase.estado === "rechazada") ? (
                <input
                  key={fase.nota}
                  className="ficha-fase-motivo"
                  defaultValue={fase.nota}
                  placeholder="Motivo…"
                  aria-label={`Motivo de ${fase.titulo}`}
                  disabled={guardando}
                  onBlur={(e) => {
                    const nota = e.target.value.trim();
                    if (nota === fase.nota) return;
                    guardar(conNota(vista, fase.orden, nota));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              ) : (
                fase.nota && <p className="ficha-fase-nota">Motivo: {fase.nota}</p>
              )}
              {fase.requisitos && fase.requisitos.length > 0 && (
                <ul className="ficha-requisitos">
                  {fase.requisitos.map((requisito) => (
                    <li
                      key={requisito.orden}
                      className={`ficha-requisito${requisito.hecho ? " hecho" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={requisito.hecho}
                        disabled={guardando || estado !== "roadmap" || !alGuardar}
                        aria-label={`Requisito ${requisito.titulo}`}
                        onChange={() => guardar(conRequisito(vista, fase.orden, requisito.orden))}
                      />
                      <span className="ficha-requisito-titulo">{requisito.titulo}</span>
                      {requisito.done_at && (
                        <time dateTime={requisito.done_at}>{fechaCorta(requisito.done_at)}</time>
                      )}
                      {requisito.archivos && requisito.archivos.length > 0 && (
                        <ul
                          className="ficha-archivos requisito-archivos"
                          aria-label={`Archivos de ${requisito.titulo}`}
                        >
                          {requisito.archivos.map((archivo) => {
                            const clave = `${fase.orden}:${requisito.orden}:${archivo.ruta}`;
                            return (
                              <ArchivoAnotado
                                key={archivo.ruta}
                                archivo={archivo}
                                clave={clave}
                                parche={parches.get(clave)}
                                desplegado={abierto === clave}
                                onAbrir={setAbierto}
                              />
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {fase.archivos && fase.archivos.length > 0 && (
                <ul className="ficha-archivos" aria-label={`Archivos de ${fase.titulo}`}>
                  {fase.archivos.map((archivo) => {
                    const clave = `${fase.orden}:0:${archivo.ruta}`;
                    return (
                      <ArchivoAnotado
                        key={archivo.ruta}
                        archivo={archivo}
                        clave={clave}
                        parche={parches.get(clave)}
                        desplegado={abierto === clave}
                        onAbrir={setAbierto}
                      />
                    );
                  })}
                </ul>
              )}
              <time className="ficha-fase-fecha" dateTime={fase.entered_at}>
                {fechaCorta(fase.entered_at)}
              </time>
            </li>
            );
          })}
        </ol>
        {fallo && <p className="hint error">{fallo}</p>}
        <div className="modal-acciones">
          <button className="btn" type="button" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
