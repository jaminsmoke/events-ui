import { useCallback, useEffect, useMemo, useState } from "react";

import { api, unwrap } from "../core/api";
import type { EntradaLog, Evento } from "../core/api";
import { resumenEvento } from "../core/useEventos";

/** Flyout del log, estilo VS Code: dos pestañas —`Eventos` (el timeline del
 *  repo: `idea.*` + los externos, por `origen`) y `Registro` (el operativo
 *  de la app: arranques, errores y operaciones, por nivel y por etiqueta).
 *
 *  Son dos almacenes distintos y no se mezclan: la pestaña solo decide qué
 *  fuente se mira. `eventos` llega ya del `useEventos` de App (fresco por
 *  SSE); el registro se sondea mientras la pestaña está abierta.
 *
 *  El color es por `nivel` en las dos: info (azul), aviso (ámbar),
 *  error (rojo). En eventos el nivel viene del core (por tipo o por
 *  `payload.nivel`); en el registro lo escribió quien lo emitió. */
export function PanelLog({
  tab,
  onTab,
  onClose,
  eventos,
  conectado,
}: {
  tab: "actividad" | "registro";
  onTab: (tab: "actividad" | "registro") => void;
  onClose: () => void;
  eventos: Evento[];
  conectado: boolean;
}) {
  const [origen, setOrigen] = useState<"todas" | string>("todas");
  const visibles = useMemo(
    () => (origen === "todas" ? eventos : eventos.filter((e) => e.origen === origen)),
    [eventos, origen],
  );
  const origenes = useMemo(
    () => [...new Set(eventos.map((e) => e.origen))],
    [eventos],
  );

  const [entradas, setEntradas] = useState<EntradaLog[]>([]);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nivelFiltro, setNivelFiltro] = useState<"todas" | "info" | "aviso" | "error">("todas");
  const [origenFiltro, setOrigenFiltro] = useState<"todas" | string>("todas");
  const [purgando, setPurgando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (tab !== "registro") return;
    let activo = true;
    const vigilar = async () => {
      try {
        const lista = await unwrap(
          api.GET("/log", {
            params: {
              query: {
                limite: 500,
                ...(nivelFiltro === "todas" ? {} : { nivel: nivelFiltro }),
                ...(origenFiltro === "todas" ? {} : { origen: origenFiltro }),
              },
            },
          }),
        );
        if (activo) {
          setEntradas(lista);
          setFallo(null);
        }
      } catch (err) {
        if (activo) setFallo(err instanceof Error ? err.message : String(err));
      }
    };
    void vigilar();
    const timer = setInterval(() => void vigilar(), 3000);
    return () => {
      activo = false;
      clearInterval(timer);
    };
  }, [tab, nivelFiltro, origenFiltro, recarga]);

  const purgar = useCallback(async () => {
    setPurgando(true);
    setFallo(null);
    try {
      await unwrap(api.POST("/log/purgar", {}));
      setRecarga((n) => n + 1);
    } catch (err) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setPurgando(false);
    }
  }, []);

  const etiquetas = useMemo(
    () => [...new Set(entradas.map((e) => e.origen))],
    [entradas],
  );

  return (
    <section className="panel" aria-label={`Panel: ${tab === "actividad" ? "Eventos" : "Registro"}`}>
      <div className="panel-cabecera">
        <div className="panel-pestanas" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "actividad"}
            className={`chip${tab === "actividad" ? " activo" : ""}`}
            onClick={() => onTab("actividad")}
          >
            Eventos{conectado && <span className="dot" aria-label="en vivo" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "registro"}
            className={`chip${tab === "registro" ? " activo" : ""}`}
            onClick={() => onTab("registro")}
          >
            Registro
          </button>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={onClose}
          aria-label={`Cerrar panel de ${tab === "actividad" ? "eventos" : "registro"}`}
        >
          ✕
        </button>
      </div>

      <div className="panel-cuerpo">
        {tab === "actividad" && (
          <>
            <div className="panel-filtros">
              <span className="chip-titulo">Origen</span>
              {(["todas", ...origenes] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`chip${origen === o ? " activo" : ""}`}
                  aria-pressed={origen === o}
                  onClick={() => setOrigen(o)}
                >
                  {o}
                </button>
              ))}
            </div>
            {visibles.length === 0 ? (
              <p className="hint">Sin eventos todavía. El log se lee, no se escribe.</p>
            ) : (
              <ul className="registro-lista">
                {visibles.map((e) => (
                  <li key={e.id} className={`reg-${e.nivel}`}>
                    <span className={`punto ${e.nivel}`} aria-hidden="true" />
                    <strong>#{e.id}</strong> <span>[{e.origen}]</span> {resumenEvento(e)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "registro" && (
          <>
            <div className="panel-filtros">
              <span className="chip-titulo">Nivel</span>
              {(["todas", "info", "aviso", "error"] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`chip${nivelFiltro === n ? " activo" : ""}`}
                  aria-pressed={nivelFiltro === n}
                  onClick={() => setNivelFiltro(n)}
                >
                  {n}
                </button>
              ))}
              <span className="chip-titulo">Origen</span>
              {(["todas", ...etiquetas] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`chip${origenFiltro === o ? " activo" : ""}`}
                  aria-pressed={origenFiltro === o}
                  onClick={() => setOrigenFiltro(o)}
                >
                  {o}
                </button>
              ))}
              <span className="panel-acciones">
                <button type="button" className="btn ghost" onClick={() => setRecarga((n) => n + 1)}>
                  Recargar
                </button>
                <button type="button" className="btn ghost" disabled={purgando} onClick={purgar}>
                  {purgando ? "Purgando…" : "Purgar ahora"}
                </button>
              </span>
            </div>
            {fallo && <p className="hint error">Error: {fallo}</p>}
            {entradas.length === 0 ? (
              <p className="hint">Sin entradas.</p>
            ) : (
              <ul className="registro-lista">
                {entradas.map((e) => (
                  <li key={e.id} className={`reg-${e.nivel}`}>
                    <span className={`punto ${e.nivel}`} aria-hidden="true" />
                    <strong>{e.ts}</strong> <span>[{e.origen}]</span> [{e.nivel}] {e.mensaje}
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">Purga automática: 90 días y 2.000 entradas.</p>
          </>
        )}
      </div>
    </section>
  );
}
