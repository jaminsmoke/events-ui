import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open as openFolder } from "@tauri-apps/plugin-dialog";

import { folderName, getJson, isTauri, STORAGE_KEY, storedRepo } from "./api";
import type { Connection, Idea, Revision } from "./api";
import { useCamara, ZOOM_MAX, ZOOM_MIN, ZOOM_PASO } from "./camara";
import { buildTree, laneOf, LANES } from "./mapa";
import type { Cable, LaneId, Rect, Vuelo } from "./mapa";
import { NodeBox, VueloFila } from "./nodos";

export default function App() {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [links, setLinks] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());

  const cajonRef = useRef<HTMLElement | null>(null);
  const carrilRefs = useRef<(HTMLElement | null)[]>([]);

  const [cables, setCables] = useState<Cable[]>([]);
  const [chispas, setChispas] = useState<{ lane: LaneId; id: number }[]>([]);
  const [pulsos, setPulsos] = useState<{ lane: LaneId; id: number }[]>([]);
  const [vuelos, setVuelos] = useState<Vuelo[]>([]);
  const [recortado, setRecortado] = useState(false);
  const totalesPrevios = useRef(new Map<LaneId, number>());
  const carrilesPrevios = useRef(new Map<string, LaneId>());
  const rects = useRef(new Map<string, Rect>());

  const tree = useMemo(
    () => (repo ? buildTree(ideas ?? [], links) : null),
    [repo, ideas, links],
  );

  const boardRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const { vista, arrastrando, encuadrar, zoom, reset, olvidar, mano } = useCamara({
    repo,
    listo: tree !== null,
    boardRef,
    mapRef,
  });

  // Carga inicial + vigilancia del `PRAGMA data_version` del almacén del repo.
  // Los `setState` van en continuaciones async, nunca en el cuerpo del efecto;
  // el abort cancela lo pendiente si se cambia de repo a mitad.
  //
  // El core siembra el almacén si falta; un 404 aquí es que la carpeta no existe.
  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();
    const q = `repo=${encodeURIComponent(repo)}`;
    let firma: string | null = null;

    const cargar = () => {
      Promise.all([
        getJson<Idea[]>(`/api/ideas?${q}`, controller.signal),
        getJson<Connection[]>(`/api/connections?${q}`, controller.signal),
      ])
        .then(([list, enlaces]) => {
          setIdeas(list);
          setLinks(enlaces);
          setError(null);
          localStorage.setItem(STORAGE_KEY, repo);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setIdeas([]);
          setError(err instanceof Error ? err.message : String(err));
        });
    };

    const vigilar = () => {
      getJson<Revision>(`/api/revision?${q}`, controller.signal)
        .then((rev) => {
          const actual = `${rev.data_version}/${rev.ideas}/${rev.connections}`;
          if (firma === null) {
            firma = actual;
            return;
          }
          if (actual !== firma) {
            firma = actual;
            cargar();
          }
        })
        .catch(() => {
          // Core reiniciándose o repo movido: se reintenta en el siguiente tick.
        });
    };

    cargar();
    vigilar();
    const timer = setInterval(vigilar, 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [repo]);

  const abrir = useCallback(
    (path: string) => {
      setIdeas(null);
      setLinks([]);
      setError(null);
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

  // Solo se oculta la fila del carril de destino: la del cajón no se mueve.
  const volando = useCallback(
    (uid: string, nodo: string) => vuelos.some((v) => v.uid === uid && v.lane === nodo),
    [vuelos],
  );

  const aterrizado = useCallback((id: number) => {
    setVuelos((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const toggle = useCallback((key: string) => {
    setCerrados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  // Los cables se miden del DOM: los nodos crecen al desplegarse y nada es fijo.
  useLayoutEffect(() => {
    const map = mapRef.current;
    const cajon = cajonRef.current;
    if (!map || !cajon) return;

    // Todo se mide en coordenadas locales del mapa: el `scale` del lienzo no
    // puede contarse dos veces al dibujar los cables.
    const k = vista.k;
    const medir = () => {
      const caja = map.getBoundingClientRect();
      const a = cajon.getBoundingClientRect();
      const x1 = (a.right - caja.left) / k;
      const y1 = (a.top - caja.top) / k + a.height / k / 2;

      const trazos: Cable[] = [];
      carrilRefs.current.forEach((el, i) => {
        const lane = LANES[i];
        if (!el || !lane) return;
        const b = el.getBoundingClientRect();
        const x2 = (b.left - caja.left) / k;
        const y2 = (b.top - caja.top) / k + b.height / k / 2;
        const medio = (x1 + x2) / 2;
        trazos.push({
          lane: lane.id,
          x1,
          y1,
          d: `M ${x1} ${y1} C ${medio} ${y1}, ${medio} ${y2}, ${x2} ${y2}`,
        });
      });
      setCables(trazos);

      // ¿Queda algo fuera del lienzo? Entonces se ofrece reencuadrar.
      const vistaMapa = map.getBoundingClientRect();
      const hueco = boardRef.current?.getBoundingClientRect();
      setRecortado(
        hueco
          ? vistaMapa.left < hueco.left - 1 ||
              vistaMapa.right > hueco.right + 1 ||
              vistaMapa.top < hueco.top - 1 ||
              vistaMapa.bottom > hueco.bottom + 1
          : false,
      );
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(cajon);
    // El lienzo también: al encoger la ventana puede empezar a recortar sin que
    // cambie ni la vista ni el árbol.
    if (boardRef.current) ro.observe(boardRef.current);
    for (const el of carrilRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [tree, cerrados, vista]);

  /* El vuelo: si una idea cambia de carril, su fila no aparece de golpe en el
   * nodo nuevo — se va volando desde donde estaba, y el destino la espera
   * oculta hasta que aterriza. El dato llega en un instante; el viaje no. */
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map || !ideas) return;

    const k = vista.k;
    const caja = map.getBoundingClientRect();
    const ahora = new Map<string, Rect>();
    for (const fila of map.querySelectorAll<HTMLElement>(".row[data-uid]")) {
      const uid = fila.dataset.uid;
      const nodo = fila.dataset.nodo;
      // El cajón no vuela: sus filas no son origen ni destino de nada.
      if (!uid || !nodo || nodo === "root") continue;
      const r = fila.getBoundingClientRect();
      ahora.set(`${nodo}:${uid}`, {
        x: (r.left - caja.left) / k,
        y: (r.top - caja.top) / k,
        w: r.width / k,
        h: r.height / k,
      });
    }

    /* Con el carril plegado no hay fila que medir: el vuelo arranca o aterriza
     * en la cabecera del nodo, que es lo único que se ve de él. */
    const cabecera = (lane: LaneId): Rect | undefined => {
      const el = map.querySelector<HTMLElement>(`.node.lane-${lane}`);
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - caja.left) / k + 8,
        y: (r.top - caja.top) / k + 6,
        w: Math.max(80, r.width / k - 16),
        h: 20,
      };
    };

    const carriles = new Map(ideas.map((idea) => [idea.uid, laneOf(idea.status)]));
    const nuevos: Vuelo[] = [];
    let n = 0;
    for (const [uid, lane] of carriles) {
      const antes = carrilesPrevios.current.get(uid);
      if (!antes || antes === lane) continue;

      const desde = rects.current.get(`${antes}:${uid}`) ?? cabecera(antes);
      const fila = ahora.get(`${lane}:${uid}`);
      const hasta = fila ?? cabecera(lane);
      if (!desde || !hasta) continue;

      nuevos.push({
        id: Date.now() + n++,
        uid,
        title: ideas.find((idea) => idea.uid === uid)?.title ?? "",
        from: desde,
        to: hasta,
        lane,
        funde: fila === undefined,
      });
    }

    carrilesPrevios.current = carriles;
    rects.current = ahora;
    if (nuevos.length === 0) return;

    // En un frame: este efecto solo mide y compara, y el estado del vuelo no
    // puede entrar en cascada con el render que acaba de pintar las filas.
    const raf = requestAnimationFrame(() => setVuelos((prev) => [...prev, ...nuevos]));
    return () => cancelAnimationFrame(raf);
  }, [ideas, vista]);

  /* El cambio en el almacén es instantáneo; la animación no. Cuando un carril
   * cambia de tamaño, una chispa recorre su cable para que se vea llegar, y si
   * además ha recibido una idea, su contador da un golpe. */
  useEffect(() => {
    if (!tree) return;
    const nuevas: { lane: LaneId; id: number }[] = [];
    const suben: LaneId[] = [];
    for (const lane of tree.carriles) {
      const id = lane.tone;
      if (id !== "cola" && id !== "descartadas") continue;
      const antes = totalesPrevios.current.get(id);
      if (antes !== undefined && antes !== lane.total) {
        nuevas.push({ lane: id, id: Date.now() + Math.random() });
        if (lane.total > antes) suben.push(id);
      }
      totalesPrevios.current.set(id, lane.total);
    }
    if (nuevas.length === 0) return;

    // En un frame, no en el cuerpo del efecto: las animaciones no pueden entrar
    // en cascada con el render que acaba de pintar las filas.
    const raf = requestAnimationFrame(() => {
      setChispas((prev) => [...prev, ...nuevas]);
      if (suben.length > 0) {
        const sello = Date.now();
        setPulsos((prev) => [...prev, ...suben.map((lane, i) => ({ lane, id: sello + i }))]);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [tree]);

  // Cada chispa vive lo que dura su animación.
  useEffect(() => {
    if (chispas.length === 0) return;
    const timer = setTimeout(() => setChispas([]), 1150);
    return () => clearTimeout(timer);
  }, [chispas]);

  // El pulso del contador también es un golpe breve, no un estado.
  useEffect(() => {
    if (pulsos.length === 0) return;
    const timer = setTimeout(() => setPulsos([]), 1000);
    return () => clearTimeout(timer);
  }, [pulsos]);

  return (
    <main className="shell">
      <header>
        <h1>Events UI</h1>
        {/* Una sola entrada al selector: en vacío lo lleva el hero de abajo, así
            que la barra solo aparece cuando ya hay repo elegido. */}
        {repo && (
          <div className="repo-bar">
            <span className="repo-name">{folderName(repo)}</span>
            <span className="repo-path mono">{repo}</span>
            <button className="btn ghost" onClick={() => void pick()} disabled={busy}>
              Cambiar
            </button>
          </div>
        )}
      </header>

      {!repo && (
        <section className="card hero">
          {isTauri ? (
            <button className="btn" onClick={() => void pick()}>
              Elegir carpeta…
            </button>
          ) : (
            <form
              className="manual"
              onSubmit={(e) => {
                e.preventDefault();
                const path = manual.trim();
                if (path) abrir(path);
              }}
            >
              <input
                className="mono"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="C:\ruta\al\repo"
                spellCheck={false}
              />
              <button className="btn" type="submit">
                Abrir
              </button>
            </form>
          )}
          <p className="hint">
            {isTauri
              ? "Se abre la última carpeta al arrancar. La primera vez sembramos dentro .EUI/EUI_DATABASE.sqlite."
              : "En el navegador no hay diálogo nativo: pega la ruta. La ventana de Tauri sí lo tiene."}
          </p>
        </section>
      )}

      {error && (
        <section className="card bad">
          <h2>No se pudo leer el repo</h2>
          <p className="mono">{error}</p>
          <p className="hint">
            ¿Está el core en marcha? Arráncalo con <code>corepack pnpm core:dev</code>.
          </p>
        </section>
      )}

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

          {/* Si el esquema no cabe, se dice y se ofrece encuadrarlo. */}
          {recortado && (
            <button type="button" className="aviso-recorte" onClick={encuadrar}>
              Hay esquema fuera de la vista · Encuadrar
            </button>
          )}

          {/* Nivel de cámara y vuelta atrás: el lienzo se puede perder de vista. */}
          <div className="vista">
            <button
              type="button"
              className="btn ghost vista-flecha"
              aria-label="Alejar"
              disabled={vista.k <= ZOOM_MIN}
              onClick={() => zoom(1 / ZOOM_PASO)}
            >
              −
            </button>
            <span className="vista-nivel">{Math.round(vista.k * 100)}%</span>
            <button
              type="button"
              className="btn ghost vista-flecha"
              aria-label="Acercar"
              disabled={vista.k >= ZOOM_MAX}
              onClick={() => zoom(ZOOM_PASO)}
            >
              +
            </button>
            <button type="button" className="btn ghost" title="Volver al 100% y centrar" onClick={reset}>
              100%
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
