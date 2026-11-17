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

/** Rectángulo relativo al mapa: lo que un vuelo necesita para saber de dónde a dónde. */
type Rect = { x: number; y: number; w: number; h: number };

/** Una fila cruzando de un carril al otro. */
type Vuelo = {
  id: number;
  uid: string;
  title: string;
  from: Rect;
  to: Rect;
  lane: LaneId;
  /** Sin fila de destino —carril plegado—: la copia se desvanece al llegar. */
  funde: boolean;
};

/** Un nodo entero: cabecera plegable y, debajo, su propia lista. */
function NodeBox({
  node,
  cerrados,
  onToggle,
  boxRef,
  volando,
  pulsa,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
  volando: (uid: string, nodo: string) => boolean;
  pulsa?: boolean;
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
        <span className={`count${pulsa ? " pulso" : ""}`}>{node.total}</span>
        {tiene ? <Arrow open={abierto} /> : <span className="arrow" />}
      </button>

      {abierto && (
        <div className="node-body">
          {node.kids.map((kid) => (
            <NodeRow
              key={kid.key}
              node={kid}
              cerrados={cerrados}
              onToggle={onToggle}
              nodo={node.tone ?? "ideas"}
              volando={volando}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** La copia que viaja: sale del rectángulo viejo y aterriza en el nuevo. */
function VueloFila({
  vuelo,
  onDone,
}: {
  vuelo: Vuelo;
  onDone: (id: number) => void;
}) {
  const [enVuelo, setEnVuelo] = useState(false);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setEnVuelo(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const dx = vuelo.to.x - vuelo.from.x;
  const dy = vuelo.to.y - vuelo.from.y;

  return (
    <div
      className={`vuelo ${vuelo.lane}${vuelo.funde ? " funde" : ""}`}
      style={{
        left: vuelo.from.x,
        top: vuelo.from.y,
        width: vuelo.from.w,
        height: vuelo.from.h,
        transform: enVuelo ? `translate(${dx}px, ${dy}px)` : "none",
        opacity: enVuelo && vuelo.funde ? 0 : 1,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "transform") onDone(vuelo.id);
      }}
    >
      <span className="dot" />
      <span className="vuelo-title">{vuelo.title}</span>
    </div>
  );
}

/** Una fila del nodo: título, contador y, si tiene items, su propia flecha. */
function NodeRow({
  node,
  cerrados,
  onToggle,
  nodo,
  volando,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  nodo: string;
  volando: (uid: string, nodo: string) => boolean;
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);
  const uid = node.idea?.uid;

  return (
    <div
      className={`row${node.tone ? ` lane-${node.tone}` : ""}${
        uid && volando(uid, nodo) ? " volando" : ""
      }`}
      data-uid={uid}
      data-nodo={nodo}
    >
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
            <NodeRow
              key={kid.key}
              node={kid}
              cerrados={cerrados}
              onToggle={onToggle}
              nodo={nodo}
              volando={volando}
            />
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

/** Zoom del lienzo: ni una miniatura ilegible ni un nodo que no cabe. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_PASO = 1.08;

const acotar = (valor: number, min: number, max: number) =>
  Math.min(max, Math.max(min, valor));

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
  const [pulsos, setPulsos] = useState<{ lane: LaneId; id: number }[]>([]);
  const [vuelos, setVuelos] = useState<Vuelo[]>([]);
  const carrilesPrevios = useRef(new Map<string, LaneId>());
  const rects = useRef(new Map<string, Rect>());

  // Vista del lienzo: solo mueve la cámara. Los nodos no se tocan.
  const boardRef = useRef<HTMLElement | null>(null);
  const [vista, setVista] = useState({ x: 0, y: 0, k: 1 });
  const [arrastrando, setArrastrando] = useState(false);
  const agarre = useRef<{ x: number; y: number } | null>(null);
  const encuadrado = useRef<string | null>(null);
  // ¿La cámara la movió el usuario? Entonces al redimensionar no se toca.
  const movida = useRef(false);

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
    encuadrado.current = null; // repo nuevo, encuadre nuevo
    movida.current = false;
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

  // Solo se oculta la fila del carril de destino: la del cajón no se mueve.
  const volando = useCallback(
    (uid: string, nodo: string) => vuelos.some((v) => v.uid === uid && v.lane === nodo),
    [vuelos],
  );

  const aterrizado = useCallback((id: number) => {
    setVuelos((prev) => prev.filter((v) => v.id !== id));
  }, []);

  // Zoom desde los botones: se ancla en el centro del mapa, no en el cursor.
  const zoom = useCallback((factor: number) => {
    movida.current = true;
    setVista((v) => {
      const k = acotar(v.k * factor, ZOOM_MIN, ZOOM_MAX);
      if (k === v.k) return v;
      const caja = mapRef.current?.getBoundingClientRect();
      if (!caja) return { ...v, k };
      const lx = caja.width / v.k / 2;
      const ly = caja.height / v.k / 2;
      return { x: v.x + lx * (v.k - k), y: v.y + ly * (v.k - k), k };
    });
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
  const tree = useMemo(
    () => (repo ? buildTree(ideas ?? [], links) : null),
    [repo, ideas, links],
  );

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
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(cajon);
    for (const el of carrilRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [tree, cerrados, vista.k]);

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
  }, [ideas, vista.k]);

  // Rueda: acerca y aleja sobre el punto donde está el cursor, no sobre el
  // centro. Escucha nativa porque React registra `wheel` como pasivo y no deja
  // cancelar el desplazamiento de la página.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const rueda = (e: WheelEvent) => {
      const caja = mapRef.current?.getBoundingClientRect();
      if (!caja || !e.deltaY) return;
      e.preventDefault();

      movida.current = true;
      setVista((v) => {
        const k = acotar(v.k * (e.deltaY < 0 ? ZOOM_PASO : 1 / ZOOM_PASO), ZOOM_MIN, ZOOM_MAX);
        if (k === v.k) return v;
        // El punto local bajo el cursor se queda bajo el cursor.
        const lx = (e.clientX - caja.left) / v.k;
        const ly = (e.clientY - caja.top) / v.k;
        return { x: v.x + lx * (v.k - k), y: v.y + ly * (v.k - k), k };
      });
    };

    board.addEventListener("wheel", rueda, { passive: false });
    return () => board.removeEventListener("wheel", rueda);
  }, []);

  /* Encuadrar: que el esquema quepa entero y centrado. Se mide con `offsetWidth`
   * y `clientWidth`, que no llevan el transform encima, así el cálculo vale con
   * cualquier zoom y no depende de la vista actual. */
  const encuadrar = useCallback(() => {
    const board = boardRef.current;
    const map = mapRef.current;
    if (!board || !map) return;

    const ancho = map.offsetWidth;
    const alto = map.offsetHeight;
    if (!ancho || !alto) return;

    const k = acotar(
      Math.min((board.clientWidth - 64) / ancho, (board.clientHeight - 120) / alto),
      ZOOM_MIN,
      1,
    );
    setVista({
      x: (board.clientWidth - ancho * k) / 2 - map.offsetLeft,
      y: (board.clientHeight - alto * k) / 2 - map.offsetTop,
      k,
    });
  }, []);

  /* Bienvenida: al abrir un repo se encuadra una vez. Después manda el ratón. */
  useLayoutEffect(() => {
    if (!tree || !repo || encuadrado.current === repo) return;
    if (!boardRef.current || !mapRef.current) return;
    encuadrado.current = repo;
    const raf = requestAnimationFrame(encuadrar);
    return () => cancelAnimationFrame(raf);
  }, [repo, tree, encuadrar]);

  /* Si cambia el tamaño de la ventana se vuelve a encuadrar, salvo que el usuario
   * haya movido la cámara: entonces su vista manda y solo se recoloca el layout,
   * que va centrado por flex. */
  useEffect(() => {
    const alRedimensionar = () => {
      if (!movida.current) encuadrar();
    };
    window.addEventListener("resize", alRedimensionar);
    return () => window.removeEventListener("resize", alRedimensionar);
  }, [encuadrar]);

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
          onPointerDown={(e) => {
            // Arrastrar solo desde el fondo: sobre un nodo no se mueve nada.
            if (e.button !== 0 || (e.target as HTMLElement).closest(".node, .vista")) return;
            agarre.current = { x: e.clientX, y: e.clientY };
            movida.current = true;
            setArrastrando(true);
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Puntero sintético (pruebas): seguimos sin capturar.
            }
          }}
          onPointerMove={(e) => {
            const desde = agarre.current;
            if (!desde) return;
            const dx = e.clientX - desde.x;
            const dy = e.clientY - desde.y;
            agarre.current = { x: e.clientX, y: e.clientY };
            setVista((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
          }}
          onPointerUp={() => {
            agarre.current = null;
            setArrastrando(false);
          }}
          onPointerCancel={() => {
            agarre.current = null;
            setArrastrando(false);
          }}
          onDoubleClick={() => {
            movida.current = true;
            setVista({ x: 0, y: 0, k: 1 });
          }}
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
            <button
              type="button"
              className="btn ghost"
              title="Volver al 100% y centrar"
              onClick={() => {
                movida.current = true;
                setVista({ x: 0, y: 0, k: 1 });
              }}
            >
              100%
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
