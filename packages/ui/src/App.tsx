import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { avisaErrores, avisaEventos, cargarAjustes, guardarAjustes } from "./core/avisos";
import type { Ajustes } from "./core/avisos";
import { folderName, storedRepo } from "./core/repo";
import type { ElegirCarpeta } from "./core/repo";
import { useRepo } from "./core/useRepo";
import { useAnimaciones } from "./mapa/animaciones";
import { buildTree } from "./mapa/arbol";
import type { TreeNode } from "./mapa/arbol";
import { duracionChispa, useCables } from "./mapa/cables";
import { Compuerta, LeyendaCompuertas } from "./mapa/compuertas";
import { useCamara } from "./mapa/camara";
import type { LaneId, Status } from "./mapa/carriles";
import {
  NodeBox,
  NodoCambios,
  NodoCommits,
  NodoGit,
  NodoPuenteGit,
  VueloCambio,
  VueloFila,
} from "./mapa/nodos";
import { useVueloCommit } from "./mapa/vuelos-git";
import { useVuelos } from "./mapa/vuelos";
import { useEventos, resumenEvento } from "./core/useEventos";
import { useProtocolos } from "./core/useProtocolos";
import {
  BarraActividad,
  BarraResumen,
  PaneExplorador,
  PaneGit,
  PaneMapas,
} from "./pantalla/Actividad";
import type { VistaPane } from "./pantalla/Actividad";
import { Ajustes as DialogoAjustes } from "./pantalla/Ajustes";
import { AvisoError } from "./pantalla/AvisoError";
import { BarraRepo } from "./pantalla/BarraRepo";
import { DialogoGit } from "./pantalla/DialogoGit";
import { Bienvenida } from "./pantalla/Bienvenida";
import { NuevaIdea } from "./pantalla/NuevaIdea";
import { SelectorRepo } from "./pantalla/SelectorRepo";
import { AvisoRecorte, Controles } from "./pantalla/Controles";
import { EditorIdea } from "./pantalla/EditorIdea";
import { PanelLog } from "./pantalla/PanelLog";
import { PanelResumen } from "./pantalla/PanelResumen";
import { Pruebas } from "./pantalla/Pruebas";
import { pruebaPendiente, soltar } from "./pantalla/pruebaEnCurso";

/** Ancho del panel derecho abierto: el mismo que `.resumen` en marco.css.
 *  El panel va encima del lienzo —no lo encoge—, así que la cámara tiene que
 *  saber cuánto tapa para encuadrar en lo que se ve. */
const ANCHO_RESUMEN = 272;

/** Por debajo de este ancho, el lienzo con los dos paneles abiertos se queda
 *  sin sitio: el mapa cae por debajo del suelo de encuadre y se recorta en
 *  vez de encoger. Ahí los paneles se turnan, y manda el Explorador. */
const ANCHO_MINIMO_PANELES = 1400;

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
  // Dos mapas enlazados: el de Ideas y el de Git. El puente de Ideas solo
  // abre el de Git cuando hay work tree; la vista se anima al cambiar.
  const [mapa, setMapa] = useState<"ideas" | "git">("ideas");
  // Crear o eliminar el repo local: no se hace al pulsar, hay confirmación.
  const [dialogoGit, setDialogoGit] = useState<null | "crear" | "eliminar">(null);
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
  // Marco tipo IDE: el pane izquierdo (Explorador) empuja el lienzo y el panel
  // derecho (Resumen) sale por encima. El rail de actividad manda en los dos.
  // Pane izquierdo: una vista por vez, como los iconos de VS Code. `null` es
  // cerrado; pulsar el icono que ya está activo lo cierra.
  const [pane, setPane] = useState<VistaPane | null>(null);
  const [resumenAbierto, setResumenAbierto] = useState(false);
  // Ancho de la ventana, no del lienzo: el marco que la rodea es fijo (dos
  // rail de 44, el pane de 232 y el Resumen de 272).
  const [ventanaEstrecha, setVentanaEstrecha] = useState(
    () => window.innerWidth < ANCHO_MINIMO_PANELES,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${ANCHO_MINIMO_PANELES - 1}px)`);
    const alCambiar = () => setVentanaEstrecha(mq.matches);
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);

  /* El Resumen se aparta mientras haya un pane abierto y la ventana sea
   * estrecha. Se deriva en el render en vez de cerrarlo desde un efecto: si
   * luego la ventana crece, el Resumen vuelve sin haber perdido su estado. */
  const resumenVisible = resumenAbierto && !(ventanaEstrecha && pane !== null);

  const abrirVista = useCallback(
    (v: VistaPane) => {
      setPane((actual) => (actual === v ? null : v));
      if (ventanaEstrecha) setResumenAbierto(false);
    },
    [ventanaEstrecha],
  );

  // Si el Resumen está oculto por turno, este clic lo trae de vuelta cerrando
  // el pane: el icono nunca se queda «pulsado pero invisible».
  const alternarResumen = useCallback(() => {
    if (resumenVisible) {
      setResumenAbierto(false);
      return;
    }
    setResumenAbierto(true);
    if (ventanaEstrecha) setPane(null);
  }, [resumenVisible, ventanaEstrecha]);

  // Escape cierra el panel (no es modal: no captura, no atrapa el foco).
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanel(null);
        setResumenAbierto(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const {
    ideas,
    error,
    proyeccion,
    commits,
    crear,
    mover,
    editar,
    borrar,
    cargarIdea,
    reiniciar,
    crearRepoGit,
    eliminarRepoGit,
    commit,
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
  const gitRef = useRef<HTMLElement | null>(null);
  const cambiosRef = useRef<HTMLElement | null>(null);
  const commitsRef = useRef<HTMLElement | null>(null);

  // Lo que tapa el panel derecho. Con los dos paneles abiertos el lienzo se
  // queda en lo que sobra: la cámara encuadra ahí, no debajo del panel.
  const insetDerecha = resumenVisible ? ANCHO_RESUMEN : 0;

  const { vista, arrastrando, encuadrar, zoom, reset, olvidar, mano } = useCamara({
    repo,
    mapa,
    listo: tree !== null,
    boardRef,
    mapRef,
    insetDerecha,
  });
  // ¿Hay work tree? La compuerta de la rama a Git solo se abre entonces.
  const gitActivo = proyeccion?.git === true;
  const { cables, nudos, rama, recortado } = useCables({
    tree,
    cerrados,
    vista,
    mapa,
    boardRef,
    mapRef,
    cajonRef,
    carrilRefs,
    gitRef,
    conGit: gitActivo,
    insetDerecha,
  });
  const { vuelos, volando, aterrizado } = useVuelos({ repo, mapa, ideas, cerrados, vista, mapRef });
  const { filas: vuelosGit, aterrizado: aterrizadoGit } = useVueloCommit({
    repo,
    proyeccion,
    vista,
    mapRef,
    cambiosRef,
    commitsRef,
  });
  const { chispas, pulsos, pulsoCajon } = useAnimaciones(repo, ideas);

  /* Un carril puede tener cable de ida y de vuelta (verificación↔cola,
   * verificación↔roadmap, verificación↔descartadas). La chispa y el fogonazo
   * se anclan al que sale del carril anterior, no al primero del color. */
  const cableDeChispa = useCallback(
    (chispa: { lane: LaneId; desde?: LaneId | null }) => {
      const exacto = cables.find(
        (cable) =>
          cable.lane === chispa.lane && cable.origenLane === (chispa.desde ?? "root"),
      );
      return exacto ?? cables.find((cable) => cable.lane === chispa.lane);
    },
    [cables],
  );

  /* Fogonazo de llegada: la chispa tarda lo que mide su cable; cuando termina,
   *  el nodo da un golpe breve de luz. Va por su cuenta y no con la actividad,
   *  que se apaga en 1,15 s y a veces corta el viaje antes de tiempo. Se anota
   *  por `id` para no repetir el destello de una chispa ya vista. */
  const [destellos, setDestellos] = useState<{ lane: LaneId; id: number }[]>([]);
  const vistos = useRef(new Set<number>());
  const temporizadores = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    for (const chispa of chispas) {
      if (vistos.current.has(chispa.id)) continue;
      vistos.current.add(chispa.id);
      const cable = cableDeChispa(chispa);
      if (!cable) continue;
      temporizadores.current.push(
        setTimeout(() => {
          setDestellos((prev) => [...prev, chispa]);
          temporizadores.current.push(
            setTimeout(
              () => setDestellos((prev) => prev.filter((d) => d.id !== chispa.id)),
              400,
            ),
          );
        }, duracionChispa(cable.longitud) * 1000),
      );
    }
  }, [chispas, cableDeChispa]);

  useEffect(() => () => temporizadores.current.forEach(clearTimeout), []);

  const destelloDe = (lane: string | undefined) => {
    const destello = destellos.find((d) => d.lane === lane);
    return destello ? { clave: destello.id } : undefined;
  };

  const abrir = useCallback(
    (path: string) => {
      olvidar();
      setRepo(path);
      setMapa("ideas");
      setSelectorAbierto(false);
    },
    [olvidar],
  );

  const irGit = useCallback(() => {
    if (gitActivo) setMapa("git");
  }, [gitActivo]);
  const irIdeas = useCallback(() => setMapa("ideas"), []);

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

  /* Cada carril es un nodo de la línea. El del Historial se pinta aparte,
   *  dentro de la estación de Git, pero se sigue guardando en su índice de
   *  `LANES` para que los cables lo midan como un carril más. */
  const nodoDeCarril = (lane: TreeNode, i: number) => (
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
      destello={destelloDe(lane.tone)}
      onMover={alMover}
      onPideEditar={(uid, titulo, descripcion) => setEditando({ uid, titulo, descripcion })}
      onEditar={editar}
      onBorrar={borrar}
      onCargarIdea={cargarIdea}
      puedeIr={puedeIr}
      exigeFases={exigeFases}
      exigeFasesListas={exigeFasesListas}
      exigeFasesCompletas={exigeFasesCompletas}
      catalogo={ideas ?? []}
    />
  );

  /* El cable engorda con lo que espera en su origen: la presión se acumula
   *  antes de la compuerta, no después. */
  const maximo = Math.max(1, ...cables.map((cable) => cable.presion));

  /* Frame: topbar, viewport (el graph) y statusbar *abajo*. Dentro del
   *  viewport, la barra de actividad y el pane van antes del lienzo; el panel
   *  de Resumen se superpone al graph. */
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

      {dialogoGit && proyeccion && (
        <DialogoGit
          tipo={dialogoGit}
          ruta={proyeccion.repo}
          rama={proyeccion.branch}
          onConfirmar={() =>
            dialogoGit === "crear" ? crearRepoGit() : eliminarRepoGit()
          }
          onCerrar={() => setDialogoGit(null)}
        />
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
          abrirMapa={setMapa}
          commit={commit}
          cambios={proyeccion?.git_cambios.length ?? 0}
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
        {/* Marco tipo IDE: la barra de actividad manda sobre los dos paneles. */}
        {repo && (
          <BarraActividad vista={pane} onVista={abrirVista} />
        )}
        {repo && pane === "mapas" && (
          <PaneMapas
            mapa={mapa}
            gitActivo={gitActivo}
            onMapa={(m) => (m === "git" ? irGit() : irIdeas())}
            onCerrar={() => setPane(null)}
          />
        )}
        {repo && pane === "archivos" && (
          <PaneExplorador proyeccion={proyeccion} onCerrar={() => setPane(null)} />
        )}
        {repo && pane === "git" && (
          <PaneGit
            proyeccion={proyeccion}
            commits={commits}
            onIniciar={() => setDialogoGit("crear")}
            onCommit={commit}
            onCerrar={() => setPane(null)}
          />
        )}
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
                key={mapa}
                className={`map mapa-${mapa}`}
                ref={mapRef}
                style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})` }}
              >
                {mapa === "ideas" && (
                <div className="vuelos">
                  {vuelos.map((vuelo) => (
                    <VueloFila key={vuelo.id} vuelo={vuelo} onDone={aterrizado} />
                  ))}
                </div>
                )}
                {mapa === "git" && vuelosGit.length > 0 && (
                <div className="vuelos vuelos-git">
                  {vuelosGit.map((fila) => (
                    <VueloCambio key={fila.id} fila={fila} onDone={aterrizadoGit} />
                  ))}
                </div>
                )}
                {mapa === "ideas" && (
                <svg className="cables" aria-hidden="true">
                  {cables.map((cable) => {
                    const t = cable.presion / maximo;
                    const entrada = cable.origenLane === "root" && cable.lane === "cola";
                    // Solo se abre en guiones el cable que una chispa recorre.
                    const enMarcha = chispas.some(
                      (chispa) => chispa.lane === cable.lane && cableDeChispa(chispa)?.id === cable.id,
                    );
                    const apagadoGit = cable.lane === "git" && proyeccion?.git !== true;
                    return (
                      <path
                        key={cable.id}
                        d={cable.d}
                        className={`wire ${cable.lane}${cable.rama ? " rama" : ""}${
                          apagadoGit ? " apagado" : ""
                        }${enMarcha ? " marcha" : ""}`}
                        style={{
                          // El grosor cuenta lo que espera en el origen; la luz
                          // no: un cable no se enciende porque el carril del
                          // que sale reciba ideas, solo cuando algo lo cruza.
                          strokeWidth: entrada ? 1.3 + 1.5 * t : 1.8 + 2.2 * t,
                          opacity: enMarcha ? 1 : apagadoGit ? 0.25 : entrada ? 0.46 : 0.56,
                          strokeDasharray: apagadoGit ? "4 5" : undefined,
                        }}
                      />
                    );
                  })}
                  {/* Dirección sin depender del movimiento: un chevrón en el
                   *  punto medio. La rama de Descartadas no lo lleva. */}
                  {cables.map((cable) => {
                    // Git no es un tránsito de ideas: su cable no lleva flecha.
                    if (cable.lane === "git") return null;
                    // El chevrón cae sobre un tramo recto de la ruta ortogonal.
                    const { x: mx, y: my, angulo } = cable.chevron;
                    return (
                      <path
                        key={`chevron-${cable.id}`}
                        className={`chevron ${cable.lane}`}
                        d="M -5 -4 L 0 0 L -5 4"
                        transform={`translate(${mx} ${my}) rotate(${angulo})`}
                      />
                    );
                  })}
                  {/* La bifurcación va antes que las compuertas: el rombo se
                   *  pinta debajo y la compuerta del protocolo queda dentro. */}
                  {rama && (
                    <g className="rama-rechazo">
                      <path className="rama-tronco" d={rama.tronco} />
                      {rama.bus && <path className="rama-bus" d={rama.bus} />}
                      <rect
                        className="rama-caja"
                        x={rama.caja.x}
                        y={rama.caja.y}
                        width={rama.caja.w}
                        height={rama.caja.h}
                        rx={6}
                      />
                      <circle
                        className="rama-punto"
                        cx={rama.caja.x + 12}
                        cy={rama.caja.y + 17}
                        r={3.2}
                      />
                      <text
                        className="rama-titulo"
                        x={rama.caja.x + 23}
                        y={rama.caja.y + 21}
                        textAnchor="start"
                      >
                        Revisión rechazada
                      </text>
                      <text
                        className="rama-sub"
                        x={rama.caja.x + 23}
                        y={rama.caja.y + 35}
                        textAnchor="start"
                      >
                        vuelve a cola · roadmap · descartadas
                      </text>
                    </g>
                  )}
                  {/* Los nudos van debajo de las compuertas: cada rombo
                   *  envuelve la celda de protocolo de su cable. */}
                  {nudos.map((nudo) => (
                    <rect
                      key={nudo.id}
                      className={`nudo${nudo.rechazo ? " rechazo" : ""}`}
                      x={nudo.x - nudo.lado / 2}
                      y={nudo.y - nudo.lado / 2}
                      width={nudo.lado}
                      height={nudo.lado}
                      transform={`rotate(45 ${nudo.x} ${nudo.y})`}
                    />
                  ))}
                  {cables.map((cable) => (
                    <Compuerta
                      key={`compuerta-${cable.id}`}
                      lane={cable.lane}
                      uniones={cable.uniones}
                      abierta={cable.abierta}
                      protocolo={paso}
                      {...cable.compuerta}
                    />
                  ))}
                  {cables[0] && (
                    <circle className="junction" cx={cables[0].x1} cy={cables[0].y1} r={4} />
                  )}
                  {chispas.map((chispa) => {
                    const cable = cableDeChispa(chispa);
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
                )}
                {mapa === "ideas" ? (
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
                    onCargarIdea={cargarIdea}
                    puedeIr={puedeIr}
                    exigeFases={exigeFases}
                    exigeFasesListas={exigeFasesListas}
                    exigeFasesCompletas={exigeFasesCompletas}
                    catalogo={ideas ?? []}
                  />
                  {tree.carriles.map((lane, i) =>
                    lane.tone === "historial" ? null : nodoDeCarril(lane, i),
                  )}
                  <div className="estacion-git">
                    <NodoPuenteGit
                      activo={gitActivo}
                      branch={proyeccion?.branch}
                      commit={proyeccion?.commit}
                      gitRoot={proyeccion?.git_root}
                      boxRef={gitRef}
                      onAbrir={irGit}
                      onCrear={() => setDialogoGit("crear")}
                      onEliminar={() => setDialogoGit("eliminar")}
                    />
                    {tree.carriles.map((lane, i) =>
                      lane.tone === "historial" ? nodoDeCarril(lane, i) : null,
                    )}
                  </div>
                </div>
                ) : (
                <div className="linea linea-git">
                  <div className="git-cabecera">
                    <div>
                      <p className="git-kicker">Control de versiones</p>
                      <p className="git-titulo">Mapa de Git</p>
                    </div>
                  </div>
                  <NodoGit
                    activo={gitActivo}
                    branch={proyeccion?.branch}
                    commit={proyeccion?.commit}
                    gitRoot={proyeccion?.git_root}
                    boxRef={gitRef}
                  />
                  <NodoCambios
                    activo={gitActivo}
                    cambios={proyeccion?.git_cambios ?? []}
                    boxRef={cambiosRef}
                  />
                  <NodoCommits activo={gitActivo} commits={commits} boxRef={commitsRef} />
                </div>
                )}
              </div>
            )}
            {recortado && <AvisoRecorte onEncuadrar={encuadrar} />}
            <Controles vista={vista} onZoom={zoom} onReset={reset} />
            {cables.length > 0 && <LeyendaCompuertas />}
          </section>
        )}
        {repo && <BarraResumen abierto={resumenVisible} onAlternar={alternarResumen} />}
        {repo && resumenVisible && (
          <PanelResumen
            proyeccion={proyeccion}
            conectado={conectado}
            onClose={() => setResumenAbierto(false)}
          />
        )}
      </main>

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
