import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { avisaErrores, avisaEventos, cargarAjustes, guardarAjustes } from "./core/avisos";
import type { Ajustes } from "./core/avisos";
import { folderName, storedRepo } from "./core/repo";
import type { ElegirCarpeta } from "./core/repo";
import { useRepo } from "./core/useRepo";
import { useAnimaciones } from "./mapa/animaciones";
import { buildTree } from "./mapa/arbol";
import { duracionChispa, useCables } from "./mapa/cables";
import { Compuerta, LeyendaCompuertas } from "./mapa/compuertas";
import { useCamara } from "./mapa/camara";
import type { Status } from "./mapa/carriles";
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
import { pruebaPendiente, soltar } from "./pantalla/pruebaEnCurso";

/* *  El mapa: se pliega, se encuadra y se mueve; el almacén se toca solo por
 *  la API del core (crear, mover, editar y borrar ideas).
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
  const [avisoRecuperacion, setAvisoRecuperacion] = useState<string | null>(null);
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
    error,
    proyeccion,
    crear,
    mover,
    editar,
    borrar,
    cargarIdea,
    reiniciar,
  } = useRepo(repo);
  const tree = useMemo(() => (ideas ? buildTree(ideas) : null), [ideas]);
  // F1: el log del repo en vivo (cada `EUI_DATABASE` lleva el suyo).
  const [versionLog, setVersionLog] = useState(0);
  const { eventos, conectado } = useEventos(repo, versionLog);
  // Los protocolos de flujo: las uniones permitidas entre carriles. La fila
  // no ofrece traslados prohibidos; el core los rechaza si llegan igual.
  const { puedeIr, exigeFases, exigeFasesListas, exigeFasesCompletas, paso } = useProtocolos(repo);

  // Una prueba que murió con la app deja su marca sin latido: al reabrir el
  // mismo laboratorio se cobra el vaciado que quedó pendiente. Con latido
  // fresco hay otra ejecución viva y no se toca nada.
  const recuperado = useRef<string | null>(null);
  useEffect(() => {
    if (!repo || !puedeProbar || !proyeccion?.laboratorio) return;
    if (recuperado.current === repo) return;
    const pendiente = pruebaPendiente(repo);
    if (!pendiente) return;
    recuperado.current = repo;
    void reiniciar().then(
      () => {
        soltar(repo, pendiente.ejecucion);
        setVersionLog((v) => v + 1);
        setAvisoRecuperacion("Se cerró la app durante una prueba: el laboratorio quedó vacío.");
      },
      (err: unknown) => {
        setAvisoRecuperacion(
          `Quedó una prueba sin limpiar y no se pudo vaciar: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  }, [repo, puedeProbar, proyeccion?.laboratorio, reiniciar]);

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
  const { cables, nudo, recortado } = useCables({
    tree,
    cerrados,
    vista,
    boardRef,
    mapRef,
    cajonRef,
    carrilRefs,
  });
  const { vuelos, volando, aterrizado } = useVuelos({ repo, ideas, cerrados, vista, mapRef });
  const { chispas, pulsos, pulsoCajon } = useAnimaciones(repo, ideas);

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

  /* El cable engorda con lo que espera en su origen: la presión se acumula
   *  antes de la compuerta, no después. */
  const maximo = Math.max(1, ...cables.map((cable) => cable.presion));

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
            {avisoRecuperacion && (
              <p className="aviso-refresco" role="status">
                {avisoRecuperacion}
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
                    const t = cable.presion / maximo;
                    const entrada = cable.lane === "cola";
                    // Solo se abre en guiones el cable que una chispa recorre.
                    const enMarcha = chispas.some((chispa) => chispa.lane === cable.lane);
                    return (
                      <path
                        key={cable.lane}
                        d={cable.d}
                        className={`wire ${cable.lane}${enMarcha ? " marcha" : ""}`}
                        style={{
                          // El grosor cuenta lo que espera en el origen; la luz
                          // no: un cable no se enciende porque el carril del
                          // que sale reciba ideas, solo cuando algo lo cruza.
                          strokeWidth: entrada ? 1.3 + 1.5 * t : 1.8 + 2.2 * t,
                          opacity: enMarcha ? 1 : entrada ? 0.5 : 0.62,
                        }}
                      />
                    );
                  })}
                  {/* Dirección sin depender del movimiento: un chevrón en el
                   *  punto medio. La rama de Descartadas no lo lleva. */}
                  {cables.map((cable) => {
                    if (cable.lane === "descartadas") return null;
                    // El chevrón baja al tercio: la compuerta ocupa el medio.
                    const mx = cable.x1 + (cable.x2 - cable.x1) * 0.3;
                    const my = cable.y1 + (cable.y2 - cable.y1) * 0.3;
                    const angulo =
                      (Math.atan2(cable.y2 - cable.y1, cable.x2 - cable.x1) * 180) / Math.PI;
                    return (
                      <path
                        key={`chevron-${cable.lane}`}
                        className={`chevron ${cable.lane}`}
                        d="M -5 -4 L 0 0 L -5 4"
                        transform={`translate(${mx} ${my}) rotate(${angulo})`}
                      />
                    );
                  })}
                  {cables.map((cable) => (
                    <Compuerta
                      key={`compuerta-${cable.lane}`}
                      lane={cable.lane}
                      protocolo={paso}
                      {...cable.compuerta}
                    />
                  ))}
                  {cables[0] && (
                    <circle className="junction" cx={cables[0].x1} cy={cables[0].y1} r={4} />
                  )}
                  {nudo && (
                    <rect
                      className="nudo"
                      x={nudo.x - 3.6}
                      y={nudo.y - 3.6}
                      width={7.2}
                      height={7.2}
                      transform={`rotate(45 ${nudo.x} ${nudo.y})`}
                    />
                  )}
                  {chispas.map((chispa) => {
                    const cable = cables.find((c) => c.lane === chispa.lane);
                    return cable ? (
                      <circle key={chispa.id} r={3.5} className={`spark ${chispa.lane}`}>
                        <animateMotion
                          dur={`${duracionChispa(cable.longitud)}s`}
                          path={cable.d}
                          fill="freeze"
                        />
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
                    puedeIr={puedeIr}
                    exigeFases={exigeFases}
                    exigeFasesListas={exigeFasesListas}
                    exigeFasesCompletas={exigeFasesCompletas}
                    catalogo={ideas ?? []}
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
                      puedeIr={puedeIr}
                      exigeFases={exigeFases}
                      exigeFasesListas={exigeFasesListas}
                      exigeFasesCompletas={exigeFasesCompletas}
                      catalogo={ideas ?? []}
                    />
                  ))}
                </div>
              </div>
            )}
            {recortado && <AvisoRecorte onEncuadrar={encuadrar} />}
            <Controles vista={vista} onZoom={zoom} onReset={reset} />
            {cables.length > 0 && <LeyendaCompuertas />}
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
            {proyeccion.ideas} ideas · {proyeccion.events}{" "}
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
