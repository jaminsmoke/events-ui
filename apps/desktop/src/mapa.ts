import type { Connection, Idea } from "./api";

export type Status = Idea["status"];

/** Los dos carriles del nivel siguiente.
 *
 *  No son tablas: son una vista sobre `ideas.status`. `rejected`/`superseded`
 *  cierran la rama; el resto sigue en cola. Un carril de verdad solo hará falta
 *  cuando las columnas sean datos (nombre, orden, por repo), no dos constantes.
 */
export const LANES = [
  { id: "cola", title: "En cola" },
  { id: "descartadas", title: "Descartadas" },
] as const;

export type LaneId = (typeof LANES)[number]["id"];

export function laneOf(status: Status): LaneId {
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
export type Tree = { cajon: TreeNode; carriles: TreeNode[] };

export type TreeNode = {
  key: string;
  title: string;
  /** Ideas que hay por debajo: todas las del repo, las del carril, o las sub-ideas. */
  total: number;
  kids: TreeNode[];
  idea?: Idea;
  tone?: "root" | LaneId;
};

export function buildTree(ideas: Idea[], links: Connection[]): Tree {
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

/** Un cable del cajón a un carril, ya medido en píxeles del mapa. */
export type Cable = { lane: LaneId; d: string; x1: number; y1: number };

/** Rectángulo relativo al mapa: lo que un vuelo necesita para saber de dónde a dónde. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Una fila cruzando de un carril al otro. */
export type Vuelo = {
  id: number;
  uid: string;
  title: string;
  from: Rect;
  to: Rect;
  lane: LaneId;
  /** Sin fila de destino —carril plegado—: la copia se desvanece al llegar. */
  funde: boolean;
};
