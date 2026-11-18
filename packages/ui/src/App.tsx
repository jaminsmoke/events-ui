import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { avisaErrores, avisaEventos, cargarAjustes, guardarAjustes } from "./core/avisos";
import type { Ajustes } from "./core/avisos";
import { folderName, storedRepo } from "./core/repo";
import type { ElegirCarpeta } from "./core/repo";
import { useRepo } from "./core/useRepo";
import { useAnimaciones } from "./mapa/animaciones";
import { buildTree } from "./mapa/arbol";
import { useCables } from "./mapa/cables";
import { useCamara } from "./mapa/camara";
import type { LaneId, Status } from "./mapa/carriles";
import { NodeBox, VueloFila } from "./mapa/nodos";
import { useVuelos } from "./mapa/vuelos";
import { useEventos, resumenEvento } from "./core/useEventos";
import { useProtocolos } from "./core/useProtocolos";
import { Ajustes as DialogoAjustes } from "./pantalla/Ajustes";
import { AvisoError } from "./pantalla/AvisoError";
import { BarraRepo } from "./pantalla/BarraRepo";
import { Bienvenida } from "./pantalla/Bienvenida";
import { NuevaIdea } from "./pantalla/NuevaIdea";
import { SelectorRepo } from "./pantalla/SelectorRepo";
import { AvisoRecorte, Controles } from "./pantalla/Controles";
import { EditorIdea } from "./pantalla/EditorIdea";
import { PanelLog } from "./pantalla/PanelLog";
import { Pruebas } from "./pantalla/Pruebas";

/* *  El mapa: se pliega, se encuadra y se mueve; el almacén se toca solo por
 *  la API del core (crear, mover, editar y borrar ideas). Las conexiones
 *  son de la arquitectura: la UI las pinta, no las gestiona.
 *
 *  `elegirCarpeta` lo inyecta el envoltorio que tenga diálogo nativo (Tauri);
 *  la web no lo pasa y el selector ofrece lista de `/repos` y ruta manual.
 *  `avisar`, igual: solo lo inyecta desktop (notificaciones del sistema) y
 *  con él aparece el botón de Ajustes; sin él no hay avisos que ajustar.
 *  `puedeProbar`, también solo desktop: abre el lanzador de pruebas del
 *  laboratorio; la web no lo pasa y no se pinta. */
export default function App({
  elegirCarpeta,
  avisar,
  puedeProbar,
}: {
  elegirCarpeta?: ElegirCarpeta;
  avisar?: (titulo: string, cuerpo: string) => void;
  puedeProbar?: boolean;
}) {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [falloAccion, setFalloAccion] = useState<string | null>(null);
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());
  const [ajustes, setAjustes] = useState<Ajustes>(cargarAjustes);
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [pruebaEnCurso, setPruebaEnCurso] = useState(false);
  const [pruebasAbiertas, setPruebasAbiertas] = useState(false);
  // El editor de la fila vive aquí, no dentro de la fila: la fila le monta
  // un `createPortal` a body y con el ratón sus clics no llegaban (Guardar/
  // Cancelar morían). En la raíz, como Registro/Pruebas, todo funciona.
  const [editando, setEditando] = useState<{
    uid: string;
    titulo: string;
    descripcion: string;
  } | null>(null);
  // Flyout del log (al estilo VS Code): la statusbar tiene una sola
  // entrada, **Log**, que abre el flyout en la pestaña usada en último
  // lugar (Eventos por defecto); las pestañas de dentro alternan.
  const [panel, setPanel] = useState<null | "actividad" | "registro">(null);
  const [ultimaPestana, setUltimaPestana] = useState<"actividad" | "registro">("actividad");

  // Escape cierra el panel (no es modal: no captura, no atrapa el foco).
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const {
    ideas,
    links,
    error,
    proyeccion,
    crear,
    mover,
    editar,
    borrar,
    cargarIdea,
    reiniciar,
  } = useRepo(repo);
  const tree = useMemo(
    () => (ideas ? buildTree(ideas, links) : null),
    [ideas, links],
  );
  // F1: el log del repo en vivo (cada `EUI_DATABASE` lleva el suyo).
  const [versionLog, setVersionLog] = useState(0);
  const { eventos, conectado } = useEventos(repo, versionLog);
  // Los protocolos de flujo: las uniones permitidas entre carriles. La fila
  // no ofrece traslados prohibidos; el core los rechaza si llegan igual.
  const puedeIr = useProtocolos(repo);

  // Avisos del sistema (F3): solo eventos *nuevos* (ids por encima del último
  // visto) y solo si el usuario lo quiere ver; el primer lote del SSE es el
  // historial y nunca avisa. Con `soloFondo`, mirar la ventana silencia todo.
  const ultimoEvento = useRef<number | null>(null);
  useEffect(() => {
    if (eventos.length === 0) {
      ultimoEvento.current = null;
      return;
    }
    if (!avisar) return;
    const ultimo = eventos[eventos.length - 1];
    if (!ultimo) return;
    const previo = ultimoEvento.current;
    ultimoEvento.current = ultimo.id;
    if (previo === null) return; // primer lote: historial
    if (!avisaEventos(ajustes)) return;
    if (ajustes.soloFondo && !document.hidden) return;
    for (const e of eventos.filter((e) => e.id > previo)) {
      avisar("Events UI", resumenEvento(e));
    }
  }, [eventos, avisar, ajustes]);

  // Error del core: solo cuando el mapa ni carga (`!ideas`), al pasar a
  // fallar (transición), no en cada reintento —si no, cada 2 s otro aviso.
  const errorPrevio = useRef<string | null>(null);
  useEffect(() => {
    const previo = errorPrevio.current;
    errorPrevio.current = error;
    if (!avisar || !error || previo === error) return;
    if (!avisaErrores(ajustes)) return;
    if (ajustes.soloFondo && !document.hidden) return;
    if (!ideas) avisar("Events UI", `Sin conexión con el core: ${error}`);
  }, [error, ideas, avisar, ajustes]);

  const boardRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const cajonRef = useRef<HTMLElement | null>(null);
  const carrilRefs = useRef<(HTMLElement | null)[]>([]);

  const { vista, arrastrando, encuadrar, zoom, reset, olvidar, mano } = useCamara({
    repo,
    listo: tree !== null,
    boardRef,
    mapRef,
  });
  const enlacesLaterales = useMemo(
    () =>
      links
        .filter((l) => l.kind === "related" || l.kind === "supersedes")
        .map((l) => ({
          id: l.id,
          kind: l.kind as "related" | "supersedes",
          parentUid: l.parent_uid,
          childUid: l.child_uid,
        })),
    [links],
  );
  const { cables, recortado, enlaces: trazosEnlace } = useCables({
    tree,
    cerrados,
    vista,
    boardRef,
    mapRef,
    cajonRef,
    carrilRefs,
    enlaces: enlacesLaterales,
  });
  const { vuelos, volando, aterrizado } = useVuelos({ repo, ideas, cerrados, vista, mapRef });
  const { chispas, pulsos, pulsoCajon, enlacesNuevos } = useAnimaciones(repo, ideas, links);

  const abrir = useCallback(
    (path: string) => {
      olvidar();
      setRepo(path);
      setSelectorAbierto(false);
    },
    [olvidar],
  );

  // Mover entre carriles es cambiar el `status` (PATCH tipado). El sondeo
  // de `/revision` relee el mapa y el vuelo existente anima la fila.
  const alMover = useCallback(
    (uid: string, status: Status) => {
      setFalloAccion(null);
      void mover(uid, status).catch((err: unknown) => {
        setFalloAccion(err instanceof Error ? err.message : String(err));
      });
    },
    [mover],
  );

  const toggle = useCallback((key: string) => {
    setCerrados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
  const busy = repo !== null && ideas === null && error === null;

  // El cable engorda con su carril: más ideas dentro, más intensidad.
  const volumen = useMemo(() => {
    const totales = new Map<LaneId, number>();
    for (const lane of tree?.carriles ?? []) {
      if (lane.tone && lane.tone !== "root") totales.set(lane.tone, lane.total);
    }
    return totales;
  }, [tree]);
  const maximo = Math.max(1, ...volumen.values());

  /* Frame: topbar, viewport (el graph) y statusbar *abajo*. Antes, el
   *  `main.shell` era un cajón único con la proyección y la actividad
   *  empujando el mapa; ahora el viewport queda solo para el Graph. */
  return (
    <div className="shell">
      <header className="topbar">
        <h1>Events UI</h1>
        {/* Una sola entrada al selector: en vacío lo lleva el hero de abajo, así
            que la barra solo aparece cuando ya hay repo elegido. */}
        {repo && (
          <BarraRepo
            repo={repo}
            ruta={proyeccion?.repo}
            ocupado={busy || pruebaEnCurso}
            onCambiar={() => setSelectorAbierto(true)}
          />
        )}
        {repo && (
          <button className="btn" onClick={() => setNuevaAbierta(true)}>
            Nueva idea
          </button>
        )}
        {avisar && (
          <button className="btn ghost" onClick={() => setAjustesAbiertos(true)}>
            Ajustes
          </button>
        )}
        {repo && puedeProbar && proyeccion?.laboratorio && (
          <button className="btn ghost" onClick={() => { setSelectorAbierto(false); setPruebasAbiertas(true); }}>
            Pruebas
          </button>
        )}
      </header>

      {ajustesAbiertos && (
        <DialogoAjustes
          ajustes={ajustes}
          onGuardar={(nuevos) => {
            setAjustes(nuevos);
            guardarAjustes(nuevos);
            setAjustesAbiertos(false);
          }}
          onCerrar={() => setAjustesAbiertos(false)}
        />
      )}

      {!repo && <Bienvenida onAbrir={abrir} elegirNativo={elegirCarpeta} />}

      {repo && selectorAbierto && (
        <section className="card selector-card">
          <SelectorRepo
            actual={repo}
            onElegir={abrir}
            onCerrar={() => setSelectorAbierto(false)}
            elegirNativo={elegirCarpeta}
          />
        </section>
      )}

      {repo && nuevaAbierta && (
        <section className="card selector-card">
          <NuevaIdea onCrear={crear} onCerrar={() => setNuevaAbierta(false)} />
        </section>
      )}

      {editando && (
        <EditorIdea
          titulo={editando.titulo}
          descripcion={editando.descripcion}
          onCargar={() => cargarIdea(editando.uid)}
          onGuardar={(cambios) => editar(editando.uid, cambios)}
          onCerrar={() => setEditando(null)}
        />
      )}

      {repo && puedeProbar && proyeccion?.laboratorio && (
        <Pruebas
          key={repo}
          abierta={pruebasAbiertas}
          onActividad={setPruebaEnCurso}
          repo={repo}
          crear={crear}
          mover={mover}
          editar={editar}
          reiniciar={async () => {
            await reiniciar();
            setVersionLog((v) => v + 1);
          }}
          onCerrar={() => setPruebasAbiertas(false)}
        />
      )}

      {falloAccion && <AvisoError mensaje={falloAccion} />}

      {error && !ideas && <AvisoError mensaje={error} />}

      <main className="viewport">
        {repo && (!error || ideas) && (
          <section
            className={`board${arrastrando ? " arrastrando" : ""}`}
            ref={boardRef}
            {...mano}
          >
            {error && (
              <p className="aviso-refresco" role="status" title={error}>
                No se pudo actualizar. Reintentando…
              </p>
            )}
            {busy && <p className="hint">Cargando…</p>}
            {!busy && ideas?.length === 0 && (
              <p className="hint">Todavía no hay ideas en este repo.</p>
            )}
            {!busy && tree && (
              <div
                className="map"
                ref={mapRef}
                style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})` }}
              >
                <div className="vuelos">
                  {vuelos.map((vuelo) => (
                    <VueloFila key={vuelo.id} vuelo={vuelo} onDone={aterrizado} />
                  ))}
                </div>
                <svg className="cables" aria-hidden="true">
                  {cables.map((cable) => {
                    const t = (volumen.get(cable.lane) ?? 0) / maximo;
                    return (
                      <path
                        key={cable.lane}
                        d={cable.d}
                        className={`wire ${cable.lane}${t >= 0.66 ? " fuerte" : ""}`}
                        style={{
                          strokeWidth: 1.1 + 1.9 * t,
                          opacity: 0.45 + 0.55 * t,
                          animationDuration: `${3.4 - 2 * t}s`,
                        }}
                      />
                    );
                  })}
                  {cables[0] && (
                    <circle className="junction" cx={cables[0].x1} cy={cables[0].y1} r={4} />
                  )}
                  {trazosEnlace.map((t) => (
                    <path key={t.id} d={t.d} className={`enlace ${t.kind}`} />
                  ))}
                  {chispas.map((chispa) => {
                    const cable = cables.find((c) => c.lane === chispa.lane);
                    return cable ? (
                      <circle key={chispa.id} r={3.5} className={`spark ${chispa.lane}`}>
                        <animateMotion dur="0.64s" path={cable.d} fill="freeze" />
                      </circle>
                    ) : null;
                  })}
                </svg>
                <div className="linea">
                  <NodeBox
                    node={tree.cajon}
                    cerrados={cerrados}
                    onToggle={toggle}
                    boxRef={cajonRef}
                    volando={volando}
                    pulso={pulsoCajon}
                    onMover={alMover}
                    onPideEditar={(uid, titulo, descripcion) =>
                      setEditando({ uid, titulo, descripcion })
                    }
                    onEditar={editar}
                    onBorrar={borrar}
                    enlacesNuevos={enlacesNuevos}
                    puedeIr={puedeIr}
                  />
                  {tree.carriles.map((lane, i) => (
                    <NodeBox
                      key={lane.key}
                      node={lane}
                      cerrados={cerrados}
                      onToggle={toggle}
                      boxRef={(el) => {
                        carrilRefs.current[i] = el;
                      }}
                      volando={volando}
                      pulso={pulsos.find((p) => p.lane === lane.tone)?.tono}
                      onMover={alMover}
                      onPideEditar={(uid, titulo, descripcion) =>
                        setEditando({ uid, titulo, descripcion })
                      }
                      onEditar={editar}
                      onBorrar={borrar}
                      enlacesNuevos={enlacesNuevos}
                      puedeIr={puedeIr}
                    />
                  ))}
                </div>
              </div>
            )}
            {recortado && <AvisoRecorte onEncuadrar={encuadrar} />}
            <Controles vista={vista} onZoom={zoom} onReset={reset} />
          </section>
        )}      </main>

      <footer className="statusbar">
        {/* Flyout: no empuja el viewport. Sale por encima, anclado a su
            entrada (derecha, sobre la statusbar) y del ancho de su menú. */}
        {panel && (
          <PanelLog
            tab={panel}
            onTab={(t) => {
              setUltimaPestana(t);
              setPanel(t);
            }}
            onClose={() => setPanel(null)}
            eventos={eventos}
            conectado={conectado}
          />
        )}

        {proyeccion && (
          <div className="proyeccion" aria-label="Estado del repo">
            <strong>{folderName(proyeccion.repo)}</strong>
            {proyeccion.branch && (
              <em>
                {' '}
                {proyeccion.branch}
                {proyeccion.commit ? ` · ${proyeccion.commit}` : ""}
              </em>
            )}
            {' · '}
            {proyeccion.ideas} ideas · {proyeccion.connections} conexiones · {proyeccion.events}{" "}
            eventos
            {Object.entries(proyeccion.por_estado).map(([estado, n]) => (
              <span key={estado}>
                {" · "}
                {estado}: {n}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          className={`status-item${panel !== null ? " activo" : ""}`}
          aria-expanded={panel !== null}
          onClick={() => setPanel((p) => (p === null ? ultimaPestana : null))}
        >
          Log{conectado && <span className="dot" aria-label="en vivo" />}
          {eventos.length > 0 && <span className="status-item-n">{eventos.length}</span>}
        </button>
      </footer>
    </div>
  );
}
