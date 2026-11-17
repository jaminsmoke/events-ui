import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { open as openFolder } from "@tauri-apps/plugin-dialog";

/** Espejo de GET /ideas del core. El contrato definitivo se generará desde
 *  OpenAPI; esto cubre solo lo que la UI consume ya. */
type Idea = {
  uid: string;
  title: string;
  description: string;
  content: string;
  kind: "idea" | "adr" | "note";
  status: "draft" | "proposed" | "accepted" | "rejected" | "superseded";
  tags: string[];
  created_at: string;
  updated_at: string;
};

const STORAGE_KEY = "eui.repo";

/** En `dev:ui` (navegador) no hay Tauri, así que no hay diálogo nativo. */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Última carpeta usada. Es solo comodidad de arranque: la verdad está en el repo. */
function storedRepo(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // navegador sin storage
  }
}

function Meta({ idea }: { idea: Idea }) {
  return (
    <div className="meta">
      <span className={`badge kind-${idea.kind}`}>{idea.kind}</span>
      <span className={`badge status-${idea.status}`}>{idea.status}</span>
      {idea.tags.map((tag) => (
        <span key={tag} className="badge tag">
          {tag}
        </span>
      ))}
      <span className="date mono">{idea.created_at.slice(0, 10)}</span>
    </div>
  );
}

/** Panel de detalle: el `content` se pinta como markdown.
 *
 *  `react-markdown` no interpreta HTML crudo salvo que se lo añadas con
 *  `rehype-raw`, así que el contenido del repo no puede inyectar etiquetas.
 */
function IdeaDetail({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="detail" aria-label={idea.title}>
      <div className="detail-head">
        <h2 className="detail-title">{idea.title}</h2>
        <button className="btn ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <Meta idea={idea} />
      {idea.description && <p className="detail-desc">{idea.description}</p>}
      <div className="md">
        {idea.content.trim() ? (
          <Markdown remarkPlugins={[remarkGfm]}>{idea.content}</Markdown>
        ) : (
          <p className="hint">Esta idea todavía no tiene contenido.</p>
        )}
      </div>
      <p className="hint mono">
        uid {idea.uid} · actualizada {idea.updated_at.slice(0, 10)}
      </p>
    </aside>
  );
}

export default function App() {
  const [repo, setRepo] = useState<string | null>(storedRepo);
  // `null` = todavía sin respuesta; `[]` = el repo está sembrado pero vacío.
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  // Una sola ruta de carga: cambiar `repo` dispara la petición. Los `setState` van
  // en las continuaciones async, nunca en el cuerpo del efecto, para no encadenar
  // renders; el abort cancela la petición anterior si se cambia de repo rápido.
  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();

    fetch(`/api/ideas?repo=${encodeURIComponent(repo)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          // El core siembra el almacén si falta; un 404 aquí es que la carpeta no
          // existe, y su `detail` dice cuál.
          const body = (await res.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(body?.detail ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as Idea[];
      })
      .then((list) => {
        setIdeas(list);
        setError(null);
        localStorage.setItem(STORAGE_KEY, repo);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setIdeas([]);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => controller.abort();
  }, [repo]);

  const abrir = useCallback((path: string) => {
    setIdeas(null);
    setError(null);
    setSelectedUid(null);
    setRepo(path);
  }, []);

  const pick = useCallback(async () => {
    if (!isTauri) return;
    const dir = await openFolder({
      directory: true,
      multiple: false,
      title: "Elige la carpeta del repositorio",
    });
    if (typeof dir === "string") abrir(dir);
  }, [abrir]);

  const busy = repo !== null && ideas === null && error === null;
  const selected = ideas?.find((idea) => idea.uid === selectedUid) ?? null;
  const close = useCallback(() => setSelectedUid(null), []);

  return (
    <main className="shell">
      <header>
        <h1>Events UI</h1>
        {/* Una sola entrada al selector: en vacío lo lleva el hero de abajo, así
            que la barra solo aparece cuando ya hay repo elegido. */}
        {repo && (
          <div className="repo-bar">
            <span className="repo-name">{folderName(repo)}</span>
            <span className="repo-path mono">{repo}</span>
            <button className="btn ghost" onClick={() => void pick()} disabled={busy}>
              Cambiar
            </button>
          </div>
        )}
      </header>

      {!repo && (
        <section className="card hero">
          {isTauri ? (
            <button className="btn" onClick={() => void pick()}>
              Elegir carpeta…
            </button>
          ) : (
            <form
              className="manual"
              onSubmit={(e) => {
                e.preventDefault();
                const path = manual.trim();
                if (path) abrir(path);
              }}
            >
              <input
                className="mono"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="C:\ruta\al\repo"
                spellCheck={false}
              />
              <button className="btn" type="submit">
                Abrir
              </button>
            </form>
          )}
          <p className="hint">
            {isTauri
              ? "Se abre la última carpeta al arrancar. La primera vez sembramos dentro .EUI/EUI_DATABASE.sqlite."
              : "En el navegador no hay diálogo nativo: pega la ruta. La ventana de Tauri sí lo tiene."}
          </p>
        </section>
      )}

      {error && (
        <section className="card bad">
          <h2>No se pudo leer el repo</h2>
          <p className="mono">{error}</p>
          <p className="hint">
            ¿Está el core en marcha? Arráncalo con <code>corepack pnpm core:dev</code>.
          </p>
        </section>
      )}

      {repo && !error && (
        <section className="card">
          <h2>Ideas · {ideas?.length ?? 0}</h2>
          {busy && <p className="hint">Cargando…</p>}
          {!busy && ideas?.length === 0 && (
            <p className="hint">Todavía no hay ideas en este repo.</p>
          )}
          <ul className="ideas">
            {ideas?.map((idea) => (
              <li key={idea.uid} className={idea.uid === selectedUid ? "open" : undefined}>
                <button
                  className="idea-row"
                  onClick={() => setSelectedUid(idea.uid)}
                  aria-expanded={idea.uid === selectedUid}
                >
                  <span className="idea-title">{idea.title}</span>
                  {idea.description && <span className="idea-desc">{idea.description}</span>}
                  <Meta idea={idea} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && <IdeaDetail idea={selected} onClose={close} />}
    </main>
  );
}
