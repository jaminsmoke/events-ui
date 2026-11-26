import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cargarAjustes, guardarAjustes } from "./core/avisos";
import type { Ajustes } from "./core/avisos";
import { storedRepo } from "./core/repo";
import type { ElegirCarpeta } from "./core/repo";
import type { Actualizacion } from "./core/actualizacion";
import { useRepo } from "./core/useRepo";
import { useAnimaciones } from "./mapa/animaciones";
import { useAtajosLienzo } from "./mapa/atajos";
import { useCables } from "./mapa/cables";
import { LeyendaCompuertas } from "./mapa/compuertas";
import { useCamara } from "./mapa/camara";
import { LANES, sePuedeEliminar } from "./mapa/carriles";
import type { LaneId, Status } from "./mapa/carriles";
import { Lienzo } from "./mapa/Lienzo";
import type { AccionesLienzo } from "./mapa/vista";
import type { Seleccion } from "./mapa/seleccion";
import { useVueloCommit } from "./mapa/vuelos-git";
import { useVuelos } from "./mapa/vuelos";
import { useArbol } from "./mapa/useArbol";
import { useDestellos } from "./mapa/useDestellos";
import { useSeleccion } from "./mapa/useSeleccion";
import { useEventos } from "./core/useEventos";
import { useAvisosEventos } from "./core/useAvisosEventos";
import { useEmpujeMapa } from "./core/useEmpujeMapa";
import { useProtocolos } from "./core/useProtocolos";
import {
  BarraActividad,
  BarraDerecha,
  PaneExplorador,
  PaneGit,
  PaneMapas,
} from "./pantalla/Actividad";
import type { MapaLienzo, VistaDerecha, VistaPane } from "./pantalla/Actividad";
import { Ajustes as DialogoAjustes } from "./pantalla/Ajustes";
import { BarraProyeccion } from "./pantalla/BarraProyeccion";
import { AvisoError } from "./pantalla/AvisoError";
import { BannerActualizacion } from "./pantalla/BannerActualizacion";
import { BarraSuperior } from "./pantalla/BarraSuperior";
import { DialogoGit } from "./pantalla/DialogoGit";
import { Bienvenida } from "./pantalla/Bienvenida";
import { NuevaIdea } from "./pantalla/NuevaIdea";
import { SelectorRepo } from "./pantalla/SelectorRepo";
import { AvisoRecorte, Controles } from "./pantalla/Controles";
import { EditorIdea } from "./pantalla/EditorIdea";
import { PanelLog } from "./pantalla/PanelLog";
import { PanelDerecho } from "./pantalla/PanelDerecho";
import { pruebaPendiente, soltar } from "./pantalla/pruebaEnCurso";
import { useVentanaEstrecha } from "./pantalla/useVentanaEstrecha";

/** El lanzador de pruebas es solo de desktop y pesa: se carga al abrirlo. */
const Pruebas = lazy(() =>
  import("./pantalla/Pruebas").then((modulo) => ({ default: modulo.Pruebas })),
);

/** Ancho del panel derecho abierto: el mismo que `.resumen` en marco.css.
 *  El panel va encima del lienzo —no lo encoge—, así que la cámara tiene que
 *  saber cuánto tapa para encuadrar en lo que se ve. */
const ANCHO_RESUMEN = 272;

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
  actualizacion,
}: {
  elegirCarpeta?: ElegirCarpeta;
  avisar?: (titulo: string, cuerpo: string) => void;
  puedeProbar?: boolean;
  actualizacion?: Actualizacion;
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
  // Se monta al abrirlo la primera vez y se queda: cerrar el diálogo oculta el
  // progreso, no lo pierde (la prueba sigue corriendo).
  const [pruebasMontadas, setPruebasMontadas] = useState(false);
  // Tres mapas enlazados: trabajo, Git y Documentos (Changelog). El puente
  // de Git solo abre con work tree; el de Documentos siempre.
  const [mapa, setMapa] = useState<MapaLienzo>("items");
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
  // Panel derecho: la vista que enseña (`null` es cerrado). Se abre desde su
  // icono y, el Inspector, también al pulsar un commit en el mapa.
  const [vistaDerecha, setVistaDerecha] = useState<VistaDerecha | null>(null);
  // Archivo abierto en la vista Archivo del panel (ruta relativa); `null`, nada.
  const [archivoAbierto, setArchivoAbierto] = useState<string | null>(null);
  // Ancho de la ventana, no del lienzo: con los dos paneles abiertos el mapa
  // se recorta, y ahí los paneles se turnan.
  const ventanaEstrecha = useVentanaEstrecha();

  /* El panel derecho se aparta mientras haya un pane abierto y la ventana sea
   * estrecha. Se deriva en el render en vez de cerrarlo desde un efecto: si
   * luego la ventana crece, el panel vuelve sin haber perdido su estado. */
  const derechaVisible =
    vistaDerecha !== null && !(ventanaEstrecha && pane !== null);

  // La selección del lienzo y la apertura del visor viven juntas: un clic
  // elige, un commit trae el Inspector y el visor le deja el turno al pane.
  const { seleccion, setSeleccion, seleccionar, abrirArchivo } = useSeleccion({
    ventanaEstrecha,
    setPane,
    setVistaDerecha,
    setArchivoAbierto,
  });

  const abrirVista = useCallback(
    (v: VistaPane) => {
      setPane((actual) => (actual === v ? null : v));
      if (ventanaEstrecha) setVistaDerecha(null);
    },
    [ventanaEstrecha],
  );

  // Si el panel está oculto por turno, este clic lo trae de vuelta cerrando el
  // pane, y repetir el icono activo lo cierra: nunca se queda «pulsado pero
  // invisible».
  const alternarDerecha = useCallback(
    (v: VistaDerecha) => {
      if (derechaVisible && vistaDerecha === v) {
        setVistaDerecha(null);
        return;
      }
      setVistaDerecha(v);
      if (ventanaEstrecha) setPane(null);
    },
    [derechaVisible, vistaDerecha, ventanaEstrecha],
  );

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
    ignorarAlmacen,
    reiniciar,
    crearRepoGit,
    eliminarRepoGit,
    commit,
    refrescar,
  } = useRepo(repo);
  // Filas que cruzan Descartadas→Eliminadas: solo UI, se queman y luego
  // se borra el dato. No hay status `eliminadas` en el almacén.
  const [quemas, setQuemas] = useState<{ id: number; uid: string; title: string }[]>([]);
  const quemaSeq = useRef(0);
  const tree = useArbol(ideas, quemas);
  // F1: el log del repo en vivo (cada `EUI_DATABASE` lleva el suyo).
  const { eventos, conectado, limpiar: limpiarLog } = useEventos(repo);
  useEmpujeMapa(eventos, refrescar);

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
        limpiarLog();
        setAvisoRecuperacion("Se cerró la app durante una prueba: el laboratorio quedó vacío.");
      },
      (err: unknown) => {
        setAvisoRecuperacion(
          `Quedó una prueba sin limpiar y no se pudo vaciar: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  }, [repo, puedeProbar, proyeccion?.laboratorio, reiniciar, limpiarLog]);

  useAvisosEventos({ eventos, ideas, error, avisar, ajustes });

  const boardRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const cajonRef = useRef<HTMLElement | null>(null);
  const carrilRefs = useRef<Partial<Record<LaneId, HTMLElement | null>>>({});
  const gitRef = useRef<HTMLElement | null>(null);
  const cambiosRef = useRef<HTMLElement | null>(null);
  const commitsRef = useRef<HTMLElement | null>(null);

  // Lo que tapa el panel derecho. Con los dos paneles abiertos el lienzo se
  // queda en lo que sobra: la cámara encuadra ahí, no debajo del panel.
  const insetDerecha = derechaVisible ? ANCHO_RESUMEN : 0;

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

  const { destelloDe, cableDeChispa } = useDestellos({ chispas, cables });

  const abrir = useCallback(
    (path: string) => {
      olvidar();
      setRepo(path);
      setMapa("items");
      setSeleccion(null);
      setArchivoAbierto(null);
      setSelectorAbierto(false);
    },
    [olvidar, setSeleccion],
  );

  const irGit = useCallback(() => {
    if (gitActivo) setMapa("git");
  }, [gitActivo]);
  const irItems = useCallback(() => setMapa("items"), []);
  const irDocumentos = useCallback(() => setMapa("documentos"), []);
  const irMapa = useCallback(
    (m: MapaLienzo) => {
      switch (m) {
        case "git":
          irGit();
          return;
        case "documentos":
          irDocumentos();
          return;
        case "items":
          irItems();
          return;
        default: {
          const _agotado: never = m;
          void _agotado;
        }
      }
    },
    [irGit, irDocumentos, irItems],
  );

  // Paradas del teclado, en el orden en que se lee el lienzo: la Entrada, los
  // carriles, las ideas, los nudos, los cables y los puentes. En el Mapa de
  // Git: nodo, historial, commits y cambios. En Documentos: el Changelog.
  const paradas = useMemo<Seleccion[]>(() => {
    if (mapa === "git") {
      const cambios = proyeccion?.git_cambios ?? [];
      return [
        { tipo: "git" },
        { tipo: "commits" },
        ...commits.map((commit) => ({ tipo: "commit" as const, hash: commit.hash })),
        ...(cambios.length > 0 ? [{ tipo: "cambios" as const }] : []),
        ...cambios.map((cambio) => ({ tipo: "cambio" as const, ruta: cambio.ruta })),
      ];
    }
    if (mapa === "documentos") {
      return [
        { tipo: "carril", clave: "lane-historial" },
        ...(ideas ?? [])
          .filter((idea) => idea.status === "historial")
          .map((idea) => ({ tipo: "item" as const, uid: idea.uid })),
      ];
    }
    return [
      { tipo: "cajon" },
      ...LANES.filter((lane) => lane.id !== "historial").map((lane) => ({
        tipo: "carril" as const,
        clave: `lane-${lane.id}`,
      })),
      ...(ideas ?? [])
        .filter((idea) => idea.status !== "historial")
        .map((idea) => ({ tipo: "item" as const, uid: idea.uid })),
      ...nudos.map((nudo) => ({ tipo: "nudo" as const, id: nudo.id })),
      ...cables.map((cable) => ({ tipo: "cable" as const, id: cable.id })),
      { tipo: "puente" },
      { tipo: "puente_documentos" },
    ];
  }, [mapa, proyeccion, commits, ideas, nudos, cables]);

  useAtajosLienzo({
    paradas,
    seleccion,
    setSeleccion,
    panel,
    setPanel,
    vistaDerecha,
    setVistaDerecha,
    archivoAbierto,
    setArchivoAbierto,
    ventanaEstrecha,
    setPane,
    gitActivo,
    irGit,
    irDocumentos,
  });

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

  /** Descartadas → Eliminadas: quema visual y luego borrado real. */
  const alEliminar = useCallback(
    async (uid: string) => {
      const idea = ideas?.find((item) => item.uid === uid);
      if (!idea || !sePuedeEliminar(idea.status)) {
        throw new Error("Solo se eliminan ítems que ya están en Descartadas");
      }
      const id = ++quemaSeq.current;
      setQuemas((prev) => [...prev, { id, uid, title: idea.title }]);
      setCerrados((prev) => {
        const next = new Set(prev);
        next.delete("lane-eliminadas");
        return next;
      });
      await new Promise((resolve) => setTimeout(resolve, 1400));
      try {
        await borrar(uid);
      } finally {
        setQuemas((prev) => prev.filter((quema) => quema.id !== id));
      }
    },
    [ideas, borrar],
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

  /* Lo que el lienzo y el panel piden al almacén: una sola forma para los
   *  dos, así una acción nueva no se queda en uno de los lados. */
  const acciones: AccionesLienzo = {
    puedeIr,
    exigeFases,
    exigeFasesListas,
    exigeFasesCompletas,
    onMover: alMover,
    onEditar: editar,
    onBorrar: alEliminar,
    onCargar: cargarIdea,
    onPideEditar: (uid, titulo, descripcion) => setEditando({ uid, titulo, descripcion }),
  };

  /* Frame: topbar, viewport (el graph) y statusbar *abajo*. Dentro del
   *  viewport, la barra de actividad y el pane van antes del lienzo; el panel
   *  de Resumen se superpone al graph. */
  return (
    <div className="shell">
      {actualizacion && <BannerActualizacion actualizacion={actualizacion} />}
      <BarraSuperior
        repo={repo}
        ruta={proyeccion?.repo}
        ocupado={busy || pruebaEnCurso}
        conAjustes={avisar !== undefined}
        puedeProbar={puedeProbar === true}
        laboratorio={proyeccion?.laboratorio === true}
        onCambiar={() => setSelectorAbierto(true)}
        onNuevo={() => setNuevaAbierta(true)}
        onAjustes={() => setAjustesAbiertos(true)}
        onPruebas={() => {
          setSelectorAbierto(false);
          setPruebasAbiertas(true);
          setPruebasMontadas(true);
        }}
      />

      {ajustesAbiertos && (
        <DialogoAjustes
          ajustes={ajustes}
          actualizacion={actualizacion}
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

      {pruebasMontadas && repo && puedeProbar && proyeccion?.laboratorio && (
        <Suspense fallback={null}>
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
              limpiarLog();
            }}
            onCerrar={() => setPruebasAbiertas(false)}
          />
        </Suspense>
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
            onMapa={irMapa}
            onCerrar={() => setPane(null)}
          />
        )}
        {repo && pane === "archivos" && (
          <PaneExplorador
            proyeccion={proyeccion}
            onAbrirArchivo={abrirArchivo}
            onCerrar={() => setPane(null)}
          />
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
            onPointerDown={(e) => {
              mano.onPointerDown(e);
              // El fondo suelta la selección; los nodos y los mandos ya eligen.
              if (!(e.target as Element).closest(".node, .vista")) setSeleccion(null);
            }}
          >
            {error && (
              <p className="aviso-refresco" role="status" title={error}>
                Sin conexión con el core: se reintenta solo. Si cerraste el desktop que lo arrancó, vuelve a abrirlo o lanza <code>eui web</code>.
              </p>
            )}
            {avisoRecuperacion && (
              <p className="aviso-refresco" role="status">
                {avisoRecuperacion}
              </p>
            )}
            {busy && <p className="hint">Cargando…</p>}
            {!busy && ideas?.length === 0 && (
              <p className="hint">Todavía no hay ítems en este repo.</p>
            )}
            {!busy && tree && (
              <div
                key={mapa}
                className={`map mapa-${mapa}`}
                ref={mapRef}
                style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})` }}
              >
                <Lienzo
                  mapa={mapa}
                  tree={tree}
                  ideas={ideas ?? []}
                  commits={commits}
                  cerrados={cerrados}
                  onToggle={toggle}
                  refs={{
                    cajon: cajonRef,
                    carriles: carrilRefs,
                    git: gitRef,
                    cambios: cambiosRef,
                    commits: commitsRef,
                  }}
                  cables={cables}
                  nudos={nudos}
                  rama={rama}
                  chispas={chispas}
                  cableDeChispa={cableDeChispa}
                  seleccion={seleccion}
                  onSeleccionar={seleccionar}
                  paso={paso}
                  animacion={{ volando, pulsos, pulsoCajon, destelloDe }}
                  acciones={acciones}
                  proyeccion={proyeccion}
                  gitActivo={gitActivo}
                  vuelos={vuelos}
                  onAterrizado={aterrizado}
                  vuelosGit={vuelosGit}
                  onAterrizadoGit={aterrizadoGit}
                  onAbrirGit={irGit}
                  onAbrirDocumentos={irDocumentos}
                  onDialogoGit={setDialogoGit}
                />
              </div>
            )}
            {recortado && <AvisoRecorte onEncuadrar={encuadrar} />}
            <Controles vista={vista} onZoom={zoom} onReset={reset} />
            {cables.length > 0 && <LeyendaCompuertas />}
          </section>
        )}
        {repo && <BarraDerecha vista={vistaDerecha} onVista={alternarDerecha} />}
        {repo && derechaVisible && vistaDerecha && (
          <PanelDerecho
            vista={vistaDerecha}
            onVista={setVistaDerecha}
            repo={repo}
            archivoAbierto={archivoAbierto}
            proyeccion={proyeccion}
            commits={commits}
            seleccion={seleccion}
            ideas={ideas ?? []}
            cables={cables}
            nudos={nudos}
            paso={paso}
            acciones={acciones}
            onSeleccionar={seleccionar}
            onAbrirArchivo={abrirArchivo}
            onIgnorarAlmacen={ignorarAlmacen}
            conectado={conectado}
            onClose={() => {
              setVistaDerecha(null);
              setArchivoAbierto(null);
            }}
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

        {proyeccion && <BarraProyeccion proyeccion={proyeccion} />}

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
