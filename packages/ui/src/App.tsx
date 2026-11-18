import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { avisaErrores, avisaEventos, cargarAjustes, guardarAjustes } from "./core/avisos";
import type { Ajustes } from "./core/avisos";
import { storedRepo } from "./core/repo";
import type { ElegirCarpeta } from "./core/repo";
import { useRepo } from "./core/useRepo";
import { useAnimaciones } from "./mapa/animaciones";
import { buildTree } from "./mapa/arbol";
import { useCables } from "./mapa/cables";
import { useCamara } from "./mapa/camara";
import type { LaneId } from "./mapa/carriles";
import { NodeBox, VueloFila } from "./mapa/nodos";
import { useVuelos } from "./mapa/vuelos";
import { useEventos, resumenEvento } from "./core/useEventos";
import { Ajustes as DialogoAjustes } from "./pantalla/Ajustes";
import { AvisoError } from "./pantalla/AvisoError";
import { BarraRepo } from "./pantalla/BarraRepo";
import { Bienvenida } from "./pantalla/Bienvenida";
import { NuevaIdea } from "./pantalla/NuevaIdea";
import { SelectorRepo } from "./pantalla/SelectorRepo";
import { AvisoRecorte, Controles } from "./pantalla/Controles";

/** El mapa: se pliega, se encuadra y se mueve; el almacén se toca solo por
 *  la API del core (crear, mover, editar, borrar y conectar ideas).
 *
 *  `elegirCarpeta` lo inyecta el envoltorio que tenga diálogo nativo (Tauri);
 *  la web no lo pasa y el selector ofrece lista de `/repos` y ruta manual.
 *  `avisar`, igual: solo lo inyecta desktop (notificaciones del sistema) y
 *  con él aparece el botón de Ajustes; sin él no hay avisos que ajustar. */
export default function App({
  elegirCarpeta,
  avisar,
}: {
  elegirCarpeta?: ElegirCarpeta;
  avisar?: (titulo: string, cuerpo: string) => void;
}) {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [falloAccion, setFalloAccion] = useState<string | null>(null);
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());
  const [ajustes, setAjustes] = useState<Ajustes>(cargarAjustes);
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);

  const {
    ideas,
    links,
    error,
    proyeccion,
    crear,
    mover,
    editar,
    borrar,
    conectar,
    desconectar,
    cargarIdea,
  } = useRepo(repo);
  const tree = useMemo(
    () => (ideas ? buildTree(ideas, links) : null),
    [ideas, links],
  );
  // F1: el log del repo en vivo (cada `EUI_DATABASE` lleva el suyo).
  const { eventos, conectado } = useEventos(repo);

  // Avisos del sistema (F3): solo eventos *nuevos* (ids por encima del último
  // visto) y solo si el usuario lo quiere ver; el primer lote del SSE es el
  // historial y nunca avisa. Con `soloFondo`, mirar la ventana silencia todo.
  const ultimoEvento = useRef<number | null>(null);
  useEffect(() => {
    if (!avisar || eventos.length === 0) return;
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

  // Mover entre carriles es cambiar el `status` (PATCH tipado): `rejected`
  // cierra la rama, `draft` la devuelve a En cola. El sondeo de `/revision`
  // relee el mapa y el vuelo existente anima la fila.
  const alMover = useCallback(
    (uid: string, lane: "cola" | "descartadas") => {
      setFalloAccion(null);
      void mover(uid, lane === "descartadas" ? "rejected" : "draft").catch((err: unknown) => {
        setFalloAccion(err instanceof Error ? err.message : String(err));
      });
    },
    [mover],
  );

  // Completar es `accepted`: el pulso verde sale solo del diff de estados.
  const alCompletar = useCallback(
    (uid: string) => {
      setFalloAccion(null);
      void mover(uid, "accepted").catch((err: unknown) => {
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
      if (lane.tone === "cola" || lane.tone === "descartadas") totales.set(lane.tone, lane.total);
    }
    return totales;
  }, [tree]);
  const maximo = Math.max(1, ...volumen.values());

  return (
    <main className="shell">
      <header>
        <h1>Events UI</h1>
        {/* Una sola entrada al selector: en vacío lo lleva el hero de abajo, así
            que la barra solo aparece cuando ya hay repo elegido. */}
        {repo && (
          <BarraRepo repo={repo} ocupado={busy} onCambiar={() => setSelectorAbierto(true)} />
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

      {falloAccion && <AvisoError mensaje={falloAccion} />}

      {proyeccion && (
        <section className="card proyeccion" aria-label="Estado del repo">
          <h2>Repo</h2>
          <p className="proyeccion-linea">
            <strong>{proyeccion.repo}</strong>
            {proyeccion.branch && (
              <em>
                {' '}
                {proyeccion.branch}
                {proyeccion.commit ? ` · ${proyeccion.commit}` : ""}
              </em>
            )}
          </p>
          <p className="hint">
            {proyeccion.ideas} ideas · {proyeccion.connections} conexiones · {proyeccion.events}{" "}
            eventos
            {Object.entries(proyeccion.por_estado).map(([estado, n]) => (
              <span key={estado}>
                {" · "}
                {estado}: {n}
              </span>
            ))}
            {proyeccion.ultima_actividad && <span> · última: {proyeccion.ultima_actividad}</span>}
          </p>
        </section>
      )}

      <section className="card eventos" aria-label="Actividad del log">
        <h2>
          Actividad {conectado && <span className="dot" aria-label="en vivo" />}
        </h2>
        {eventos.length === 0 ? (
          <p className="hint">Sin eventos todavía. El log se lee, no se escribe.</p>
        ) : (
          <ul className="eventos-lista">
            {eventos.map((e) => (
              <li key={e.id}>
                <strong>#{e.id}</strong> {resumenEvento(e)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && !ideas && <AvisoError mensaje={error} />}

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

              <NodeBox
                node={tree.cajon}
                cerrados={cerrados}
                onToggle={toggle}
                boxRef={cajonRef}
                volando={volando}
                pulso={pulsoCajon}
                onCompletar={alCompletar}
                onEditar={editar}
                onBorrar={borrar}
                onConectar={conectar}
                onDesconectar={desconectar}
                onCargarIdea={cargarIdea}
                ideas={ideas ?? []}
                enlacesNuevos={enlacesNuevos}
              />

              <div className="lanes">
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
                    onCompletar={alCompletar}
                    onEditar={editar}
                    onBorrar={borrar}
                    onDesconectar={desconectar}
                    onCargarIdea={cargarIdea}
                    enlacesNuevos={enlacesNuevos}
                  />
                ))}
              </div>
            </div>
          )}

          {recortado && <AvisoRecorte onEncuadrar={encuadrar} />}

          <Controles vista={vista} onZoom={zoom} onReset={reset} />
        </section>
      )}
    </main>
  );
}
