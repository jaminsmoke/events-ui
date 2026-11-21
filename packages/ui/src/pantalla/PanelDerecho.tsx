import { Fragment } from "react";

import type { CommitGit, Idea, ProyeccionRepo } from "../core/api";
import { folderName } from "../core/repo";
import type { Paso } from "../core/useProtocolos";
import { ETIQUETA_ESTADO, LANES } from "../mapa/carriles";
import type { LaneId, Status } from "../mapa/carriles";
import { TEXTO_EXIGENCIA } from "../mapa/protocolos";
import { fechaCorta } from "../mapa/formato";
import { ETIQUETA_SELECCION } from "../mapa/seleccion";
import type { Seleccion } from "../mapa/seleccion";
import type { VistaDerecha } from "./Actividad";
import { CuerpoIdea } from "./InspectorIdea";
import type { AccionesIdea } from "./InspectorIdea";

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
  ideas,
  paso,
  acciones,
  onSeleccionar,
  conectado,
  onClose,
}: {
  vista: VistaDerecha;
  onVista: (vista: VistaDerecha) => void;
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  /** Lo seleccionado en el lienzo; `null`, nada. */
  seleccion: Seleccion | null;
  /** Las ideas del mapa: la ficha de un carril las lista por estado. */
  ideas: readonly Idea[];
  /** El protocolo del repo: qué salidas hay y qué exige cada unión. */
  paso: (origen: Status, destino: Status) => Paso | null;
  /** Lo que la ficha de idea puede hacer con la idea seleccionada. */
  acciones: AccionesIdea;
  /** Pulsar una idea en la ficha la selecciona en el lienzo. */
  onSeleccionar: (seleccion: Seleccion) => void;
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
          ideas={ideas}
          paso={paso}
          acciones={acciones}
          onSeleccionar={onSeleccionar}
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

/** Estados que viven en cada carril: los mismos grupos con los que el core
 *  cruza el protocolo. `descartadas` junta rechazadas y reemplazadas, y la
 *  Entrada es el caso particular de `draft`, sin carril propio. */
const ESTADOS_POR_CARRIL: Record<LaneId, readonly Status[]> = {
  cola: ["proposed"],
  roadmap: ["roadmap"],
  verificacion: ["verificacion"],
  revision_aprobada: ["revision_aprobada"],
  historial: ["historial"],
  descartadas: ["rejected", "superseded"],
};
const ESTADOS_ENTRADA: readonly Status[] = ["draft"];

/** Todos los estados en el orden del flujo, para buscar salidas. */
const ESTADOS: readonly Status[] = [
  "draft",
  "proposed",
  "roadmap",
  "verificacion",
  "revision_aprobada",
  "historial",
  "rejected",
  "superseded",
];

/** La ficha de un carril: qué ideas lo pueblan, cómo se reparten y por dónde
 *  puede seguir cada estado según el protocolo del repo. Las salidas no se
 *  inventan: son las uniones que `paso` da por abiertas, con lo que piden. */
function CuerpoCarril({
  titulo,
  estados,
  ideas,
  paso,
  onSeleccionar,
}: {
  titulo: string;
  estados: readonly Status[];
  ideas: readonly Idea[];
  paso: (origen: Status, destino: Status) => Paso | null;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  const delCarril = ideas.filter((idea) => estados.includes(idea.status));
  const salidas = estados.flatMap((origen) =>
    ESTADOS.filter((destino) => !estados.includes(destino))
      .map((destino) => ({ origen, destino, paso: paso(origen, destino) }))
      .filter((union) => union.paso?.abierta),
  );

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">{titulo}</p>
      <p className="inspector-meta">
        {delCarril.length === 1 ? "1 idea" : `${delCarril.length} ideas`}
      </p>

      {estados.length > 1 && (
        <dl className="inspector-dl">
          {estados.map((estado) => (
            <Fragment key={estado}>
              <dt>{ETIQUETA_ESTADO[estado] ?? estado}</dt>
              <dd>{delCarril.filter((idea) => idea.status === estado).length}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      <p className="pane-rotulo">Ideas</p>
      {delCarril.length === 0 ? (
        <p className="hint">Este carril está vacío.</p>
      ) : (
        <ul className="inspector-lista">
          {delCarril.map((idea) => (
            <li key={idea.uid}>
              <button
                type="button"
                className="inspector-idea"
                onClick={() => onSeleccionar({ tipo: "idea", uid: idea.uid })}
              >
                <span className="inspector-idea-titulo">{idea.title}</span>
                <span className="inspector-idea-estado">
                  {ETIQUETA_ESTADO[idea.status] ?? idea.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="pane-rotulo">Salidas del protocolo</p>
      {salidas.length === 0 ? (
        <p className="hint">Ningún protocolo deja salir de este carril.</p>
      ) : (
        <ul className="inspector-uniones">
          {salidas.map(({ origen, destino, paso: union }) => (
            <li key={`${origen}→${destino}`}>
              <span className="inspector-union">
                {estados.length > 1 ? `${ETIQUETA_ESTADO[origen] ?? origen} → ` : "→ "}
                {ETIQUETA_ESTADO[destino] ?? destino}
              </span>
              <span className="inspector-exige">
                {union?.exige.length
                  ? union.exige
                      .map((exigencia) => TEXTO_EXIGENCIA[exigencia])
                      .join("; ")
                  : "paso libre"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {estados.includes("revision_aprobada") && (
        <p className="hint">
          Archivar a Historial no cruza protocolo: lo habilita tener work tree.
        </p>
      )}
    </div>
  );
}

/** La ficha del commit seleccionado. El contrato del historial solo trae
 *  `hash` abreviado, asunto, autor y fecha; lo que no llega, no se inventa.
 *
 *  El resto de elementos ya se seleccionan en el lienzo y estrenan sus campos
 *  en los pasos siguientes: la idea, el cambio y los cables. */
function CuerpoInspector({
  proyeccion,
  commits,
  seleccion,
  ideas,
  paso,
  acciones,
  onSeleccionar,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  seleccion: Seleccion | null;
  ideas: readonly Idea[];
  paso: (origen: Status, destino: Status) => Paso | null;
  acciones: AccionesIdea;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  if (seleccion && (seleccion.tipo === "carril" || seleccion.tipo === "cajon")) {
    const laneId =
      seleccion.tipo === "carril"
        ? (seleccion.clave.replace(/^lane-/, "") as LaneId)
        : null;
    const meta = laneId ? LANES.find((lane) => lane.id === laneId) : undefined;
    return (
      <CuerpoCarril
        titulo={meta?.title ?? "Entrada"}
        estados={meta ? ESTADOS_POR_CARRIL[meta.id] : ESTADOS_ENTRADA}
        ideas={ideas}
        paso={paso}
        onSeleccionar={onSeleccionar}
      />
    );
  }

  if (seleccion && seleccion.tipo === "idea") {
    const idea = ideas.find((candidata) => candidata.uid === seleccion.uid);
    return idea ? (
      <CuerpoIdea
        idea={idea}
        catalogo={ideas}
        acciones={acciones}
        onSeleccionar={onSeleccionar}
      />
    ) : (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">Esa idea ya no está en el mapa.</p>
      </div>
    );
  }

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
