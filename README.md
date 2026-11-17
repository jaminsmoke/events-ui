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
corepack pnpm core:dev     # core en 127.0.0.1:8765
corepack pnpm dev:ui       # UI en localhost:5173 con proxy /api
corepack pnpm dev          # ventana Tauri
```

El prefijo `corepack` es necesario aquí: sin él, `pnpm` no existe en el PATH.
Ojo: `corepack pnpm` **no** deja un `pnpm` en el PATH, así que dentro de un script
hay que escribir `corepack pnpm ...` también (por eso los scripts raíz lo llevan).

## Verificación

Una sola puerta de entrada, la misma que debería correr antes de cada commit:

```bash
corepack pnpm check        # types + eslint, ruff check/format, cargo check
corepack pnpm fix          # aplica ruff --fix + ruff format + eslint --fix
```

`check` encadena `check:ui` (`tsc --noEmit` y ESLint), `check:py` (`ruff check` y
`ruff format --check`, config en `services/core/pyproject.toml`) y `check:rust`
(`cargo check`). Para compilar de verdad están `build:ui` (Vite) y `build` (bundle Tauri).

El core apunta a `data/events.db` por defecto; cámbialo con `EVENTSUI_DB=/ruta/al/log.db`.

pnpm 11+ no ejecuta postinstall de dependencias sin permiso: la política vive en
`allowBuilds` dentro de `pnpm-workspace.yaml`, no en `package.json`.

## Ideas y ADR por repositorio

La primera tabla no es la de eventos, es la de ideas ([`docs/0002`](docs/0002-ideas-y-repoprobe.md)).
Cada repo investigado lleva dentro `.EUI/EUI_DATABASE.sqlite`, un SQLite con esa tabla: las
ideas sobre un repo viajan con su código.

La primera petición sobre una carpeta existente siembra su `.EUI/EUI_DATABASE.sqlite` con
`schema/ideas.sql` si aún no está, así que abrir un repo en la UI basta. El seed sigue
existiendo para hacerlo sin arrancar el core:

```bash
git clone <url> repoprobe/repos/<repo>
corepack pnpm core:seed <repo>   # idempotente, aplica schema/ideas.sql
corepack pnpm core:dev           # Swagger en http://127.0.0.1:8765/docs
```

| Método | Ruta |
| --- | --- |
| GET | `/repos` — carpetas del laboratorio ya sembradas |
| GET | `/ideas?repo=<ruta>` (filtros `status`, `kind`, `limit`, `offset`) |
| POST | `/ideas?repo=<ruta>` |
| GET / PATCH / DELETE | `/ideas/{uid}?repo=<ruta>` |
| GET | `/connections?repo=<ruta>` (filtro `parent_uid`) |
| POST | `/connections?repo=<ruta>` |
| GET | `/revision?repo=<ruta>` — firma barata (`PRAGMA data_version` + conteos) para el refresco en vivo |

`repo` es la ruta de la carpeta (la que devuelve el selector de la UI) o un nombre
dentro de `repoprobe/repos`. Va en query porque las rutas de Windows no son un
segmento válido de URL.

Sin ORM y sin scripts sueltos: el esquema vive en
`services/core/src/events_core/schema/*.sql` y las operaciones se hacen por API,
navegable desde `/docs`.

`schema/` es el estado **final**: con eso nace un almacén nuevo. Los cambios de
esquema van además en `migraciones/0003_algo.sql`, un fichero numerado por versión
(el número manda sobre el resto del nombre) que llevan un almacén existente de la
versión anterior a la siguiente. `PRAGMA user_version` dice por cuál va cada
`.EUI/EUI_DATABASE.sqlite`, y `ensure_repo` aplica los pasos que falten en la
primera lectura. Añadir una columna o cambiar un `CHECK` es, entonces, editar
`schema/` **y** crear su paso, con el mismo SQL en los dos sitios.

Cuando el paso cambia un `CHECK` o una columna, SQLite no tiene `ALTER` para eso y
hay que reconstruir la tabla. Esa migración lleva `-- sin-foreign-keys` en la
cabecera y el runner apaga las claves foráneas antes de abrir la transacción
(dentro se ignora el `PRAGMA`): sin eso, tirar `ideas` arrastraría `connections` por
`ON DELETE CASCADE`. El paso `0004` es el ejemplo: reconstruye `ideas` para añadir
`CHECK (json_valid(tags))`.

## Estado

- **F0 (hecho):** andamio, `/health`, proxy UI→core.
- **F0.5 (hecho):** tabla `ideas`, seed de `.EUI/EUI_DATABASE.sqlite`, API CRUD por repo.
- **F0.6 (hecho):** tabla `connections`, `/revision` y el visor en vivo: el mapa solo lee,
  se refresca con el `data_version` y no permite editar nada.
- **F1 (siguiente):** esquema del sobre de evento, conexión RO, tail + SSE.
