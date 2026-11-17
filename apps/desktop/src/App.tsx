import { useCallback, useMemo, useRef, useState } from "react";
import { open as openFolder } from "@tauri-apps/plugin-dialog";

import { isTauri, storedRepo } from "./core/repo";
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
import { AvisoRecorte, Controles } from "./pantalla/Controles";

/** El mapa: un visor. Se pliega, se encuadra y se mueve; el almacén solo se
 *  toca por la API del core. */
export default function App() {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());

  const { ideas, links, error } = useRepo(repo);
  const tree = useMemo(
    () => (repo ? buildTree(ideas ?? [], links) : null),
    [repo, ideas, links],
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
  const { vuelos, volando, aterrizado } = useVuelos({ ideas, vista, mapRef });
  const { chispas, pulsos } = useAnimaciones(tree);

  const abrir = useCallback(
    (path: string) => {
      olvidar();
      setRepo(path);
    },
    [olvidar],
  );

  const pick = useCallback(async () => {
    if (!isTauri) return;
    const dir = await openFolder({
      directory: true,
      multiple: false,
      title: "Elige la carpeta del repositorio",
    });
    if (typeof dir === "string") abrir(dir);
  }, [abrir]);

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
        {repo && <BarraRepo repo={repo} ocupado={busy} onCambiar={() => void pick()} />}
      </header>

      {!repo && <Bienvenida onElegir={() => void pick()} onAbrir={abrir} />}

      {error && <AvisoError mensaje={error} />}

      {repo && !error && (
        <section
          className={`board${arrastrando ? " arrastrando" : ""}`}
          ref={boardRef}
          {...mano}
        >
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
                    pulsa={pulsos.some((pulso) => pulso.lane === lane.tone)}
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
