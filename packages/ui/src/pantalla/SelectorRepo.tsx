import { useCallback, useEffect, useState } from "react";

import { api, unwrap } from "../core/api";
import type { FsListado, RepoListado } from "../core/api";
import type { ElegirCarpeta } from "../core/repo";

/** Elegir un repo, funcione donde funcione la UI.
 *
 *  Tres vías, la misma en la web y en desktop:
 *  - diálogo nativo, si el envoltorio lo inyecta (`elegirNativo`, solo Tauri);
 *  - la lista de `GET /repos`: carpetas del laboratorio ya sembradas, que el
 *    core acepta por nombre sin ruta absoluta;
 *  - pegar la ruta a mano, que el core acepta tal cual.
 *
 *  Sin esto, en el navegador el botón «Cambiar» de la barra no tenía a dónde
 *  ir: el diálogo nativo no existe fuera de Tauri. */
export function SelectorRepo({
  actual,
  onElegir,
  onCerrar,
  elegirNativo,
}: {
  actual: string | null;
  onElegir: (path: string) => void;
  onCerrar?: () => void;
  elegirNativo?: ElegirCarpeta;
}) {
  const [manual, setManual] = useState("");
  const [repos, setRepos] = useState<RepoListado[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  // El explorador solo existe donde no hay diálogo nativo (la web). Arranca
  // en el home, que es la raíz que fija el core, y baja hasta la carpeta.
  const [carpetas, setCarpetas] = useState<FsListado | null>(null);
  const [cargandoCarpetas, setCargandoCarpetas] = useState(!elegirNativo);
  const [falloCarpetas, setFalloCarpetas] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    unwrap(api.GET("/repos", { signal: controller.signal }))
      .then((lista) => {
        if (!controller.signal.aborted) setRepos(lista);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setFallo(err instanceof Error ? err.message : String(err));
        }
      });
    return () => controller.abort();
  }, []);

  const cargarCarpetas = useCallback(async (ruta?: string) => {
    setCargandoCarpetas(true);
    setFalloCarpetas(null);
    try {
      const datos = await unwrap(
        api.GET("/fs", { params: { query: ruta ? { path: ruta } : {} } }),
      );
      setCarpetas(datos);
    } catch (err) {
      setFalloCarpetas(err instanceof Error ? err.message : String(err));
    } finally {
      setCargandoCarpetas(false);
    }
  }, []);

  useEffect(() => {
    if (elegirNativo) return;
    const controller = new AbortController();
    unwrap(api.GET("/fs", { signal: controller.signal }))
      .then((datos) => {
        if (!controller.signal.aborted) setCarpetas(datos);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setFalloCarpetas(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargandoCarpetas(false);
      });
    return () => controller.abort();
  }, [elegirNativo]);

  const nativo = async () => {
    if (!elegirNativo) return;
    const dir = await elegirNativo();
    if (typeof dir === "string" && dir) onElegir(dir);
  };

  const subcarpetas =
    carpetas?.entradas?.filter((entrada) => entrada.tipo === "carpeta") ?? [];

  return (
    <div className="selector">
      {elegirNativo && (
        <button className="btn" onClick={() => void nativo()}>
          Elegir carpeta…
        </button>
      )}

      {!elegirNativo && (
        <div className="explorador">
          <p className="pane-rotulo">Explorador de carpetas</p>
          <p className="explorador-ruta mono" title={carpetas?.ruta}>
            {carpetas?.ruta ?? (cargandoCarpetas ? "Cargando…" : "No disponible")}
          </p>
          <div className="explorador-acciones">
            <button
              type="button"
              className="btn ghost"
              disabled={!carpetas?.padre || cargandoCarpetas}
              onClick={() => carpetas?.padre && void cargarCarpetas(carpetas.padre)}
            >
              Subir
            </button>
            <button
              type="button"
              className="btn"
              disabled={!carpetas || cargandoCarpetas}
              onClick={() => carpetas && onElegir(carpetas.ruta)}
            >
              Abrir esta carpeta
            </button>
          </div>
          {carpetas && subcarpetas.length === 0 && (
            <p className="hint">No hay subcarpetas.</p>
          )}
          <ul className="explorador-lista">
            {subcarpetas.map((entrada) => (
              <li key={entrada.nombre}>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={cargandoCarpetas}
                  onClick={() =>
                    carpetas &&
                    void cargarCarpetas(
                      `${carpetas.ruta.replace(/[\\/]+$/, "")}/${entrada.nombre}`,
                    )
                  }
                >
                  <span className="explorador-nombre">{entrada.nombre}</span>
                  {entrada.es_repo && <span className="explorador-repo">repo</span>}
                </button>
              </li>
            ))}
          </ul>
          {carpetas?.recortado && (
            <p className="hint">Hay más carpetas de las que caben en la lista.</p>
          )}
          {falloCarpetas && (
            <p className="hint error">No se pudo listar: {falloCarpetas}</p>
          )}
        </div>
      )}

      {repos !== null && repos.length > 0 && (
        <ul className="selector-lista">
          {repos.map(({ repo }) => (
            <li key={repo}>
              <button
                className={`btn ghost${repo === actual ? " activo" : ""}`}
                onClick={() => onElegir(repo)}
              >
                {repo}
              </button>
            </li>
          ))}
        </ul>
      )}
      {repos !== null && repos.length === 0 && (
        <p className="hint">Todavía no hay repos sembrados en el laboratorio.</p>
      )}
      {repos === null && fallo !== null && (
        <p className="hint">No se pudo listar los repos: {fallo}</p>
      )}

      <form
        className="manual"
        onSubmit={(e) => {
          e.preventDefault();
          const path = manual.trim();
          if (path) onElegir(path);
        }}
      >
        <input
          className="mono"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="C:\ruta\al\repo"
          spellCheck={false}
          aria-label="Ruta del repositorio"
        />
        <button className="btn" type="submit">
          Abrir
        </button>
      </form>

      <p className="hint">
        {elegirNativo
          ? "Se abre la última carpeta al arrancar. La primera vez sembramos dentro .EUI/EUI_DATABASE.sqlite."
          : "En el navegador no hay diálogo nativo: baja por el explorador, elige un repo del laboratorio o pega la ruta."}
      </p>

      {onCerrar && (
        <button className="btn ghost" onClick={onCerrar}>
          Cancelar
        </button>
      )}
    </div>
  );
}
