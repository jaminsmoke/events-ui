import { useCallback, useEffect, useMemo, useState } from "react";
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

/* ---------- geometría del mapa ----------
 *
 *  Nodos sueltos sobre un lienzo, unidos por cables. Nada de tarjetas que
 *  envuelvan tarjetas: el nivel 1 son dos nodos y el nivel 2 las ideas.
 */

const NODE_W = 200;
const NODE_H = 74;
const STEP_X = 232;
const STEP_Y = 92;

type MapNode = {
  key: string;
  x: number;
  y: number;
  title: string;
  sub: string;
  idea?: Idea;
  lane?: LaneId;
};

function buildMap(repo: string, ideas: Idea[]) {
  const nodes: MapNode[] = [];
  const wires: [string, string][] = [];
  const rootKey = "root";
  const lanes: { y: number }[] = [];
  let cursor = 0;

  for (const lane of LANES) {
    const items = ideas.filter((idea) => laneOf(idea.status) === lane.id);
    // Un carril vacío sigue ocupando sitio: el nodo se queda, sin hijos.
    const count = Math.max(items.length, 1);
    const top = cursor;
    cursor += count * STEP_Y;

    const key = `lane-${lane.id}`;
    const y = top + ((count - 1) * STEP_Y) / 2;
    lanes.push({ y });
    nodes.push({
      key,
      x: STEP_X,
      y,
      title: lane.title,
      sub: `${items.length} ${items.length === 1 ? "idea" : "ideas"}`,
      lane: lane.id,
    });
    wires.push([rootKey, key]);

    items.forEach((idea, index) => {
      nodes.push({
        key: idea.uid,
        x: STEP_X * 2,
        y: top + index * STEP_Y,
        title: idea.title,
        sub: idea.description,
        idea,
      });
      wires.push([key, idea.uid]);
    });
  }

  // La raíz se centra sobre sus hijos: el mapa crece hacia la derecha desde ella.
  const first = lanes[0];
  const last = lanes[lanes.length - 1];
  const rootY = first && last ? (first.y + last.y) / 2 : 0;
  nodes.push({
    key: rootKey,
    x: 0,
    y: rootY,
    title: folderName(repo),
    sub: `${ideas.length} ${ideas.length === 1 ? "idea" : "ideas"}`,
  });

  return { nodes, wires, width: STEP_X * 2 + NODE_W, height: Math.max(cursor, NODE_H) };
}

/** Cable de un nodo a otro: sale por la derecha y entra por la izquierda. */
function wirePath(from: MapNode, to: MapNode): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
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
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // Una sola ruta de carga: cambiar `repo` dispara la petición. Los `setState` van
  // en las continuaciones async, nunca en el cuerpo del efecto, para no encadenar
  // renders; el abort cancela la petición anterior si se cambia de repo rápido.
  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();

    fetch(`/api/ideas?repo=${encodeURIComponent(repo)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          // El core siembra el almacén si falta; un 404 aquí es que la carpeta no
          // existe, y su `detail` dice cuál.
          const body = (await res.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(body?.detail ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as Idea[];
      })
      .then((list) => {
        setIdeas(list);
        setError(null);
        localStorage.setItem(STORAGE_KEY, repo);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setIdeas([]);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => controller.abort();
  }, [repo]);

  const abrir = useCallback((path: string) => {
    setIdeas(null);
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

  const busy = repo !== null && ideas === null && error === null;
  const map = useMemo(() => (repo ? buildMap(repo, ideas ?? []) : null), [repo, ideas]);
  const byKey = new Map<string, MapNode>((map?.nodes ?? []).map((node) => [node.key, node]));

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
          {!busy && map && (
            <div className="map" style={{ width: map.width, height: map.height }}>
              <svg className="wires" width={map.width} height={map.height} aria-hidden="true">
                {map.wires.map(([from, to]) => {
                  const a = byKey.get(from);
                  const b = byKey.get(to);
                  return a && b ? (
                    <path key={`${from}->${to}`} d={wirePath(a, b)} className="wire" />
                  ) : null;
                })}
              </svg>
              {map.nodes.map((node) => (
                <div
                  key={node.key}
                  className={`node${node.idea ? "" : " hub"}${
                    node.lane ? ` lane-${node.lane}` : ""
                  }`}
                  style={{ left: node.x, top: node.y }}
                >
                  <span className="node-title">{node.title}</span>
                  {node.sub && <span className="node-sub">{node.sub}</span>}
                  {node.idea && (
                    <span className="node-meta mono">
                      {node.idea.kind} · {node.idea.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
