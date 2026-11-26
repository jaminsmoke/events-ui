/** La ficha de fases: el marco y el visor de archivos sobre la lista común. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkItem } from "../core/api";
import type { Status } from "./carriles";
import type { Fase } from "./fase";
import { FasesLista } from "./fases";
import { progreso } from "./fasesModelo";

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

/** La ficha de fases: el detalle completo (estado, nota, fecha y archivos),
 *  que la fila no enseña para no crecer. La lista es la misma que la fila. */
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
        <FasesLista
          fases={vista}
          estado={estado}
          alGuardar={alGuardar}
          soloLectura={!alGuardar}
          variante="ficha"
          mostrarFechas
          renderArchivos={(fase, requisito) => {
            const archivos = requisito ? requisito.archivos ?? [] : fase.archivos ?? [];
            if (archivos.length === 0) return null;
            return (
              <ul
                className={requisito ? "ficha-archivos requisito-archivos" : "ficha-archivos"}
                aria-label={`Archivos de ${requisito?.titulo ?? fase.titulo}`}
              >
                {archivos.map((archivo) => {
                  const clave = `${fase.orden}:${requisito?.orden ?? 0}:${archivo.ruta}`;
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
            );
          }}
        />
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
