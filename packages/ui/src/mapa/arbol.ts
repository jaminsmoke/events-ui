import type { Connection, Idea } from "../core/api";
import { LANES, laneOf } from "./carriles";
import type { LaneId } from "./carriles";

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
 *  Plegar y desplegar cambia solo lo que se ve; mover, crear, editar y
 *  borrar ideas entra por la API, nunca tocando el árbol a mano.
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
  const carrilPorUid = new Map(ideas.map((idea) => [idea.uid, laneOf(idea.status)]));

  const hijos = new Map<string, string[]>();
  const conPadre = new Set<string>();
  for (const link of links) {
    if (link.kind !== "child") continue;
    const carrilPadre = carrilPorUid.get(link.parent_uid);
    // Si cambian de carril por separado, cada idea se ve en el suyo.
    if (!carrilPadre || carrilPadre !== carrilPorUid.get(link.child_uid)) continue;
    const lista = hijos.get(link.parent_uid) ?? [];
    lista.push(link.child_uid);
    hijos.set(link.parent_uid, lista);
    conPadre.add(link.child_uid);
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

    return {
      key: uid,
      title: idea.title,
      total: kids.length,
      kids,
      idea,
    };
  };

  // El cajón: todas las ideas, planas. Aquí entra todo, aún sin carril.
  const cajon: TreeNode = {
    key: "ideas",
    title: "Ideas",
    total: ideas.length,
    kids: ideas.map((idea) => ({ key: idea.uid, title: idea.title, total: 0, kids: [], idea })),
    tone: "root",
  };

  const carriles: TreeNode[] = LANES.map((lane) => {
    const items = ideas.filter((idea) => carrilPorUid.get(idea.uid) === lane.id);
    const kids = items
      .filter((idea) => !conPadre.has(idea.uid))
      .map((idea) => rama(idea.uid, new Set()))
      .filter((nodo): nodo is TreeNode => nodo !== null);

    return { key: `lane-${lane.id}`, title: lane.title, total: items.length, kids, tone: lane.id };
  });

  return { cajon, carriles };
}
