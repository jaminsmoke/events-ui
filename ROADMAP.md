# Roadmap

Plan vivo del proyecto: se reescribe al terminar cada bloque, no se acumula.
Lo hecho se mueve a *Hecho* con su commit; lo que no va, va a *No se hace
(por ahora)* con el motivo, para no reabrirlo cada semana.

## Hecho

- **Arranque en un comando** (`scripts/dev.mjs`): `pnpm dev` levanta el core
  si no está y lo apaga al salir; si ya va, lo reutiliza. Sin el core, Vite
  escupía `ECONNREFUSED 127.0.0.1:8765` cada 2 s.
- **UI compartida desktop + web** (`packages/ui`): `apps/desktop` (Tauri con
  diálogo nativo, 5173) y `apps/web` (Vite, 5174) montan el mismo visor.
  El selector de repo funciona en ambos (lista de `GET /repos` + ruta manual).
- **Cliente generado del OpenAPI**: tipos con `openapi-typescript`, llamadas
  con `openapi-fetch` tipado por `paths`; errores 400/404 declarados en el
  contrato (`ErrorDetail`) y `pnpm check` falla si `schema.ts` no está
  regenerado (`check:contract`).
- **La UI escribe**: crear, editar, borrar y mover ideas, y conectar ideas
  del cajón (`POST /connections`). Todo por la API tipada.
- **Pulsos de color por nodo**: azul entra, rojo sale (también al borrar),
  verde completada (`accepted`); con chispas en el cable del carril.
- **Commit** `25104f7` con todo lo anterior.
- **Quitar conexión desde la UI** (`DELETE /connections/{id}` + botón
  «Desconectar» en la fila hija): la idea queda, solo deja de anidarse.
- **Copy al día**: fuera «visor de solo lectura» de `App`, `arbol`, `api`,
  `styles.css` y descripciones; el aviso de error ya no manda a `core:dev`
  cuando en dev el core se levanta solo.
- **Pulso también en el cajón** de Ideas (azul al crear, rojo al borrar;
  sin chispa, que va por el cable del carril) y botón **Completar** en la
  fila, con su pulso verde (`accepted`).

## Ahora

*(Nada pendiente en esta sección: ver Backlog.)*

## Backlog

- *(Hecho: botón Completar en la fila con pulso verde.)*
- Edición completa en la fila: `kind` y `tags`, no solo título/descripción.
- Formulario de edición como diálogo modal en vez de en línea en la fila.
- Pintar las conexiones `related`/`supersedes` (la API las acepta y crea;
  `buildTree` solo anida `child`).
- Quitar la duplicación `unwrap`/`unwrapVacio` en `api.ts` (manejo de error
  en un solo sitio).
- Empezar F1: esquema del sobre de evento, conexión RO, tail + SSE.

## No se hace (por ahora)

- **Extensión de VS Code**: empaquetado y webview grandes; rinde más con el
  modelo y la UI estables. Reabrir cuando el mapa y las acciones dejen de
  moverse.
- **CI**: no hay CI que corra `pnpm check`; añadirlo cuando haya remoto y
  ramas. El check de contrato ya existe localmente.
- **`related`/`supersedes` como carriles propios**: son conexiones, no
  columnas; solo se pintan si el visor lo necesita.
