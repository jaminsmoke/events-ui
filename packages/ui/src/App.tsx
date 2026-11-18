import { useCallback, useMemo, useRef, useState } from "react";

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
import { AvisoError } from "./pantalla/AvisoError";
import { BarraRepo } from "./pantalla/BarraRepo";
import { Bienvenida } from "./pantalla/Bienvenida";
import { NuevaIdea } from "./pantalla/NuevaIdea";
import { SelectorRepo } from "./pantalla/SelectorRepo";
import { AvisoRecorte, Controles } from "./pantalla/Controles";

/** El mapa: un visor. Se pliega, se encuadra y se mueve; el almacén solo se
 *  toca por la API del core.
 *
 *  `elegirCarpeta` lo inyecta el envoltorio que tenga diálogo nativo (Tauri);
 *  la web no lo pasa y el selector ofrece lista de `/repos` y ruta manual. */
export default function App({ elegirCarpeta }: { elegirCarpeta?: ElegirCarpeta }) {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [falloAccion, setFalloAccion] = useState<string | null>(null);
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());

  const { ideas, links, error, crear, mover, editar, borrar, conectar } = useRepo(repo);
  const tree = useMemo(
    () => (ideas ? buildTree(ideas, links) : null),
    [ideas, links],
  );

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
  const { cables, recortado } = useCables({
    tree,
    cerrados,
    vista,
    boardRef,
    mapRef,
    cajonRef,
    carrilRefs,
  });
  const { vuelos, volando, aterrizado } = useVuelos({ repo, ideas, cerrados, vista, mapRef });
  const { chispas, pulsos } = useAnimaciones(repo, ideas);

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
      </header>

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
                onEditar={editar}
                onBorrar={borrar}
                onConectar={conectar}
                ideas={ideas ?? []}
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
                    onEditar={editar}
                    onBorrar={borrar}
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
