import { useEffect, useState } from "react";

import { getJson } from "./api";
import type { Connection, Idea, Revision } from "./api";
import { STORAGE_KEY } from "./repo";

const SIN_CABLES: Connection[] = [];

/** Lo cargado pertenece a *un* repo: si se cambia de carpeta, lo viejo deja de
 *  valer al instante en vez de pintarse un frame con el árbol anterior. */
type Cargado = { repo: string; ideas: Idea[]; links: Connection[] };
type Fallo = { repo: string; mensaje: string };

/** Ideas y conexiones del repo, refrescadas solas.
 *
 *  El refresco no es un watcher de ficheros: se pregunta `GET /revision`, cuya
 *  firma sale de `PRAGMA data_version` del almacén. Si cambia, se relee todo.
 *  Cada 2 s y solo mientras haya repo abierto. */
export function useRepo(repo: string | null) {
  const [cargado, setCargado] = useState<Cargado | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);

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
        .then(([ideas, links]) => {
          setCargado({ repo, ideas, links });
          setFallo(null);
          localStorage.setItem(STORAGE_KEY, repo);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setFallo({ repo, mensaje: err instanceof Error ? err.message : String(err) });
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

  const fresco = cargado && cargado.repo === repo ? cargado : null;

  return {
    // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
    ideas: fresco ? fresco.ideas : null,
    links: fresco ? fresco.links : SIN_CABLES,
    error: fallo && fallo.repo === repo ? fallo.mensaje : null,
  };
}
