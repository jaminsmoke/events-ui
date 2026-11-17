import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "react";
import { open as openFolder } from "@tauri-apps/plugin-dialog";

/** Espejo de GET /ideas del core. El contrato definitivo se generará desde
 *  OpenAPI; esto cubre solo lo que la UI consume ya. */
type Idea = {
  uid: string;
  title: string;
  description: string;
  content: string;
  kind: "idea" | "adr" | "note";
  status: "draft" | "proposed" | "accepted" | "rejected" | "superseded";
  tags: string[];
  created_at: string;
  updated_at: string;
};

/** Espejo de GET /connections: qué idea cuelga de cuál. */
type Connection = {
  id: number;
  parent_uid: string;
  child_uid: string;
  kind: "child" | "related" | "supersedes";
  created_at: string;
};

/** Espejo de GET /revision: firma del almacén para el refresco en vivo. */
type Revision = {
  data_version: number;
  ideas: number;
  connections: number;
};

type Status = Idea["status"];

/** Los dos carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `ideas.status`. `rejected`/`superseded`
 *  cierran la rama; el resto sigue en cola. Un carril de verdad solo hará falta
 *  cuando las columnas sean datos (nombre, orden, por repo), no dos constantes.
 */
const LANES = [
  { id: "cola", title: "En cola" },
  { id: "descartadas", title: "Descartadas" },
] as const;

type LaneId = (typeof LANES)[number]["id"];

function laneOf(status: Status): LaneId {
  return status === "rejected" || status === "superseded" ? "descartadas" : "cola";
}

/* ---------- el nodo, estilo Unreal ----------
 *
 *  El nodo es compacto: una cabecera con el título, un contador y una flecha.
 *  Cuando tiene items, la flecha los despliega **dentro** del nodo como filas,
 *  igual que un nodo de Unreal enseña sus opciones. Nada de un nodo por item ni
 *  de tarjetas dentro de tarjetas.
 *
 *  Tres nodos: `Ideas` es el cajón donde entran todas, y para bajar de nivel hay
 *  que pasar por la disyuntiva de carriles. `En cola` y `Descartadas` son nodos
 *  aparte, cada uno con su lista.
 *
 *  Es un **visor**: plegar y desplegar cambia lo que se ve, nunca el almacén.
 *  Aquí no se mueve, ni se crea, ni se borra nada; eso entra por la API.
 */

/** Lo que se pinta: el cajón con todas las ideas y la disyuntiva de carriles. */
type Tree = { cajon: TreeNode; carriles: TreeNode[] };

type TreeNode = {
  key: string;
  title: string;
  /** Ideas que hay por debajo: todas las del repo, las del carril, o las sub-ideas. */
  total: number;
  kids: TreeNode[];
  idea?: Idea;
  tone?: "root" | LaneId;
};

function buildTree(ideas: Idea[], links: Connection[]): Tree {
  const byUid = new Map(ideas.map((idea) => [idea.uid, idea]));

  const hijos = new Map<string, string[]>();
  for (const link of links) {
    if (link.kind !== "child") continue;
    const lista = hijos.get(link.parent_uid) ?? [];
    lista.push(link.child_uid);
    hijos.set(link.parent_uid, lista);
  }

  /* Una idea y lo que cuelga de ella. `camino` corta los ciclos: la API ya los
   * rechaza, pero una conexión repetida no puede colgar el render. */
  const rama = (uid: string, camino: ReadonlySet<string>): TreeNode | null => {
    const idea = byUid.get(uid);
    if (!idea || camino.has(uid)) return null;

    const siguiente: ReadonlySet<string> = new Set([...camino, uid]);
    const kids = (hijos.get(uid) ?? [])
      .map((kid) => rama(kid, siguiente))
      .filter((nodo): nodo is TreeNode => nodo !== null);

    return { key: uid, title: idea.title, total: kids.length, kids, idea };
  };

  // El cajón: todas las ideas, planas. Aquí entra todo, aún sin carril.
  const cajon: TreeNode = {
    key: "ideas",
    title: "Ideas",
    total: ideas.length,
    kids: ideas.map((idea) => ({ key: idea.uid, title: idea.title, total: 0, kids: [], idea })),
    tone: "root",
  };

  // Quien tiene padre en `connections` se dibuja dentro de él, no en el carril.
  const conPadre = new Set(links.filter((link) => link.kind === "child").map((l) => l.child_uid));

  const carriles: TreeNode[] = LANES.map((lane) => {
    const items = ideas.filter((idea) => laneOf(idea.status) === lane.id);
    const kids = items
      .filter((idea) => !conPadre.has(idea.uid))
      .map((idea) => rama(idea.uid, new Set()))
      .filter((nodo): nodo is TreeNode => nodo !== null);

    return { key: `lane-${lane.id}`, title: lane.title, total: items.length, kids, tone: lane.id };
  });

  return { cajon, carriles };
}

/** Flecha de plegado. Vacía si el nodo no tiene items. */
function Arrow({ open }: { open: boolean }) {
  return <span className="arrow">{open ? "▾" : "▸"}</span>;
}

/** Un cable del cajón a un carril, ya medido en píxeles del mapa. */
type Cable = { lane: LaneId; d: string; x1: number; y1: number };

/** Un nodo entero: cabecera plegable y, debajo, su propia lista. */
function NodeBox({
  node,
  cerrados,
  onToggle,
  boxRef,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);

  return (
    <section ref={boxRef} className={`node${node.tone ? ` lane-${node.tone}` : ""}`}>
      <button
        type="button"
        className="node-head"
        onClick={() => onToggle(node.key)}
        aria-expanded={tiene ? abierto : undefined}
      >
        <span className="node-title">{node.title}</span>
        <span className="count">{node.total}</span>
        {tiene ? <Arrow open={abierto} /> : <span className="arrow" />}
      </button>

      {abierto && (
        <div className="node-body">
          {node.kids.map((kid) => (
            <NodeRow key={kid.key} node={kid} cerrados={cerrados} onToggle={onToggle} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Una fila del nodo: título, contador y, si tiene items, su propia flecha. */
function NodeRow({
  node,
  cerrados,
  onToggle,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);

  return (
    <div className={`row${node.tone ? ` lane-${node.tone}` : ""}`}>
      <button
        type="button"
        className="row-head"
        onClick={() => tiene && onToggle(node.key)}
        aria-expanded={tiene ? abierto : undefined}
        title={node.idea?.description || undefined}
      >
        {node.idea && <span className={`dot status-${node.idea.status}`} />}
        <span className="row-title">{node.title}</span>
        {node.total > 0 && <span className="count">{node.total}</span>}
        {tiene && <Arrow open={abierto} />}
      </button>

      {abierto && (
        <div className="row-kids">
          {node.kids.map((kid) => (
            <NodeRow key={kid.key} node={kid} cerrados={cerrados} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

/** GET tipado: si el core responde 404/400, el `detail` del core es el mensaje. */
async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const STORAGE_KEY = "eui.repo";

/** En `dev:ui` (navegador) no hay Tauri, así que no hay diálogo nativo. */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Última carpeta usada. Es solo comodidad de arranque: la verdad está en el repo. */
function storedRepo(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // navegador sin storage
  }
}

export default function App() {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [links, setLinks] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  // Lo plegado, no lo abierto: por defecto el flujo se ve entero.
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(() => new Set());

  const mapRef = useRef<HTMLDivElement | null>(null);
  const cajonRef = useRef<HTMLElement | null>(null);
  const carrilRefs = useRef<(HTMLElement | null)[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [chispas, setChispas] = useState<{ lane: LaneId; id: number }[]>([]);
  const totalesPrevios = useRef(new Map<LaneId, number>());

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

  const abrir = useCallback((path: string) => {
    setIdeas(null);
    setLinks([]);
    setError(null);
    setRepo(path);
  }, []);

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

  const busy = repo !== null && ideas === null && error === null;
  const tree = useMemo(
    () => (repo ? buildTree(ideas ?? [], links) : null),
    [repo, ideas, links],
  );

  // Los cables se miden del DOM: los nodos crecen al desplegarse y nada es fijo.
  useLayoutEffect(() => {
    const map = mapRef.current;
    const cajon = cajonRef.current;
    if (!map || !cajon) return;

    const medir = () => {
      const caja = map.getBoundingClientRect();
      const a = cajon.getBoundingClientRect();
      const x1 = a.right - caja.left;
      const y1 = a.top - caja.top + a.height / 2;

      const trazos: Cable[] = [];
      carrilRefs.current.forEach((el, i) => {
        const lane = LANES[i];
        if (!el || !lane) return;
        const b = el.getBoundingClientRect();
        const x2 = b.left - caja.left;
        const y2 = b.top - caja.top + b.height / 2;
        const medio = (x1 + x2) / 2;
        trazos.push({
          lane: lane.id,
          x1,
          y1,
          d: `M ${x1} ${y1} C ${medio} ${y1}, ${medio} ${y2}, ${x2} ${y2}`,
        });
      });
      setCables(trazos);
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(cajon);
    for (const el of carrilRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [tree, cerrados]);

  /* El cambio en el almacén es instantáneo; la animación no. Cuando un carril
   * cambia de tamaño, una chispa recorre su cable para que se vea llegar. */
  useEffect(() => {
    if (!tree) return;
    const nuevas: { lane: LaneId; id: number }[] = [];
    for (const lane of tree.carriles) {
      const id = lane.tone;
      if (id !== "cola" && id !== "descartadas") continue;
      const antes = totalesPrevios.current.get(id);
      if (antes !== undefined && antes !== lane.total) {
        nuevas.push({ lane: id, id: Date.now() + Math.random() });
      }
      totalesPrevios.current.set(id, lane.total);
    }
    if (nuevas.length === 0) return;

    // En un frame, no en el cuerpo del efecto: la chispa no puede entrar en
    // cascada con el render que acaba de pintar las filas.
    const raf = requestAnimationFrame(() => setChispas((prev) => [...prev, ...nuevas]));
    return () => cancelAnimationFrame(raf);
  }, [tree]);

  // Cada chispa vive lo que dura su animación.
  useEffect(() => {
    if (chispas.length === 0) return;
    const timer = setTimeout(() => setChispas([]), 900);
    return () => clearTimeout(timer);
  }, [chispas]);

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
        <section className="board">
          {busy && <p className="hint">Cargando…</p>}
          {!busy && ideas?.length === 0 && (
            <p className="hint">Todavía no hay ideas en este repo.</p>
          )}
          {!busy && tree && (
            <div className="map" ref={mapRef}>
              <svg className="cables" aria-hidden="true">
                {cables.map((cable) => (
                  <path key={cable.lane} d={cable.d} className={`wire ${cable.lane}`} />
                ))}
                {cables[0] && (
                  <circle className="junction" cx={cables[0].x1} cy={cables[0].y1} r={4} />
                )}
                {chispas.map((chispa) => {
                  const cable = cables.find((c) => c.lane === chispa.lane);
                  return cable ? (
                    <circle key={chispa.id} r={3.5} className={`spark ${chispa.lane}`}>
                      <animateMotion dur="0.6s" path={cable.d} fill="freeze" />
                    </circle>
                  ) : null;
                })}
              </svg>

              <NodeBox
                node={tree.cajon}
                cerrados={cerrados}
                onToggle={toggle}
                boxRef={cajonRef}
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
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
