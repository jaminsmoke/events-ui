import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "./core/api";

import { medidaMarco } from "./core/marco";
import { storedRepo } from "./core/repo";
import type { ElegirCarpeta } from "./core/repo";
import type { Actualizacion } from "./core/actualizacion";
import { useRepo } from "./core/useRepo";
import { useAnimaciones } from "./mapa/animaciones";
import { useAtajosLienzo } from "./mapa/atajos";
import { useCables } from "./mapa/cables";
import { LeyendaCompuertas } from "./mapa/compuertas";
import { useCamara } from "./mapa/camara";
import type { LaneId } from "./modelo/carriles";
import { Lienzo } from "./mapa/Lienzo";
import { paradasDe } from "./mapa/paradas";
import { useVueloCommit } from "./mapa/vuelos-git";
import { useVuelos } from "./mapa/vuelos";
import { useArbolMapa } from "./mapa/useArbolMapa";
import { useDestellos } from "./mapa/useDestellos";
import { useSeleccion } from "./mapa/useSeleccion";
import { useAccionesItems } from "./core/useAccionesItems";
import { useEventos } from "./core/useEventos";
import { useEmpujeMapa } from "./core/useEmpujeMapa";
import { usePersistirRepo } from "./core/usePersistirRepo";
import { useProtocolos } from "./core/useProtocolos";
import { usePuertas } from "./core/usePuertas";
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
 *  Sin avisos del sistema: los eventos ya se ven en el log y en el mapa.
 *  `pruebas` solo lo inyecta desktop: el lanzador del laboratorio vive en su
 *  envoltorio y aquí solo se conoce la frontera. Sin él no hay botón. */
export default function App({
  elegirCarpeta,
  pruebas,
  actualizacion,
}: {
  elegirCarpeta?: ElegirCarpeta;
  pruebas?: PruebasInyectadas;
  actualizacion?: Actualizacion;
}) {
  const PanelPruebas = pruebas?.componente;
  const [repo, setRepo] = useState<string | null>(storedRepo);
  // La carpeta se recuerda y se manda al core una vez por repo; el SSE puede
  // repintar `App` sin repetir el PUT (ver `usePersistirRepo`).
  usePersistirRepo(repo, (r) => api.PUT("/config", { body: { repo: r } }));
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [pruebaEnCurso, setPruebaEnCurso] = useState(false);
  const [pruebasAbiertas, setPruebasAbiertas] = useState(false);
  // Tres mapas enlazados: trabajo, Git y Documentos (Changelog). El puente
  // de Git solo abre con work tree; el de Documentos siempre.
  const [mapa, setMapa] = useState<MapaLienzo>("items");
  // Crear o eliminar el repo local: no se hace al pulsar, hay confirmación.
  const [dialogoGit, setDialogoGit] = useState<null | "crear" | "eliminar">(null);
  const [avisoRecuperacion, setAvisoRecuperacion] = useState<string | null>(null);
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

  // F1: el log del repo en vivo (cada `EUI_DATABASE` lleva el suyo).
  const { eventos, conectado, limpiar: limpiarLog } = useEventos(repo);
  useEmpujeMapa(eventos, refrescar);

  // Los protocolos de flujo: las uniones permitidas entre carriles. La fila
  // no ofrece traslados prohibidos; el core los rechaza si llegan igual.
  const { puedeIr, exigeFases, exigeFasesListas, exigeFasesCompletas, paso } = useProtocolos(repo);
  // Las puertas son del repo: se piden aquí una vez, no cada vez que se abre
  // el panel derecho.
  const { puertas, error: falloPuertas } = usePuertas(repo);

  // Descartadas→Eliminadas despliega el carril: la quema se ve al borrar.
  const desplegarEliminadas = useCallback(() => {
    setCerrados((prev) => {
      const next = new Set(prev);
      next.delete("lane-eliminadas");
      return next;
    });
  }, []);

  // Mover, borrar y editar ítems: una sola forma para el lienzo y el panel.
  const { acciones, falloAccion, editando, cerrarEdicion, quemasDelRepo } = useAccionesItems({
    repo,
    items,
    puedeIr,
    exigeFases,
    exigeFasesListas,
    exigeFasesCompletas,
    mover,
    editar,
    borrar,
    cargarItem,
    expandirEliminadas: desplegarEliminadas,
  });

  // Las quemas ya filtradas por repo: si el array cambiara de identidad en
  // cada render, el árbol y los cables se volverían a medir cada fotograma.
  const tree = useArbolMapa(items, quemasDelRepo);

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

  const { vista, completo, compacto, arrastrando, encuadrarCompleto, zoom, reset, olvidar, mano } =
    useCamara({
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

  // Las paradas del teclado, en el orden en que se lee el lienzo: la regla
  // vive en `mapa/paradas` y aquí solo se recalcula cuando cambia el mapa.
  const paradas = useMemo(
    () => paradasDe({ mapa, proyeccion, commits, items, nudos, cables }),
    [mapa, proyeccion, commits, items, nudos, cables],
  );

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
        conAjustes={actualizacion !== undefined}
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

      {ajustesAbiertos && actualizacion && (
        <DialogoAjustes
          actualizacion={actualizacion}
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
          onCerrar={cerrarEdicion}
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
                className={`map mapa-${mapa}${completo ? " vista-completa" : ""}${
                  compacto ? " texto-compacto" : ""
                }`}
                ref={mapRef}
                style={
                  {
                    transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})`,
                    "--texto": compacto ? 4 / 3 : 1,
                  } as CSSProperties
                }
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
            puertas={puertas}
            falloPuertas={falloPuertas}
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
