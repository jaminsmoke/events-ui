import { useCallback, useEffect, useState } from "react";

import { api, unwrap } from "./api";
import { suscribirSondeo } from "./sondeo";
import type { CommitGit, WorkItemCreate, WorkItemUpdate, Mapa, ProyeccionRepo, Reinicio } from "./api";
import { STORAGE_KEY } from "./repo";

/** Lo cargado pertenece a *un* repo: si se cambia de carpeta, lo viejo deja de
 *  valer al instante en vez de pintarse un frame con el árbol anterior. */
type Cargado = { repo: string; mapa: Mapa };
type Fallo = { repo: string; mensaje: string };

/** Ideas del repo, refrescadas solas.
 *
 *  El refresco no es un watcher de ficheros: se pregunta `GET /revision`, cuya
 *  firma sale de `PRAGMA data_version` del almacén, del conteo de ideas y del
 *  `max(id)` del log. Si cambia, se relee el mapa: un evento nuevo del
 *  productor mueve la firma aunque no toque ninguna idea.
 *  El ritmo lo marca `sondeo`: un latido común cada 2 s que se para con la
 *  ventana oculta; si un turno llega con una lectura en vuelo, se salta. */
export function useRepo(repo: string | null) {
  const [cargado, setCargado] = useState<Cargado | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);

  // Los `setState` van en continuaciones async, nunca en el cuerpo del efecto;
  // si se cambia de repo a mitad, `vivo` descarta lo que llegue tarde.
  //
  // El core siembra el almacén si falta; un 404 aquí es que la carpeta no existe.
  useEffect(() => {
    if (!repo) return;
    let vivo = true;
    let ocupado = false;
    let firma: string | null = null;

    const vigilar = async () => {
      if (ocupado) return;
      ocupado = true;
      try {
        const rev = await unwrap(api.GET("/revision", { params: { query: { repo } } }));
        if (!vivo) return;
        const actual = `${rev.instance}/${rev.data_version}/${rev.ideas}/${rev.ultimo_evento}`;
        if (actual !== firma) {
          const mapa: Mapa = await unwrap(api.GET("/mapa", { params: { query: { repo } } }));
          if (!vivo) return;
          if (firma === null) {
            try {
              localStorage.setItem(STORAGE_KEY, repo);
            } catch {
              // Recordar la carpeta es opcional.
            }
            // El CLI y el MCP no ven `localStorage`: la raíz se comparte por el
            // fichero de configuración del core (paso 1 del roadmap).
            void api.PUT("/config", { body: { repo } }).catch(() => {});
          }
          setCargado({ repo, mapa });
          firma = actual;
        }
        setFallo(null);
      } catch (err) {
        if (vivo) {
          setFallo({ repo, mensaje: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        ocupado = false;
      }
    };

    const baja = suscribirSondeo(() => void vigilar());
    void vigilar();
    return () => {
      vivo = false;
      baja();
    };
  }, [repo]);

  // Escrituras por la API tipada: no hace falta refrescar a mano, el sondeo
  // de `/revision` ve el cambio (`data_version` sube o `ultimo_evento` crece)
  // y relee el mapa solo.
  // `crear` devuelve la idea recién creada (con su `uid`): el lanzador de
  // pruebas lo necesita para mover lo que acaba de crear.
  const crear = useCallback(
    async (body: WorkItemCreate) => {
      if (!repo) return null;
      return unwrap(api.POST("/items", { params: { query: { repo } }, body }));
    },
    [repo],
  );

  const mover = useCallback(
    async (uid: string, status: WorkItemCreate["status"]) => {
      if (!repo) return;
      await unwrap(
        api.PATCH("/items/{uid}", { params: { path: { uid }, query: { repo } }, body: { status } }),
      );
    },
    [repo],
  );

  // La idea completa (`tags`…): el mapa no los trae, así que el editor de
  // la fila la pide al abrirse.
  const cargarIdea = useCallback(
    async (uid: string) => {
      if (!repo) return null;
      return unwrap(
        api.GET("/items/{uid}", { params: { path: { uid }, query: { repo } } }),
      );
    },
    [repo],
  );

  const editar = useCallback(
    async (uid: string, cambios: WorkItemUpdate) => {
      if (!repo) return;
      await unwrap(api.PATCH("/items/{uid}", { params: { path: { uid }, query: { repo } }, body: cambios }));
    },
    [repo],
  );

  const borrar = useCallback(
    async (uid: string) => {
      if (!repo) return;
      await unwrap(api.DELETE("/items/{uid}", { params: { path: { uid }, query: { repo } } }));
    },
    [repo],
  );

  // LAB (solo Pruebas): vacía el almacén entero (ideas, cola, fichas y
  // eventos). No borra una idea: deja el proyecto limpio.
  const reiniciar = useCallback(
    async (): Promise<Reinicio | null> => {
      if (!repo) return null;
      return unwrap(api.POST("/reiniciar", { params: { query: { repo } } }));
    },
    [repo],
  );

  // F2: la proyección del repo (identidad + conteos), refrescada con el mapa.
  // Se resetea al cambiar de repo verificando el repo en el render.
  const [proyeccionEstado, setProyeccionEstado] = useState<{
    repo: string | null;
    datos: ProyeccionRepo;
  } | null>(null);

  // La proyección cambia poco: se pide uno de cada tres latidos (~6 s) y al
  // montar, en vez de con su propio temporizador.
  useEffect(() => {
    if (!repo) return;
    let vivo = true;
    let ocupado = false;
    let latido = 0;

    const vigilar = async () => {
      if (latido++ % 3 !== 0 || ocupado) return;
      ocupado = true;
      try {
        const p: ProyeccionRepo = await unwrap(
          api.GET("/proyecciones/repo", { params: { query: { repo } } }),
        );
        if (vivo) setProyeccionEstado({ repo, datos: p });
      } catch {
        // La proyección no bloquea el mapa: si falla, simplemente no se ve.
      } finally {
        ocupado = false;
      }
    };

    const baja = suscribirSondeo(() => void vigilar());
    void vigilar();
    return () => {
      vivo = false;
      baja();
    };
  }, [repo]);

  // Crear o eliminar el repo local: la respuesta ya trae la proyección
  // actualizada, así que el puente y la pestaña reaccionan al instante sin
  // esperar al siguiente latido.
  const crearRepoGit = useCallback(async (): Promise<ProyeccionRepo | null> => {
    if (!repo) return null;
    const p: ProyeccionRepo = await unwrap(api.POST("/git/inicializar", { params: { query: { repo } } }));
    setProyeccionEstado({ repo, datos: p });
    return p;
  }, [repo]);

  const eliminarRepoGit = useCallback(async (): Promise<ProyeccionRepo | null> => {
    if (!repo) return null;
    const p: ProyeccionRepo = await unwrap(api.POST("/git/eliminar", { params: { query: { repo } } }));
    setProyeccionEstado({ repo, datos: p });
    return p;
  }, [repo]);

  // Commit local: solo el mensaje, porque no hay remoto todavía. La respuesta
  // ya es la proyección actualizada (los cambios desaparecen solos) y el
  // historial se refresca porque cambia el hash de HEAD (`firmaHistorial`).
  const commit = useCallback(
    async (mensaje: string): Promise<ProyeccionRepo | null> => {
      if (!repo) return null;
      const p: ProyeccionRepo = await unwrap(
        api.POST("/git/commit", { params: { query: { repo } }, body: { mensaje } }),
      );
      setProyeccionEstado({ repo, datos: p });
      return p;
    },
    [repo],
  );

  // Ignorar el almacén: escribe `.EUI/` en el `.gitignore` de la raíz elegida.
  // La respuesta trae la proyección, así que el Resumen cambia al instante.
  const ignorarAlmacen = useCallback(async (): Promise<ProyeccionRepo | null> => {
    if (!repo) return null;
    const p: ProyeccionRepo = await unwrap(
      api.POST("/git/ignorar-almacen", { params: { query: { repo } } }),
    );
    setProyeccionEstado({ repo, datos: p });
    return p;
  }, [repo]);

  const proyeccion =
    repo && proyeccionEstado?.repo === repo ? proyeccionEstado.datos : null;

  // El historial de Git cambia solo cuando cambia HEAD —también con commits
  // hechos fuera de la app—, así que se pide al montar y cuando cambia el
  // hash, no en cada latido. Sin work tree no se pide: el nodo se apaga solo.
  const [historialEstado, setHistorialEstado] = useState<{
    repo: string | null;
    datos: CommitGit[];
  } | null>(null);
  const firmaHistorial = repo && proyeccion?.git ? (proyeccion.commit ?? "sin-commits") : null;

  useEffect(() => {
    if (!repo || firmaHistorial === null) return;
    let vivo = true;
    void unwrap(api.GET("/git/commits", { params: { query: { repo } } }))
      .then((datos) => {
        if (vivo) setHistorialEstado({ repo, datos });
      })
      .catch(() => {
        // El historial no bloquea el mapa: si falla, el nodo se queda vacío.
      });
    return () => {
      vivo = false;
    };
  }, [repo, firmaHistorial]);

  const commits = repo && historialEstado?.repo === repo ? historialEstado.datos : [];

  const fresco = cargado && cargado.repo === repo ? cargado : null;

  return {
    // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
    ideas: fresco?.mapa.ideas ?? null,
    error: fallo && fallo.repo === repo ? fallo.mensaje : null,
    proyeccion: repo ? proyeccion : null,
    commits,
    crear,
    mover,
    editar,
    borrar,
    cargarIdea,
    reiniciar,
    crearRepoGit,
    eliminarRepoGit,
    commit,
    ignorarAlmacen,
  };
}
