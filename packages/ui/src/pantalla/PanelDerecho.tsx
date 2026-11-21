import type { CommitGit, ProyeccionRepo } from "../core/api";
import { folderName } from "../core/repo";
import { fechaCorta } from "../mapa/formato";
import { ETIQUETA_SELECCION } from "../mapa/seleccion";
import type { Seleccion } from "../mapa/seleccion";
import type { VistaDerecha } from "./Actividad";

const FECHA_LARGA = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

function fechaLarga(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : FECHA_LARGA.format(fecha);
}

/** Panel derecho del marco, con dos vistas que comparten ancho y cabecera.
 *
 *  Resumen es el estado del repo de un vistazo: sale por encima del lienzo —no
 *  le roba ancho— y se lee de la misma `ProyeccionRepo` que la statusbar, sin
 *  pedir nada nuevo al core. El Inspector recibe lo que se pulsa en el mapa:
 *  así los detalles caben aquí y las filas del lienzo pueden quedarse en una
 *  sola línea. */
export function PanelDerecho({
  vista,
  onVista,
  proyeccion,
  commits,
  seleccion,
  conectado,
  onClose,
}: {
  vista: VistaDerecha;
  onVista: (vista: VistaDerecha) => void;
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  /** Lo seleccionado en el lienzo; `null`, nada. */
  seleccion: Seleccion | null;
  conectado: boolean;
  onClose: () => void;
}) {
  const pestana = (clave: VistaDerecha, etiqueta: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={vista === clave}
      className={`chip${vista === clave ? " activo" : ""}`}
      onClick={() => onVista(clave)}
    >
      {etiqueta}
    </button>
  );

  return (
    <aside className="resumen" aria-label="Panel derecho">
      <div className="panel-cabecera">
        <div className="panel-pestanas" role="tablist">
          {pestana("resumen", "Resumen")}
          {pestana("inspector", "Inspector")}
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={onClose}
          aria-label="Cerrar panel derecho"
        >
          ✕
        </button>
      </div>

      {vista === "resumen" ? (
        <CuerpoResumen proyeccion={proyeccion} conectado={conectado} />
      ) : (
        <CuerpoInspector
          proyeccion={proyeccion}
          commits={commits}
          seleccion={seleccion}
        />
      )}
    </aside>
  );
}

function CuerpoResumen({
  proyeccion,
  conectado,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  conectado: boolean;
}) {
  // De mayor a menor: el carril que más tiene es el que más interesa.
  const estados = proyeccion
    ? Object.entries(proyeccion.por_estado).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )
    : [];
  const maximo = Math.max(1, ...estados.map(([, n]) => n));

  return (
    <div className="panel-cuerpo resumen-cuerpo">
      {!proyeccion ? (
        <p className="hint">Cargando…</p>
      ) : (
        <>
          <p className="resumen-repo" title={proyeccion.repo}>
            {folderName(proyeccion.repo)}
          </p>
          <p className="resumen-ruta" title={proyeccion.repo}>
            {proyeccion.repo}
          </p>

          <div className="resumen-cifras">
            <div className="resumen-cifra">
              <strong>{proyeccion.ideas}</strong>
              <span>ideas</span>
            </div>
            <div className="resumen-cifra">
              <strong>{proyeccion.events}</strong>
              <span>eventos</span>
            </div>
            <div className="resumen-cifra">
              <strong>{proyeccion.git_cambios.length}</strong>
              <span>cambios</span>
            </div>
          </div>

          <dl className="resumen-dl">
            <dt>Rama</dt>
            <dd>{proyeccion.branch ?? "—"}</dd>
            <dt>Commit</dt>
            <dd>{proyeccion.commit ?? "—"}</dd>
            <dt>Work tree</dt>
            <dd>{proyeccion.git ? "sí" : "no"}</dd>
            <dt>Última actividad</dt>
            <dd>
              {proyeccion.ultima_actividad ? fechaCorta(proyeccion.ultima_actividad) : "—"}
            </dd>
            <dt>En vivo</dt>
            <dd>{conectado ? "conectado" : "sin SSE"}</dd>
          </dl>

          <p className="pane-rotulo">Por estado</p>
          {estados.length === 0 ? (
            <p className="hint">Sin ideas todavía.</p>
          ) : (
            <div className="resumen-estados">
              {estados.map(([estado, n]) => (
                <div key={estado} className="resumen-estado">
                  <span>{estado}</span>
                  <strong>{n}</strong>
                  <span className="resumen-estado-barra" aria-hidden="true">
                    <span style={{ width: `${Math.round((n / maximo) * 100)}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {proyeccion.git_cambios.length > 0 && (
            <>
              <p className="pane-rotulo">Cambios sin commit</p>
              <ul className="resumen-cambios">
                {proyeccion.git_cambios.map((cambio) => (
                  <li key={`${cambio.estado}-${cambio.ruta}`}>
                    <span className="cambio-estado">{cambio.estado}</span>
                    <span className="cambio-ruta" title={cambio.ruta}>
                      {cambio.ruta}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** La ficha del commit seleccionado. El contrato del historial solo trae
 *  `hash` abreviado, asunto, autor y fecha; lo que no llega, no se inventa.
 *
 *  En esta fase solo el commit tiene ficha. El resto de elementos ya se
 *  seleccionan en el lienzo y estrenan sus campos en los pasos siguientes. */
function CuerpoInspector({
  proyeccion,
  commits,
  seleccion,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  seleccion: Seleccion | null;
}) {
  if (seleccion && seleccion.tipo !== "commit") {
    return (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="inspector-asunto">{ETIQUETA_SELECCION[seleccion.tipo]}</p>
        <p className="hint">
          Seleccionado en el mapa. Los campos de esta ficha llegan en el
          siguiente paso del inspector.
        </p>
      </div>
    );
  }

  const indice =
    seleccion?.tipo === "commit"
      ? commits.findIndex((commit) => commit.hash === seleccion.hash)
      : -1;
  const commit = indice === -1 ? null : commits[indice];

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      {!commit ? (
        <p className="hint">
          Nada seleccionado. Pulsa un nodo del mapa y sus detalles aparecerán
          aquí.
        </p>
      ) : (
        <>
          <p className="inspector-asunto">{commit.asunto}</p>
          <dl className="inspector-dl">
            <dt>Commit</dt>
            <dd className="inspector-mono">{commit.hash}</dd>
            <dt>Autor</dt>
            <dd>{commit.autor}</dd>
            <dt>Fecha</dt>
            <dd>{fechaLarga(commit.fecha)}</dd>
            <dt>Rama</dt>
            <dd className="inspector-mono">{proyeccion?.branch ?? "—"}</dd>
            <dt>Posición</dt>
            <dd>
              {indice === 0 ? "HEAD · el más reciente" : `${indice + 1} de ${commits.length} desde HEAD`}
            </dd>
          </dl>
        </>
      )}
    </div>
  );
}
