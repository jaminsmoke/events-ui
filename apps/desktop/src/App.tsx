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

/* ---------- geometría del mapa ----------
 *
 *  Nodos sueltos sobre un lienzo, unidos por cables. Nada de tarjetas que
 *  envuelvan tarjetas: el primer nivel es `Ideas`, el segundo los dos carriles
 *  y de ahí cuelgan las ideas.
 *
 *  Es un **visor**: aquí no se arrastra, ni se crea, ni se borra nada. El mapa
 *  solo refleja lo que ya hay en el almacén del repo, y todo lo demás entra por
 *  la API desde fuera. El proyecto no es un nodo: vive en la barra de arriba.
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

function buildMap(ideas: Idea[], links: Connection[]) {
  const nodes: MapNode[] = [];
  const wires: [string, string][] = [];
  const byUid = new Map(ideas.map((idea) => [idea.uid, idea]));

  const hijos = new Map<string, string[]>();
  for (const link of links) {
    if (link.kind !== "child") continue;
    const lista = hijos.get(link.parent_uid) ?? [];
    lista.push(link.child_uid);
    hijos.set(link.parent_uid, lista);
  }
  // Quien tiene padre en `connections` se dibuja colgando de él, no del carril.
  const conPadre = new Set(links.filter((link) => link.kind === "child").map((l) => l.child_uid));

  const centros = new Map<string, number>();
  let cursor = 0;
  let columnas = 2;

  /* Coloca una idea y su descendencia; devuelve el centro vertical de su rama.
   * Los hijos se colocan primero y el padre queda centrado sobre ellos. `camino`
   * corta los ciclos: una idea repetida devuelve su centro y no se pinta dos veces. */
  const colocar = (uid: string, columna: number, camino: ReadonlySet<string>): number => {
    const conocido = centros.get(uid);
    if (conocido !== undefined) return conocido;

    const idea = byUid.get(uid);
    if (!idea) return cursor; // conexión huérfana: la FK ya lo impide, pero no se pinta

    const siguiente: ReadonlySet<string> = new Set([...camino, uid]);
    const kids = (hijos.get(uid) ?? []).filter((kid) => !camino.has(kid));

    let centro: number;
    if (kids.length === 0) {
      centro = cursor + STEP_Y / 2;
      cursor += STEP_Y;
    } else {
      const centrosKids = kids.map((kid) => colocar(kid, columna + 1, siguiente));
      const arriba = centrosKids[0];
      const abajo = centrosKids[centrosKids.length - 1];
      centro = arriba !== undefined && abajo !== undefined ? (arriba + abajo) / 2 : 0;
    }

    columnas = Math.max(columnas, columna + 1);
    centros.set(uid, centro);
    nodes.push({
      key: uid,
      x: columna * STEP_X,
      y: centro - NODE_H / 2,
      title: idea.title,
      sub: idea.description,
      idea,
    });
    for (const kid of kids) wires.push([uid, kid]);
    return centro;
  };

  const centrosCarril: number[] = [];
  for (const lane of LANES) {
    const items = ideas.filter((idea) => laneOf(idea.status) === lane.id);
    // Quien ya cuelga de otra idea no vuelve a nacer en el carril: se dibuja en
    // su columna, debajo de su padre. Si no, los dos acaban en la misma x.
    const raices = items.filter((idea) => !conPadre.has(idea.uid));
    const centrosIdeas = raices.map((idea) => colocar(idea.uid, 2, new Set()));

    // Un carril vacío sigue ocupando sitio: el nodo se queda, sin hijos.
    let centro: number;
    const primero = centrosIdeas[0];
    const ultimo = centrosIdeas[centrosIdeas.length - 1];
    if (primero !== undefined && ultimo !== undefined) {
      centro = (primero + ultimo) / 2;
    } else {
      centro = cursor + STEP_Y / 2;
      cursor += STEP_Y;
    }
    centrosCarril.push(centro);

    const key = `lane-${lane.id}`;
    nodes.push({
      key,
      x: STEP_X,
      y: centro - NODE_H / 2,
      title: lane.title,
      sub: `${items.length} ${items.length === 1 ? "idea" : "ideas"}`,
      lane: lane.id,
    });
    wires.push(["root", key]);
    for (const idea of raices) wires.push([key, idea.uid]);
  }

  // `Ideas` es la raíz del tablero, no el proyecto: la carpeta se lee arriba.
  const first = centrosCarril[0];
  const last = centrosCarril[centrosCarril.length - 1];
  const raiz = first !== undefined && last !== undefined ? (first + last) / 2 : 0;
  nodes.push({
    key: "root",
    x: 0,
    y: raiz - NODE_H / 2,
    title: "Ideas",
    sub: `${ideas.length} ${ideas.length === 1 ? "idea" : "ideas"}`,
  });

  // `columnas` es el índice siguiente: el ancho sale del último nodo, no de la
  // columna que aún no existe (dejaba 232px muertos a la derecha).
  return {
    nodes,
    wires,
    width: (columnas - 1) * STEP_X + NODE_W,
    height: Math.max(cursor, NODE_H),
  };
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

  const busy = repo !== null && ideas === null && error === null;
  const map = useMemo(
    () => (repo ? buildMap(ideas ?? [], links) : null),
    [repo, ideas, links],
  );
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
