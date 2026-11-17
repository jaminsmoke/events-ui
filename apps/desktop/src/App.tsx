import { useCallback, useEffect, useState } from "react";

/** Espejo de GET /health del core. El contrato definitivo se generará desde
 *  OpenAPI en F1; esto es solo el sondeo de vida del andamio. */
type Health = {
  status: "ok" | "degraded";
  db_path: string;
  db_exists: boolean;
  data_version?: number;
  journal_mode?: string;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState(0);

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth((await res.json()) as Health);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHealth(null);
    }
    setProbes((n) => n + 1);
  }, []);

  useEffect(() => {
    void probe();
    const id = setInterval(() => void probe(), 2000);
    return () => clearInterval(id);
  }, [probe]);

  return (
    <main className="shell">
      <header>
        <h1>Events UI</h1>
        <p className="hint">
          Andamio F0 · sondeo #{probes} cada 2 s
        </p>
      </header>

      {error && (
        <section className="card bad">
          <h2>Core inalcanzable</h2>
          <p className="mono">{error}</p>
          <p className="hint">
            Arráncalo con <code>pnpm core:dev</code> desde la raíz.
          </p>
        </section>
      )}

      {health && (
        <section className={`card ${health.status === "ok" ? "good" : "warn"}`}>
          <h2>{health.status === "ok" ? "Core operativo" : "Core sin BD de eventos"}</h2>
          <dl>
            <dt>BD</dt>
            <dd className="mono">{health.db_path}</dd>
            <dt>¿Existe?</dt>
            <dd className="mono">{health.db_exists ? "sí" : "no"}</dd>
            <dt>journal_mode</dt>
            <dd className="mono">{health.journal_mode ?? "—"}</dd>
            <dt>data_version</dt>
            <dd className="mono">{health.data_version ?? "—"}</dd>
          </dl>
          {!health.db_exists && (
            <p className="hint">
              La app no crea el fichero: es consumidora. Lo genera el productor
              del log (o lo apuntas con <code>EVENTSUI_DB</code>).
            </p>
          )}
        </section>
      )}
    </main>
  );
}
