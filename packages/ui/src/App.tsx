import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./core/api";

import { cargarAjustes, guardarAjustes } from "./core/avisos";
import type { Ajustes } from "./core/avisos";
import { medidaMarco } from "./core/marco";
import { STORAGE_KEY, storedRepo } from "./core/repo";
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
import { useArbolMapa } from "./mapa/useArbolMapa";
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
import { NuevoItem } from "./pantalla/NuevoItem";
import { SelectorRepo } from "./pantalla/SelectorRepo";
import { AvisoRecorte, Controles } from "./pantalla/Controles";
import { EditorItem } from "./pantalla/EditorItem";
import { PanelLog } from "./pantalla/PanelLog";
import { PanelDerecho } from "./pantalla/PanelDerecho";
import type { PruebasInyectadas } from "./pantalla/pruebasInyectadas";
import { useVentanaEstrecha } from "./pantalla/useVentanaEstrecha";


/* *  El mapa: se pliega, se encuadra y se mueve; el almacén se toca solo por
 *  la API del core (crear, mover, editar y borrar items).
 *
 *  `elegirCarpeta` lo inyecta el envoltorio que tenga diálogo nativo (Tauri);
 *  la web no lo pasa. El selector es el mismo en las dos: explorador de
 *  `/fs`, lista de `/repos` y ruta manual; el diálogo nativo es una acción
 *  extra de desktop.
 *  `avisar`, igual: solo lo inyecta desktop (notificaciones del sistema) y
 *  con él aparece el botón de Ajustes; sin él no hay avisos que ajustar.
 *  `pruebas` solo lo inyecta desktop: el lanzador del laboratorio vive en su
 *  envoltorio y aquí solo se conoce la frontera. Sin él no hay botón. */
export default function App({
  elegirCarpeta,
  avisar,
  pruebas,
  actualizacion,
}: {
  elegirCarpeta?: ElegirCarpeta;
  avisar?: (titulo: string, cuerpo: string) => void;
  pruebas?: PruebasInyectadas;
  actualizacion?: Actualizacion;
}) {
  const PanelPruebas = pruebas?.componente;
  const [repo, setRepo] = useState<string | null>(storedRepo);
  const repoRef = useRef(repo);
  useEffect(() => {
    repoRef.current = repo;
  }, [repo]);
  // La carpeta elegida se recuerda una vez por repo, también al arrancar con
  // una ya guardada. La guarda evita el doble efecto de StrictMode y los
  // eventos del SSE: `config.json` no es un latido.
  const persistido = useRef<string | null>(null);
  useEffect(() => {
    if (!repo || persistido.current === repo) return;
    persistido.current = repo;
    try {
      localStorage.setItem(STORAGE_KEY, repo);
    } catch {
      // Recordar la carpeta es opcional.
    }
    void api.PUT("/config", { body: { repo } }).catch(() => {
      // El core la volverá a recibir la próxima vez que se elija.
    });
  }, [repo]);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [falloAccion, setFalloAccion] = useState<string | null>(null);
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());
  const [ajustes, setAjustes] = useState<Ajustes>(cargarAjustes);
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [pruebaEnCurso, setPruebaEnCurso] = useState(false);
  const [pruebasAbiertas, setPruebasAbiertas] = useState(false);
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
    items,
    error,
    proyeccion,
    commits,
    crear,
    mover,
    editar,
    borrar,
    cargarItem,
    ignorarAlmacen,
    reiniciar,
    crearRepoGit,
    eliminarRepoGit,
    commit,
    refrescar,
  } = useRepo(repo);
  // Filas que cruzan Descartadas→Eliminadas: solo UI, se queman y luego
  // se borra el dato. No hay status `eliminadas` en el almacén.
  const [quemas, setQuemas] = useState<
    { id: number; repo: string; uid: string; title: string }[]
  >([]);
  const quemaSeq = useRef(0);
  // El filtro se memoriza: `useArbolMapa` y `useCables` dependen de la
  // identidad de `quemas`; un array nuevo por render rehacía el árbol y
  // volvía a medir los cables en cada fotograma.
  const quemasDelRepo = useMemo(
    () => quemas.filter((quema) => quema.repo === repo),
    [quemas, repo],
  );
  const tree = useArbolMapa(items, quemasDelRepo);
  // F1: el log del repo en vivo (cada `EUI_DATABASE` lleva el suyo).
  const { eventos, conectado, limpiar: limpiarLog } = useEventos(repo);
  useEmpujeMapa(eventos, refrescar);

  // Los protocolos de flujo: las uniones permitidas entre carriles. La fila
  // no ofrece traslados prohibidos; el core los rechaza si llegan igual.
  const { puedeIr, exigeFases, exigeFasesListas, exigeFasesCompletas, paso } = useProtocolos(repo);

  useAvisosEventos({ eventos, items, error, avisar, ajustes });

  const boardRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const cajonRef = useRef<HTMLElement | null>(null);
  const carrilRefs = useRef<Partial<Record<LaneId, HTMLElement | null>>>({});
  const gitRef = useRef<HTMLElement | null>(null);
  const cambiosRef = useRef<HTMLElement | null>(null);
  const commitsRef = useRef<HTMLElement | null>(null);

  // Lo que tapa el panel derecho, leído de `--ancho-resumen` (marco.css): el
  // panel va encima del lienzo, así que la cámara descuenta lo que tapa.
  const [anchoResumen] = useState(() => medidaMarco("--ancho-resumen"));
  const insetDerecha = derechaVisible ? anchoResumen : 0;

  const { vista, completo, arrastrando, encuadrarCompleto, zoom, reset, olvidar, mano } = useCamara({
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
  const { vuelos, volando, aterrizado } = useVuelos({ repo, mapa, items, cerrados, vista, mapRef });
  const { filas: vuelosGit, aterrizado: aterrizadoGit } = useVueloCommit({
    repo,
    proyeccion,
    vista,
    mapRef,
    cambiosRef,
    commitsRef,
  });
  const { chispas, pulsos, pulsoCajon } = useAnimaciones(repo, items);

  const { destelloDe, cableDeChispa } = useDestellos({ chispas, cables });
  const animacion = useMemo(
    () => ({ volando, pulsos, pulsoCajon, destelloDe }),
    [volando, pulsos, pulsoCajon, destelloDe],
  );

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
  // carriles, los ítems, los nudos, los cables y los puentes. En el Mapa de
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
        ...(items ?? [])
          .filter((item) => item.status === "historial")
          .map((item) => ({ tipo: "item" as const, uid: item.uid })),
      ];
    }
    return [
      { tipo: "cajon" },
      ...LANES.filter((lane) => lane.id !== "historial").map((lane) => ({
        tipo: "carril" as const,
        clave: `lane-${lane.id}`,
      })),
      ...(items ?? [])
        .filter((item) => item.status !== "historial")
        .map((item) => ({ tipo: "item" as const, uid: item.uid })),
      ...nudos.map((nudo) => ({ tipo: "nudo" as const, id: nudo.id })),
      ...cables.map((cable) => ({ tipo: "cable" as const, id: cable.id })),
      { tipo: "puente" },
      { tipo: "puente_documentos" },
    ];
  }, [mapa, proyeccion, commits, items, nudos, cables]);

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
      const item = items?.find((item) => item.uid === uid);
      if (!item || !sePuedeEliminar(item.status)) {
        throw new Error("Solo se eliminan ítems que ya están en Descartadas");
      }
      const id = ++quemaSeq.current;
      const repoAlBorrar = repo;
      if (!repoAlBorrar) throw new Error("Sin repo no se puede borrar");
      setQuemas((prev) => [...prev, { id, repo: repoAlBorrar, uid, title: item.title }]);
      setCerrados((prev) => {
        const next = new Set(prev);
        next.delete("lane-eliminadas");
        return next;
      });
      await new Promise((resolve) => setTimeout(resolve, 1400));
      try {
        // La espera es de la animación: si mientras tanto se cambió de
        // carpeta, el cierre capturado no puede borrar en el repo viejo.
        if (repoRef.current === repoAlBorrar) await borrar(uid);
      } finally {
        setQuemas((prev) => prev.filter((quema) => quema.id !== id));
      }
    },
    [repo, items, borrar],
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
  const busy = repo !== null && items === null && error === null;

  const pedirEdicion = useCallback(
    (uid: string, titulo: string, descripcion: string) =>
      setEditando({ uid, titulo, descripcion }),
    [],
  );
  /* Lo que el lienzo y el panel piden al almacén: una sola forma para los
   *  dos, así una acción nueva no se queda en uno de los lados. Memorizado:
   *  es prop de `Lienzo` y no puede cambiar por un movimiento de cámara. */
  const acciones = useMemo<AccionesLienzo>(
    () => ({
      puedeIr,
      exigeFases,
      exigeFasesListas,
      exigeFasesCompletas,
      onMover: alMover,
      onEditar: editar,
      onBorrar: alEliminar,
      onCargar: cargarItem,
      onPideEditar: pedirEdicion,
    }),
    [
      puedeIr,
      exigeFases,
      exigeFasesListas,
      exigeFasesCompletas,
      alMover,
      editar,
      alEliminar,
      cargarItem,
      pedirEdicion,
    ],
  );

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
        puedeProbar={PanelPruebas !== undefined}
        laboratorio={proyeccion?.laboratorio === true}
        onCambiar={() => setSelectorAbierto(true)}
        onNuevo={() => setNuevaAbierta(true)}
        onAjustes={() => setAjustesAbiertos(true)}
        onPruebas={() => {
          setSelectorAbierto(false);
          setPruebasAbiertas(true);
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
          <NuevoItem onCrear={crear} onCerrar={() => setNuevaAbierta(false)} />
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
        <EditorItem
          titulo={editando.titulo}
          descripcion={editando.descripcion}
          onCargar={() => cargarItem(editando.uid)}
          onGuardar={(cambios) => editar(editando.uid, cambios)}
          onCerrar={() => setEditando(null)}
        />
      )}

      {PanelPruebas && repo && proyeccion?.laboratorio && (
        <PanelPruebas
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
          onAviso={setAvisoRecuperacion}
          onCerrar={() => setPruebasAbiertas(false)}
        />
      )}

      {falloAccion && <AvisoError mensaje={falloAccion} />}

      {error && !items && <AvisoError mensaje={error} />}

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
        {repo && (!error || items) && (
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
            {!busy && items?.length === 0 && (
              <p className="hint">Todavía no hay ítems en este repo.</p>
            )}
            {!busy && tree && (
              <div
                key={mapa}
                className={`map mapa-${mapa}${completo ? " vista-completa" : ""}`}
                ref={mapRef}
                style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})` }}
              >
                <Lienzo
                  mapa={mapa}
                  tree={tree}
                  items={items ?? []}
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
                  animacion={animacion}
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
            {recortado && <AvisoRecorte onEncuadrar={encuadrarCompleto} />}
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
            items={items ?? []}
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
