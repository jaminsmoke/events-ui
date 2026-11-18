import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

type Schemas = components["schemas"];

/** Los tipos que consume la UI, sacados del OpenAPI del core (`./schema.ts`,
 *  generado con `pnpm gen:api`). No escribirlos a mano: si el core cambia un
 *  campo o un enum, aquí se ve en el siguiente `check`, no en producción.
 *
 *  La UI lee el mapa (`MapSnapshot`), así que su idea es `MapIdea` —los mismos
 *  campos que consume el visor: `uid`, `title`, `description`, `status`— y no
 *  la `Idea` completa del CRUD. */
export type Idea = Schemas["MapIdea"];

/** Espejo de GET /connections: qué idea cuelga de cuál. */
export type Connection = Schemas["Connection"];

/** Espejo de GET /mapa: todas las ideas del visor y sus conexiones. */
export type Mapa = Schemas["MapSnapshot"];

/** Espejo de GET /revision: firma del almacén para el refresco en vivo. */
export type Revision = Schemas["Revision"];

/** Una carpeta del laboratorio ya sembrada, tal como la devuelve GET /repos. */
export type RepoListado = Schemas["Repo"];

/** Cuerpo de POST /ideas y de PATCH /ideas/{uid}, del contrato generado. */
export type IdeaCreate = Schemas["IdeaCreate"];
export type IdeaUpdate = Schemas["IdeaUpdate"];

/** El cuerpo de los errores 400/404 del core (`{"detail": ...}`), tal como
 *  lo declaran los exception handlers y ahora el propio OpenAPI. */
export type ErrorDetalle = Schemas["ErrorDetail"];

/** Base de la API. Por defecto `/api`: en dev Vite lo proxyfica al core
 *  (127.0.0.1:8765) tanto en la web como en Tauri. Una web servida como
 *  estático puede apuntar directo con `VITE_API_URL=http://127.0.0.1:8765`;
 *  en ese caso el core tiene que permitir su origen en CORS. */
export const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "/api";

/** Cliente tipado por `paths` (el OpenAPI generado): ruta, query, path params
 *  y **cuerpo** de POST/PATCH vienen del contrato, así que una llamada con
 *  cuerpo se escribe `api.POST("/ideas", { params: { query: { repo } }, body })`
 *  y el `body` se comprueba contra `IdeaCreate` sin escribir tipos a mano. */
export const api = createClient<paths>({ baseUrl: API_BASE });

/** ¿Es un error con `detail` de texto (400/404 del core, o el 422 de
 *  validación, cuyo `detail` es una lista)? Estrecha sin cast: el `typeof`
 *  distingue el texto del core de la lista de validación. */
function esErrorDetalle(error: unknown): error is ErrorDetalle {
  return (
    typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof error.detail === "string"
  );
}

/** Desenvuelve una respuesta de `openapi-fetch`: si el core respondió un
 *  error, su `detail` tipado es el mensaje; si la petición no llegó, el
 *  error de red sale tal cual. */
export async function unwrap<T, E>(
  peticion: Promise<{ data?: T; error?: E; response: Response }>,
): Promise<T> {
  const { data, error, response } = await peticion;
  if (error !== undefined) {
    throw new Error(esErrorDetalle(error) ? error.detail : `HTTP ${response.status}`);
  }
  if (data === undefined) throw new Error(`HTTP ${response.status} sin cuerpo`);
  return data;
}

/** Como `unwrap`, pero para un 204 sin cuerpo (DELETE): ahí el éxito es que
 *  no hay `error`, y no hay `data` que devolver. */
export async function unwrapVacio(
  peticion: Promise<{ error?: unknown; response: Response }>,
): Promise<void> {
  const { error, response } = await peticion;
  if (error !== undefined) {
    throw new Error(esErrorDetalle(error) ? error.detail : `HTTP ${response.status}`);
  }
}
