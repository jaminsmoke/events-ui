import { useCallback, useEffect, useState } from "react";

import { api, unwrap } from "../core/api";
import type { EntradaLog } from "../core/api";

type Nivel = "todas" | "info" | "aviso" | "error";

/** Visor del registro operativo de la app (`GET /log`): qué pasó en las
 *  últimas ejecuciones —arranques, errores y operaciones—, con purga manual
 *  (la automática también se aplica al escribir). Es de la app, no del repo,
 *  así que no pide repo y está en las dos entradas (desktop y web). */
export function Registro({ onCerrar }: { onCerrar: () => void }) {
  const [entradas, setEntradas] = useState<EntradaLog[]>([]);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nivel, setNivel] = useState<Nivel>("todas");
  const [purgando, setPurgando] = useState(false);
  // Sube con el botón Recargar: solo re-ejecuta el efecto de sondeo.
  const [recarga, setRecarga] = useState(0);

  // Al abrir, y cada 3 s mientras se mira: la lista es lo que el core tiene
  // ahora mismo. La función vive dentro del efecto, como en los sondeos.
  useEffect(() => {
    let activo = true;
    const vigilar = async () => {
      try {
        const lista = await unwrap(api.GET("/log", { params: { query: { limite: 500 } } }));
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
  }, [recarga]);

  const purgar = useCallback(async () => {
    setPurgando(true);
    setFallo(null);
    try {
      await unwrap(api.POST("/log/purgar", {}));
      const lista = await unwrap(api.GET("/log", { params: { query: { limite: 500 } } }));
      setEntradas(lista);
    } catch (err) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setPurgando(false);
    }
  }, []);

  const visibles = nivel === "todas" ? entradas : entradas.filter((e) => e.nivel === nivel);

  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <dialog
        className="modal"
        open
        aria-label="Registro de la app"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <h2>Registro de la app</h2>
        <p className="hint">
          Arranques, errores y operaciones de laboratorio del core. Se guarda solo
          (purga automática: 90 días y 2.000 entradas).
        </p>
        <label>
          Nivel
          <select
            value={nivel}
            onChange={(e) => setNivel(e.target.value as Nivel)}
            aria-label="Nivel"
          >
            <option value="todas">Todos</option>
            <option value="info">Info</option>
            <option value="aviso">Aviso</option>
            <option value="error">Error</option>
          </select>
        </label>

        {fallo && <p className="hint error">Error: {fallo}</p>}
        {visibles.length === 0 ? (
          <p className="hint">Sin entradas{fallo ? "" : " con este nivel"}.</p>
        ) : (
          <ul className="registro-lista">
            {visibles.map((e) => (
              <li key={e.id} className={`registro-linea reg-${e.nivel}`}>
                <strong>{e.ts}</strong> <span>[{e.nivel}]</span> {e.mensaje}
              </li>
            ))}
          </ul>
        )}

        <div className="modal-acciones">
          <button type="button" className="btn" onClick={() => setRecarga((n) => n + 1)}>
            Recargar
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={purgando}
            onClick={purgar}
          >
            {purgando ? "Purgando…" : "Purgar ahora"}
          </button>
          <button type="button" className="btn ghost" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </dialog>
    </div>
  );
}
