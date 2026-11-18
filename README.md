# Events UI

[![CI](https://github.com/jaminsmoke/events-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/jaminsmoke/events-ui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

UI reactiva sobre un log de eventos en SQLite, para monitorizar repositorios en
tiempo real. Las decisiones de arquitectura viven en los comentarios del código.
Plan vivo en [`ROADMAP.md`](ROADMAP.md): qué hay hecho, qué va ahora y qué no se hace.

**Idea central:** la app **no produce eventos**. Un proceso externo escribe el log;
esta app lo abre en solo lectura, detecta novedades baratas con `PRAGMA data_version`
y hace tail por cursor. No hay watcher de ficheros ni poller de git.

## Estructura

```
apps/desktop      Envoltorio Tauri 2 (diálogo nativo) sobre la UI compartida
apps/web          Envoltorio web (Vite, 15174) sobre la misma UI compartida
packages/ui       UI compartida: mapa de ideas, selector de repo y API, sin
                  envoltorio. Desktop inyecta el diálogo nativo; la web ofrece
                  la lista de `GET /repos` y pegar la ruta.
services/core     FastAPI + SQLite WAL          (uv)
repoprobe/        laboratorio: material analizado y su .EUI
```

Las dos apps montan `@events-ui/ui`: cambiar el mapa se hace una sola vez.
Lo que difiere es el envoltorio (Tauri frente a navegador) y el puerto.

## Requisitos

Node 24, Rust (toolchain MSVC), `uv`, git. No npm, no pip.

`pnpm` se invoca vía corepack, porque `corepack enable` necesita admin en Windows:

```bash
corepack pnpm -v
```

## Desarrollo

```bash
corepack pnpm install      # dependencias de la UI
corepack pnpm dev          # ventana Tauri (levanta el core si no está)
corepack pnpm dev:web      # solo web en localhost:15174, también con core
                           # (`dev:ui` es el alias histórico de este)
corepack pnpm core:dev     # core solo, en 127.0.0.1:18765 (si ya va, se reutiliza)
```

`dev` y `dev:web` pasan por `scripts/dev.mjs`, que arranca en limpio: quien
escuchara en `127.0.0.1:18765` y en el puerto de la UI (15175 desktop, 15174 web)
se termina antes de levantar el core —sin él, Vite no puede proxyficar `/api` y
la UI se queda esperando (`connect ECONNREFUSED 127.0.0.1:18765` en la terminal de
Vite)—. Al cerrar la UI el core también cae. Nada de reutilizar de sesiones
anteriores: es como ayer se quedó el código viejo atendiendo.

El prefijo `corepack` es necesario aquí: sin él, `pnpm` no existe en el PATH.
Ojo: `corepack pnpm` **no** deja un `pnpm` en el PATH, así que dentro de un script
hay que escribir `corepack pnpm ...` también (por eso los scripts raíz lo llevan).

## Verificación

Una sola puerta de entrada, la misma que debería correr antes de cada commit:

```bash
corepack pnpm check        # types + eslint, ruff check/format, cargo check
corepack pnpm fix          # aplica ruff --fix + ruff format + eslint --fix
```

`check` encadena `check:contract` (regenera el OpenAPI en memoria y falla si
`openapi.json`/`schema.ts` no coinciden con el core: cambiar la API sin
`gen:api` no pasa), `check:ui` (`tsc --noEmit` y ESLint en desktop, web y la UI
compartida), `check:py` (`ruff check` y `ruff format --check`, config en
`services/core/pyproject.toml`), `check:test` (`pytest` en `services/core/tests`,
semántica de cola y migración 0009) y `check:rust` (`cargo check`). Para compilar de
verdad están `build:web` (Vite) y `build` (bundle Tauri).

Los **e2e** van aparte porque levantan procesos (no entran en `check`):
`pnpm e2e` corre todos los escenarios de `e2e/escenarios/` y
`pnpm e2e -- <nombre>` solo uno. Cada escenario usa su core y su Vite
temporales en 18765/15175: si esos puertos ya están ocupados (p. ej. tu
`pnpm dev`), el runner se niega a arrancar sin tocar ese proceso; al terminar
—pase, falle o se interrumpa con Ctrl+C— cierra lo que levantó y comprueba
que los puertos quedan libres. Las capturas de cada corrida quedan en
`e2e/resultados/`.

`/health` comprueba el fichero `EVENTSUI_DB` (por defecto, `data/events.db`).
El historial que ve la UI se lee de la tabla `event` del repositorio seleccionado.

El registro operativo de la app (arranques, errores y operaciones) vive en su
propio SQLite, `data/registro.sqlite` (`EVENTSUI_REGISTRO_DB` para cambiarlo);
se ve con `GET /log` y su purga —90 días / 2.000 entradas, automática al
escribir— también se puede forzar por `POST /log/purgar`.

Los tipos TS del cliente no se escriben a mano: se generan del OpenAPI del
core con [`openapi-typescript`](https://openapi-ts.dev/) y las llamadas van
por [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch), tipado por esos
`paths`: ruta, query y el **cuerpo** de POST/PATCH se comprueban contra el
contrato (`api.POST("/ideas", { params, body })` compone el `body` contra
`IdeaCreate` generado). El cliente vive en `packages/ui/src/core/api.ts` junto
con `unwrap`, que convierte el error del core en su `detail`. Tras
cambiar la API del core:

```bash
corepack pnpm gen:api    # vuelca app.openapi() y regenera la UI
```

Eso deja `packages/ui/openapi.json` (snapshot versionado: el diff muestra qué
cambió del contrato) y `packages/ui/src/core/schema.ts` (generado, no editar).
`api.ts` deriva `Idea`, `Connection`, `Mapa`, `Revision` y `RepoListado` de
ahí, así que un cambio en el core se ve en el siguiente `check`. No necesita
el core en marcha: el volcado importa la app con `uv run` (módulo
`events_core.dump_openapi`).

pnpm 11+ no ejecuta postinstall de dependencias sin permiso: la política vive en
`allowBuilds` dentro de `pnpm-workspace.yaml`, no en `package.json`.

## Ideas por repositorio

La primera tabla no es la de eventos, es la de ideas.
Cada repo investigado lleva dentro `.EUI/EUI_DATABASE.sqlite`, un SQLite con esa tabla: las
ideas sobre un repo viajan con su código.

La primera petición sobre una carpeta existente siembra su `.EUI/EUI_DATABASE.sqlite` con
`schema/ideas.sql` si aún no está, así que abrir un repo en la UI basta. El seed sigue
existiendo para hacerlo sin arrancar el core:

```bash
git clone <url> repoprobe/repos/<repo>
corepack pnpm core:seed <repo>   # crear un almacén nuevo
corepack pnpm core:dev           # Swagger en http://127.0.0.1:18765/docs
```

| Método | Ruta |
| --- | --- |
| GET | `/repos` — carpetas del laboratorio ya sembradas |
| GET | `/ideas?repo=<ruta>` (filtros `status`, `kind`, `limit`, `offset`) |
| POST | `/ideas?repo=<ruta>` |
| GET / PATCH / DELETE | `/ideas/{uid}?repo=<ruta>` |
| GET | `/connections?repo=<ruta>` (filtro `parent_uid`) — solo lectura: las conexiones son de la arquitectura, inmutables |
| GET | `/mapa?repo=<ruta>` — todas las ideas del mapa y sus conexiones en una sola lectura |
| GET | `/revision?repo=<ruta>` — firma barata (`PRAGMA data_version` + conteos) para el refresco en vivo |
| GET | `/protocolos?repo=<ruta>` — uniones permitidas entre carriles (allowlist) |
| GET | `/eventos?repo=<ruta>` — tail del log (`desde`, `limite`, `origen`) |
| GET | `/eventos/stream?repo=<ruta>` — SSE en vivo con backfill |
| POST | `/eventos/compactar?repo=<ruta>` — aplica la retención del log (90 días / 5 000) |
| GET | `/proyecciones/repo?repo=<ruta>` — identidad (ruta, rama/commit git) y conteos del repo |
| GET | `/log` — registro operativo de la app (filtros `nivel`, `origen`) |
| POST | `/log/purgar` — purga del registro forzada (también pasa sola al escribir) |
| POST | `/reiniciar?repo=<ruta>` — vacía el almacén entero (LAB, solo el lanzador de Pruebas) |

### Flujo de carriles

El recorrido por defecto es **entrada → cola → roadmap → verificación → revisión aprobada**.
Desde entrada o cola se puede descartar una idea. Desde verificación se puede
devolver al final de la cola. El core admite un ítem activo en roadmap y consulta
`protocolo_flujo` para autorizar los traslados entre grupos. La UI obtiene esas
reglas con `GET /protocolos`. Las conexiones entre ideas se escriben mediante
herramientas SQL y se consultan desde el mapa.

Para actualizar un almacén v12 existente, ábrelo desde la aplicación. El comando
`core:seed` tiene un fallo conocido en ese recorrido. Consulta el
[modelo de datos](docs/base-de-datos.md) y los [pendientes](ROADMAP.md#pendientes).

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
- **F0.5 (hecho):** tablas de ideas, seed de `.EUI/EUI_DATABASE.sqlite`, API CRUD por repo.
- **F0.6 (hecho):** tabla `connections` (solo lectura, inmutable), `/revision` y visor
  en vivo: cada dos segundos se comprueba la revisión y, si cambia, se lee `/mapa`.
  Una idea se anima al pasar entre carriles.
- **F0.7 (hecho):** la UI escribe, no solo mira: crear ideas («Nueva idea»), editar
  título/descripción/tags y borrar desde la fila, y moverlas entre carriles. Todo por
  `openapi-fetch` tipado por el OpenAPI generado, con los errores 400/404 declarados
  en el contrato. Las conexiones **no** se gestionan desde la UI: son arquitectura.
- **F1–F3 (hecho):** sobre de evento + SSE en vivo por repo (F1), proyección de repo
  con identidad git (F2) y empaquetado con sidecar Python en la desktop, bandeja y
  avisos (F3). El instalador firmado queda fuera (cuesta dinero).
- **Flujo de ideas (0013)**. La migración incorpora roadmap, verificación y
  revisión aprobada, y traslada las fichas históricas de completadas a `idea_revision`.
- **Log con pestañas:** un solo flyout con `Eventos` (timeline del repo, por
  origen y nivel) y `Registro` (operativo de la app, por etiqueta y nivel).

## Licencia

MIT — ver [`LICENSE`](LICENSE).
