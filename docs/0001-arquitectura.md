# 0001 — Arquitectura base

**Estado:** aceptado · 17 nov 2026

## Contexto

Sistema de UI reactiva sobre un log de eventos en SQL, para monitorizar repositorios
en tiempo real. Se quiere empezar con algo básico y endurecerlo por fases.

Decisión clave tomada al arrancar: **la app no produce eventos**. No hay watcher de
ficheros ni poller de git/API. Existen otros procesos que escriben el log; la app
lo consume y lo proyecta en UI. Los detalles del productor se pactarán por separado.

## Decisiones

1. **Shell: Tauri 2.** Rust mínimo (ventana, tray, arranque del sidecar, notificaciones
   nativas). Binario ~10 MB frente a ~200 MB de Electron, y el proceso no arrastra
   Chromium permanentemente: es una app residente vigilando repos durante horas.
   Se descarta Electron por peso; se descarta "solo web" porque se quiere tray nativo.

2. **UI: React + TypeScript + Vite**, gestionado con **pnpm**. No npm.

3. **Core: Python como sidecar**, gestionado con **uv**. No pip. FastAPI + aiosqlite.
   Python se elige por el ecosistema de minería/analítica de repos (pygit2, tree-sitter,
   pandas) que hará falta más adelante; el shell y la UI se quedan en TS.

4. **Persistencia: SQLite en WAL.** Cero infraestructura, `JSON1` y `FTS5` disponibles.
   Postgres queda como cambio de DSN si algún día hace falta multiusuario.

5. **La app es consumidora, no productora.**
   - Conexión A: `file:...?mode=ro` sobre la BD de eventos. Nunca escribe.
   - Conexión B: RW, solo para estado propio de la app (vistas guardadas, preferencias).
   Ambas con `busy_timeout` alto y WAL, para no bloquear al escritor externo.

6. **Tiempo real = `PRAGMA data_version` + cursor.**
   `data_version` cambia cuando *otra* conexión hace commit: sirve como señal barata
   de "hay novedades" sin ejecutar queries. Cuando cambia, se hace tail
   `SELECT * FROM event WHERE id > :last ORDER BY id` y se emite por SSE.
   Esto da backfill histórico y recuperación tras desconexión con el mismo mecanismo
   que el live. No se usan notificaciones ad-hoc.

7. **Esquema de eventos abierto y tolerante.** No controlamos al productor:
   - `type` es texto libre, no un enum cerrado.
   - `payload` es JSON libre; el significado lo define el tipo.
   - La UI usa un **registro de renderers** con *fallback* genérico (volcado del
     payload), de modo que un evento de tipo desconocido nunca rompe la vista.

8. **Proyecciones con nombre, no SQL libre desde la UI.** `repo_estado_actual`,
   `actividad_por_dia`, etc. son vistas fijas y versionadas. Un query builder
   genérico se descarta explícitamente: convierte el producto en una consola SQL.

9. **Contrato único.** El core expone OpenAPI; de ahí se generan los tipos TS del
   cliente. UI y core no comparten definiciones a mano.

## Consecuencias

- La UI depende de que el sobre del evento sea estable aunque el payload sea libre:
  `id`, `ts`, `repo`, `type`, `payload`, `dedupe_key` son la parte que no se toca.
- Los eventos desconocidos se muestran, no se descartan. Filtrar en la UI, no en la
  ingesta, porque la ingesta no es nuestra.
- Migrar a Postgres cambia el mecanismo de realtime (`data_version` → `LISTEN/NOTIFY`),
  y ese acoplamiento queda aislado en un único módulo del core.

## Pendiente de pactar (no bloquea el andamio)

- Esquema exacto del sobre de evento y quién/qué escribe (proceso externo, CLI, agente).
- Identidad de repositorio: ruta, remoto, o id propio.
- Cómo se empaqueta el sidecar Python (PyInstaller como `externalBin` de Tauri) — fase 3.

## Enmienda — retención del log (antes de empaquetar, punto 3)

El log no crece sin cota: la política es **a lo sumo 90 días de antigüedad y
5 000 eventos por repo**, lo que llegue primero manda. El recorte lo aplica
`eventos.compactar` (dos barridos, primero por edad y luego por conteo) y
salta el `VACUUM` si no hubo hueco bastante (≥1.000 filas borradas) o si el
productor lo bloquea; se dispara a mano por `POST /eventos/compactar` o por
la CLI `python -m events_core.compact <repo>`. No hay poda automática en
arranque: la política está pactada, el disparador sigue siendo manual.

## Enmienda — F3: sidecar empaquetado

El core viaja congelado con PyInstaller como `externalBin` de Tauri (`pnpm
build:sidecar` lo deja en `src-tauri/binaries/events-core-<triple>[.exe]` y
comprueba que arranca y responde a `/health` antes de darlo por bueno). En
release, `lib.rs` lo arranca junto al ejecutable y lo mata al cerrar la
ventana; en dev no se arranca (lo levanta `scripts/dev.mjs`). La UI
empaquetada habla directo con `http://127.0.0.1:8765` (`apps/desktop/
.env.production`, sin proxy Vite).

## Fases

- **F0 — andamio:** git, workspaces pnpm + uv, Tauri 2 + React + FastAPI con `/health`.
- **F1 — motor:** esquema de eventos, conexión RO, `data_version` + tail, SSE, UI en vivo.
- **F2 — repos:** primera proyección e identidad de repo.
- **F3 — producto:** binario empaquetado *(hecho: sidecar PyInstaller como
  `externalBin`)*, bandeja *(hecho: cerrar minimiza, «Salir» lo mata)* y
  notificaciones *(hecho: `tauri-plugin-notification` con ajustes de
  verbosidad)*. Pendiente: instalador firmado (cuesta dinero; en local no
  hace falta).
