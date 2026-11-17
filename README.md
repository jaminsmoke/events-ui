# Events UI

UI reactiva sobre un log de eventos en SQLite, para monitorizar repositorios en
tiempo real. Decisiones de arquitectura en [`docs/0001-arquitectura.md`](docs/0001-arquitectura.md).

**Idea central:** la app **no produce eventos**. Un proceso externo escribe el log;
esta app lo abre en solo lectura, detecta novedades baratas con `PRAGMA data_version`
y hace tail por cursor. No hay watcher de ficheros ni poller de git.

## Estructura

```
apps/desktop      Tauri 2 + React + TS + Vite   (pnpm)
services/core     FastAPI + SQLite WAL          (uv)
docs/             ADRs
repoprobe/        laboratorio: material analizado y su .EUI
```

## Requisitos

Node 24, Rust (toolchain MSVC), `uv`, git. No npm, no pip.

`pnpm` se invoca vía corepack, porque `corepack enable` necesita admin en Windows:

```bash
corepack pnpm -v
```

## Desarrollo

```bash
corepack pnpm install      # dependencias de la UI
corepack pnpm core:dev     # core en 127.0.0.1:8000
corepack pnpm dev:ui       # UI en localhost:5173 con proxy /api
corepack pnpm dev          # ventana Tauri
```

El prefijo `corepack` es necesario aquí: sin él, `pnpm` no existe en el PATH.
Dentro de un script de pnpm sí puedes llamar a `pnpm` directamente.

El core apunta a `data/events.db` por defecto; cámbialo con `EVENTSUI_DB=/ruta/al/log.db`.

pnpm 11+ no ejecuta postinstall de dependencias sin permiso: la política vive en
`allowBuilds` dentro de `pnpm-workspace.yaml`, no en `package.json`.

## Ideas y ADR por repositorio

La primera tabla no es la de eventos, es la de ideas ([`docs/0002`](docs/0002-ideas-y-repoprobe.md)).
Cada repo investigado lleva dentro `.EUI/EUI_DATABASE`, un SQLite con esa tabla: las
ideas sobre un repo viajan con su código.

```bash
git clone <url> repoprobe/repos/<repo>
corepack pnpm core:seed <repo>   # idempotente, aplica schema/ideas.sql
corepack pnpm core:dev           # Swagger en http://127.0.0.1:8000/docs
```

| Método | Ruta |
| --- | --- |
| GET | `/repos` |
| GET | `/repos/{repo}/ideas` (filtros `status`, `kind`, `limit`, `offset`) |
| POST | `/repos/{repo}/ideas` |
| GET / PATCH / DELETE | `/repos/{repo}/ideas/{uid}` |

Sin ORM y sin scripts sueltos: el esquema vive en
`services/core/src/events_core/schema/ideas.sql` y las operaciones se hacen por API,
navegable desde `/docs`.

## Estado

- **F0 (hecho):** andamio, `/health`, proxy UI→core.
- **F0.5 (hecho):** tabla `ideas`, seed de `.EUI/EUI_DATABASE`, API CRUD por repo.
- **F1 (siguiente):** esquema del sobre de evento, conexión RO, tail + SSE.
