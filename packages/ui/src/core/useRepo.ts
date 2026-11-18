import { useCallback, useEffect, useState } from "react";

import { api, unwrap } from "./api";
import type { Connection, IdeaCreate, IdeaUpdate, Mapa, ProyeccionRepo } from "./api";
import { STORAGE_KEY } from "./repo";

const SIN_CABLES: Connection[] = [];

/** Lo cargado pertenece a *un* repo: si se cambia de carpeta, lo viejo deja de
 *  valer al instante en vez de pintarse un frame con el árbol anterior. */
type Cargado = { repo: string; mapa: Mapa };
type Fallo = { repo: string; mensaje: string };

/** Ideas y conexiones del repo, refrescadas solas.
 *
 *  El refresco no es un watcher de ficheros: se pregunta `GET /revision`, cuya
 *  firma sale de `PRAGMA data_version` del almacén. Si cambia, se relee el mapa.
 *  Se esperan 2 s entre intentos para que las lecturas no se solapen. */
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
    let firma: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const vigilar = async () => {
      try {
        const rev = await unwrap(api.GET("/revision", { params: { query: { repo } }, signal: controller.signal }));
        if (controller.signal.aborted) return;
        const actual = `${rev.instance}/${rev.data_version}/${rev.ideas}/${rev.connections}`;
        if (actual !== firma) {
          const mapa: Mapa = await unwrap(api.GET("/mapa", { params: { query: { repo } }, signal: controller.signal }));
          if (controller.signal.aborted) return;
          if (firma === null) {
            try {
              localStorage.setItem(STORAGE_KEY, repo);
            } catch {
              // Recordar la carpeta es opcional.
            }
          }
          setCargado({ repo, mapa });
          firma = actual;
        }
        setFallo(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setFallo({ repo, mensaje: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(vigilar, 2000);
      }
    };

    void vigilar();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [repo]);

  // Escrituras por la API tipada: no hace falta refrescar a mano, el sondeo
  // de `/revision` ve el cambio (`data_version` sube) y relee el mapa solo.
  const crear = useCallback(
    async (body: IdeaCreate) => {
      if (!repo) return;
      await unwrap(api.POST("/ideas", { params: { query: { repo } }, body }));
    },
    [repo],
  );

  const mover = useCallback(
    async (uid: string, status: IdeaCreate["status"]) => {
      if (!repo) return;
      await unwrap(
        api.PATCH("/ideas/{uid}", { params: { path: { uid }, query: { repo } }, body: { status } }),
      );
    },
    [repo],
  );

  // La idea completa (`kind`, `tags`…): el mapa no los trae, así que el
  // editor de la fila la pide al abrirse.
  const cargarIdea = useCallback(
    async (uid: string) => {
      if (!repo) return null;
      return unwrap(
        api.GET("/ideas/{uid}", { params: { path: { uid }, query: { repo } } }),
      );
    },
    [repo],
  );

  const editar = useCallback(
    async (uid: string, cambios: IdeaUpdate) => {
      if (!repo) return;
      await unwrap(api.PATCH("/ideas/{uid}", { params: { path: { uid }, query: { repo } }, body: cambios }));
    },
    [repo],
  );

  const borrar = useCallback(
    async (uid: string) => {
      if (!repo) return;
      await unwrap(api.DELETE("/ideas/{uid}", { params: { path: { uid }, query: { repo } } }));
    },
    [repo],
  );

  // Cuelga `child` de `parent` (`kind: "child"`): el core rechaza ciclos y
  // duplicados con 400, que `unwrap` convierte en el `detail` del core.
  const conectar = useCallback(
    async (parentUid: string, childUid: string) => {
      if (!repo) return;
      await unwrap(
        api.POST("/connections", {
          params: { query: { repo } },
          body: { parent_uid: parentUid, child_uid: childUid, kind: "child" },
        }),
      );
    },
    [repo],
  );

  // Quita la conexión por su `id`: la idea queda, solo deja de anidarse.
  const desconectar = useCallback(
    async (id: number) => {
      if (!repo) return;
      await unwrap(
        api.DELETE("/connections/{connection_id}", {
          params: { path: { connection_id: id }, query: { repo } },
        }),
      );
    },
    [repo],
  );

  // F2: la proyección del repo (identidad + conteos), refrescada con el mapa.
  // Se resetea al cambiar de repo verificando el repo en el render.
  const [proyeccionEstado, setProyeccionEstado] = useState<{
    repo: string | null;
    datos: ProyeccionRepo;
  } | null>(null);

  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const vigilar = async () => {
      try {
        const p: ProyeccionRepo = await unwrap(
          api.GET("/proyecciones/repo", {
            params: { query: { repo } },
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setProyeccionEstado({ repo, datos: p });
      } catch {
        // La proyección no bloquea el mapa: si falla, simplemente no se ve.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(vigilar, 5000);
      }
    };
    void vigilar();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [repo]);

  const proyeccion =
    repo && proyeccionEstado?.repo === repo ? proyeccionEstado.datos : null;

  const fresco = cargado && cargado.repo === repo ? cargado : null;

  return {
    // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
    ideas: fresco?.mapa.ideas ?? null,
    links: fresco?.mapa.connections ?? SIN_CABLES,
    error: fallo && fallo.repo === repo ? fallo.mensaje : null,
    proyeccion: repo ? proyeccion : null,
    crear,
    mover,
    editar,
    borrar,
    conectar,
    desconectar,
    cargarIdea,
  };
}
