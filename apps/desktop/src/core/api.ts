/** Espejo de GET /ideas del core. El contrato definitivo se generará desde
 *  OpenAPI; esto cubre solo lo que la UI consume ya. */
export type Idea = {
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

/** Espejo de GET /connections: qué idea cuelga de cuál. */
export type Connection = {
  id: number;
  parent_uid: string;
  child_uid: string;
  kind: "child" | "related" | "supersedes";
  created_at: string;
};

/** Espejo de GET /revision: firma del almacén para el refresco en vivo. */
export type Revision = {
  data_version: number;
  ideas: number;
  connections: number;
};

/** GET tipado: si el core responde 404/400, el `detail` del core es el mensaje. */
export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
