import { useCallback, useEffect, useState } from "react";

import { api, unwrap } from "./api";
import { suscribirSondeo } from "./sondeo";
import type { CommitGit, ProyeccionRepo } from "./api";

/** La proyección del repo (identidad + conteos), el historial y las acciones
 *  que cambian el work tree. */
export function useGit(repo: string | null) {
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
    const controller = new AbortController();

    const vigilar = async () => {
      if (latido++ % 3 !== 0 || ocupado) return;
      ocupado = true;
      try {
        const p: ProyeccionRepo = await unwrap(
          api.GET("/proyecciones/repo", {
            params: { query: { repo } },
            signal: controller.signal,
          }),
        );
        if (vivo) {
          // Cada latido trae un objeto nuevo aunque nada cambie: sin comparar,
          // el mapa se repinta cada ~6 s. La proyección es pequeña.
          setProyeccionEstado((previo) =>
            previo?.repo === repo && JSON.stringify(previo.datos) === JSON.stringify(p)
              ? previo
              : { repo, datos: p },
          );
        }
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
      controller.abort();
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
    const controller = new AbortController();
    void unwrap(
      api.GET("/git/commits", { params: { query: { repo } }, signal: controller.signal }),
    )
      .then((datos) => {
        if (vivo) setHistorialEstado({ repo, datos });
      })
      .catch(() => {
        // El historial no bloquea el mapa: si falla, el nodo se queda vacío.
      });
    return () => {
      vivo = false;
      controller.abort();
    };
  }, [repo, firmaHistorial]);

  const commits = repo && historialEstado?.repo === repo ? historialEstado.datos : [];

  return {
    proyeccion,
    commits,
    crearRepoGit,
    eliminarRepoGit,
    commit,
    ignorarAlmacen,
  };
}
