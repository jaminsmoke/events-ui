import { useEffect, useState } from "react";

import { api, unwrap } from "../core/api";
import type { RepoListado } from "../core/api";
import { unirRuta } from "../core/repo";
import type { ElegirCarpeta } from "../core/repo";
import { useCarpetas } from "../core/useCarpetas";

/** Elegir un repo, funcione donde funcione la UI.
 *
 *  Tres vías, las mismas en la web y en desktop:
 *  - el explorador servido por el core (`GET /fs`), que baja carpeta a
 *    carpeta desde la raíz del usuario;
 *  - la lista de `GET /repos`: carpetas del laboratorio ya sembradas, que el
 *    core acepta por nombre sin ruta absoluta;
 *  - pegar la ruta a mano, que el core acepta tal cual.
 *
 *  El diálogo nativo no sustituye a nada: donde el envoltorio lo inyecta
 *  (Tauri) aparece como una acción extra, porque el navegador no puede
 *  entregar una ruta absoluta al core. */
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
  const { carpetas, cargando, fallo: falloCarpetas, cargar } = useCarpetas();

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

      <div className="explorador">
        <p className="pane-rotulo">Explorador de carpetas</p>
        <p className="explorador-ruta mono" title={carpetas?.ruta}>
          {carpetas?.ruta ?? (cargando ? "Cargando…" : "No disponible")}
        </p>
        <div className="explorador-acciones">
          <button
            type="button"
            className="btn ghost"
            disabled={!carpetas?.padre || cargando}
            onClick={() => carpetas?.padre && void cargar(carpetas.padre)}
          >
            Subir
          </button>
          <button
            type="button"
            className="btn"
            disabled={!carpetas || cargando}
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
                disabled={cargando}
                onClick={() =>
                  carpetas && void cargar(unirRuta(carpetas.ruta, entrada.nombre))
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
          placeholder={"C:\\ruta\\al\\repo"}
          spellCheck={false}
          aria-label="Ruta del repositorio"
        />
        <button className="btn" type="submit">
          Abrir
        </button>
      </form>

      <p className="hint">
        {elegirNativo
          ? "El diálogo nativo es el atajo; el explorador, la lista y la ruta manual hacen lo mismo."
          : "Baja por el explorador, elige un repo del laboratorio o pega la ruta."}
      </p>

      {onCerrar && (
        <button className="btn ghost" onClick={onCerrar}>
          Cancelar
        </button>
      )}
    </div>
  );
}
