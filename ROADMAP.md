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
- **Enlaces laterales en el mapa**: `related` (punteado) y `supersedes`
  (púrpura) unen filas sin anidarlas, con pulso azul en ambos extremos al
  crearlos. **Editar completo** en la fila: `kind` y `tags` además de título
  y descripción.
- **Fila solo-expandir**: la fila cerrada es solo título y contador; al
  expandirla aparecen descripción, estado, botones e hijos. Nada de botones
  junto al título.
- **`ideas` → `idea_entry` + `idea_lane_log`** (migración 0006): la identidad
  (`uid` estable) vive en `idea_entry`; cada paso por carril es una fila en
  `idea_lane_log` con su `entered_at`. El `status` de la API es la traducción
  del último carril; `connections` y `event` cuelgan de la entrada.
- **`idea_rejected`** (migración 0007): la ficha del descarte —`rejected_at`,
  `rejected_description`, `rejected_by`, `superseded_by_uid`— se crea al entrar
  en descartadas, se retira al salir, y la UI pide el motivo al descartar.
- **F1 — motor en vivo por repo**: sobre de evento (`id`, `ts`, `type`,
  `payload`, `dedupe_key`) en la tabla `event` de cada `EUI_DATABASE`
  (migración 0005), conexión RO, tail `WHERE id > :last` y SSE con backfill
  (`GET /eventos` y `GET /eventos/stream`); la UI muestra «Actividad» con los
  eventos por SSE y un fallback para tipos desconocidos. Renderers conocidos
  para `idea.created`/`updated`/`deleted`/`status`.
- **Editar en diálogo modal**: el formulario inline de la fila pasa a un
  diálogo centrado (portal al body), con precarga de `kind`/`tags`.
- **F3 — sidecar empaquetado**: el core se congela con PyInstaller
  (`sidecar.py` + `pnpm build:sidecar`, verificado con `/health` en frío) y
  viaja como `externalBin` de Tauri; en release `lib.rs` lo arranca junto al
  ejecutable y lo mata al cerrar, y la UI empaquetada habla directo con
  `127.0.0.1:8765` (`.env.production`). `pnpm release` construye el sidecar
  antes del bundle desktop.

## Ahora

*(Nada pendiente en esta sección: ver Backlog.)*

## Backlog

- *(Hecho: botón Completar en la fila con pulso verde.)*
- *(Hecho: `kind` y `tags` se editan en la fila.)*
- *(Hecho: edición en diálogo modal.)*
- *(Hecho: `related`/`supersedes` se pintan como enlaces con pulso.)*
- *(Hecho: un solo `unwrap` en `api.ts`.)*
- *(Hecho: F1 — sobre de evento, conexión RO, tail + SSE.)*
- *(Hecho: F2 — `GET /proyecciones/repo` con identidad (ruta + rama/commit git);
  el core emite `idea.*` al escribir.)*

## Antes de empaquetar (en este orden)

1. **Versionado único** *(hecho: `scripts/bump.mjs`, raíz en `0.1.0` como
   fuente de verdad; `pnpm bump` sin argumento es el check, con argumento
   fija la versión y sincroniza el lockfile; entra en `pnpm check`)*.
2. **Empaquetado por app, misma versión** *(hecho: `pnpm release` —bump +
   gen:api + check + build web + build desktop + commit + tag `vX.Y.Z`—;
   verificado con el release `v0.1.0`: MSI 3 MB y NSIS 2 MB)*.
3. **Retención del log** *(hecho: `eventos.compactar` con 90 días / 5 000
   eventos por repo, `POST /eventos/compactar` y CLI `events_core.compact`;
   con `VACUUM` cuando hay hueco bastante)*.

## No se hace (por ahora)

- **Extensión de VS Code**: empaquetado y webview grandes; rinde más con el
  modelo y la UI estables. Reabrir cuando el mapa y las acciones dejen de
  moverse.
- **CI**: no hay CI que corra `pnpm check`; añadirlo cuando haya remoto y
  ramas. El check de contrato ya existe localmente.
- **`related`/`supersedes` como carriles propios**: son conexiones, no
  columnas; solo se pintan si el visor lo necesita.
