import { useCallback, useEffect, useRef, useState } from "react";

import { api, unwrap } from "./api";
import { suscribirSondeo } from "./sondeo";
import type { Mapa, Reinicio, WorkItemCreate, WorkItemUpdate } from "./api";
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
export function useItems(repo: string | null) {
  const [cargado, setCargado] = useState<Cargado | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);

  // Cada empujón del SSE suma un latido y vuelve a ejecutar el efecto: la
  // lectura es inmediata en vez de esperar al sondeo de 2 s.
  const [latido, setLatido] = useState(0);

  // La raíz se recuerda una vez por repo. El SSE reinicia el efecto (y con él
  // `firma`), pero eso no puede volver a escribir `config.json`: el fichero es
  // para el CLI y el MCP, no un latido más.
  const recordado = useRef<string | null>(null);

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
        const actual = `${rev.instance}/${rev.data_version}/${rev.items}/${rev.ultimo_evento}`;
        if (actual !== firma) {
          const mapa: Mapa = await unwrap(api.GET("/mapa", { params: { query: { repo } } }));
          if (!vivo) return;
          if (recordado.current !== repo) {
            // Antes del `await`: si un evento re-ejecuta el efecto con el PUT
            // anterior en vuelo, la segunda lectura no lo manda otra vez.
            recordado.current = repo;
            try {
              localStorage.setItem(STORAGE_KEY, repo);
            } catch {
              // Recordar la carpeta es opcional.
            }
            // El CLI y el MCP no ven `localStorage`: la raíz se comparte por el
            // fichero de configuración del core (paso 1 del roadmap).
            void api
              .PUT("/config", { body: { repo } })
              .catch(() => {
                // Si el core no lo pudo guardar, el siguiente evento reintenta.
                if (recordado.current === repo) recordado.current = null;
              });
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
  }, [repo, latido]);

  // El SSE avisa al instante de una escritura; el sondeo sigue siendo la red
  // de seguridad para lo que no pasa por el core. Re-ejecutar el efecto
  // reinicia la firma, así que la lectura es inmediata y no se duplica.
  const refrescar = useCallback(() => setLatido((n) => n + 1), []);

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

  const fresco = cargado && cargado.repo === repo ? cargado : null;

  return {
    // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
    ideas: fresco?.mapa.items ?? null,
    refrescar,
    error: fallo && fallo.repo === repo ? fallo.mensaje : null,
    crear,
    mover,
    editar,
    borrar,
    cargarIdea,
    reiniciar,
  };
}
