# Events UI

[![CI](https://github.com/jaminsmoke/events-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/jaminsmoke/events-ui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

UI reactiva sobre un log de eventos en SQLite, para monitorizar repositorios en
tiempo real. Las decisiones de arquitectura viven en los comentarios del código.
Plan vivo en Events UI; la vista Markdown se genera con `eui migrate export ROADMAP.md`.

**La clave:** la app **no produce eventos**. Un proceso externo escribe el log;
esta app lo abre en solo lectura, detecta novedades baratas con `PRAGMA data_version`
y hace tail por cursor. No hay watcher de ficheros ni poller de git.

## Estructura

```
apps/desktop      Envoltorio Tauri 2 (diálogo nativo) sobre la UI compartida
apps/web          Envoltorio web (Vite, 15174) sobre la misma UI compartida
packages/ui       UI compartida: mapa de trabajo, selector de repo y API, sin
                  envoltorio. Las dos apps comparten el explorador de `/fs`, la
                  lista de `GET /repos` y la ruta manual; desktop añade el
                  diálogo nativo.
shared/core       FastAPI + SQLite WAL          (uv)
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
`shared/core/pyproject.toml`), `check:test` (`pytest` en `shared/core/tests`)
y `check:rust` (`cargo check`). Para compilar de
verdad están `build:web` (Vite) y `build` (bundle Tauri).

En el CI (`.github/workflows/ci.yml`) el job `check` corre todo eso en
Ubuntu; el job `windows` repite allí `check:py` y `check:ui`.

Los **e2e** van aparte porque levantan procesos (no entran en `check`):
`pnpm e2e` corre todos los escenarios de `e2e/escenarios/` y
`pnpm e2e -- <nombre>` solo uno. Cada corrida levanta su core y sus dos Vites (desktop y web) temporales: si
18765, 15175 o 15174 están ocupados (p. ej. tu `pnpm dev`), el runner elige
otros libres y lo dice, sin matar lo ajeno; `--core-port`, `--ui-port` y
`--web-port` los fijan, y un explícito ocupado avisa y no arranca. Al terminar
—pase, falle o se interrumpa con Ctrl+C— cierra lo que levantó y comprueba
que los puertos quedan libres. Las capturas de cada corrida quedan en
`e2e/resultados/`.

`/health` publica la `version` del core y la `repo` por defecto que comparte la
configuración, y comprueba el fichero `EVENTSUI_DB` (por defecto,
`data/events.db`). El historial que ve la UI se lee de la tabla `event` del
repositorio seleccionado.

Las mutaciones (`POST`, `PATCH`, `DELETE`) solo aceptan orígenes de la propia
UI: el webview de Tauri, el mismo origen del core (la web montada en
`/webapp`) y lo que liste `EVENTSUI_ORIGENES` (orígenes completos separados por
comas, p. ej. `http://localhost:15176`). `EVENTSUI_DESARROLLO=1` —lo ponen
`pnpm dev` y el runner e2e— abre además cualquier `http` de bucle local,
porque Vite salta de puerto; sin esa variable, otro dev server local recibe
403. La misma lista decide CORS: una web estática con `VITE_API_URL` apuntando
al core tiene que estar en `EVENTSUI_ORIGENES` para poder leer las respuestas.

La raíz elegida y el puerto también viven en `config.json`, dentro de los datos
del usuario (`%LOCALAPPDATA%/EventsUI`; `EVENTSUI_CONFIG` cambia la ruta), no
solo en el `localStorage` del webview: la UI lo escribe al abrir una carpeta
y el CLI o el MCP lo leen. `eui doctor` comprueba fichero, core, versión
coincidente, raíz y permiso de escritura; `--json` devuelve una línea para
agentes y sale con 1 si algo falla:

```bash
uv run --directory shared/core python -m events_core.cli doctor
uv run --directory shared/core python -m events_core.cli config --json
uv run --directory shared/core python -m events_core.cli repo
uv run --directory shared/core python -m events_core.cli mapa --json
uv run --directory shared/core python -m events_core.cli puertas --json
uv run --directory shared/core python -m events_core.cli guard
uv run --directory shared/core python -m events_core.cli item list --status proposed
uv run --directory shared/core python -m events_core.cli schema --pretty
uv run --directory shared/core python -m events_core.cli schema migrate --pretty
uv run --directory shared/core python -m events_core.cli migrate scan docs --json
uv run --directory shared/core python -m events_core.cli migrate classify docs --json
uv run --directory shared/core python -m events_core.cli migrate check migracion/plan.json
uv run --directory shared/core python -m events_core.cli migrate apply migracion/plan.json
uv run --directory shared/core python -m events_core.cli migrate undo <lote>
uv run --directory shared/core python -m events_core.cli item create --title "Revisar el login" --tag ui
uv run --directory shared/core python -m events_core.cli item edit <uid> --description "..."
uv run --directory shared/core python -m events_core.cli item move <uid> roadmap --resultado "..."
uv run --directory shared/core python -m events_core.cli item fases <uid> fases.json
uv run --directory shared/core python -m events_core.cli item requisito <uid> 1 1 --hecho
```

`repo` enseña la raíz configurada (`repo list`, las del laboratorio), `mapa`
trae el mapa entero de una lectura (el mismo `GET /mapa` que pinta la UI),
`puertas` dice qué está cerrado ahora y por qué (`GET /puertas`, la política que
aplica el MCP) e `item list|get` leen, mientras `create|edit|move|fases|requisito` escriben con el mismo
contrato que la UI, y `schema` vuelca el OpenAPI del core (`schema puertas`
valida el archivo de la política). Todos aceptan `--repo`/`--url`/`--port` para pisar la configuración y
`--json` de una línea; salen con 0 bien, 1 no encontrado y 2 fallo o mal uso.

### La guarda del flujo

`.EUI/protocolos.json` es la política del repo: enumera las puertas que aplican
(`eui schema puertas` publica su esquema) y, sin archivo, valen los presets del
core. Se versiona: `.gitignore` excluye `.EUI/*` y reincorpora ese archivo.
`eui guard` comprueba los documentos fuera del flujo y enseña las puertas
activas —sale con 1 solo si hay documentos—, y `eui guard --hook` lee
`{tool, ruta}` por stdin y sale 0 o 2, que es lo que se enchufa al
pre-herramienta de un agente o al pre-commit (`.githooks/pre-commit`, con
`git config core.hooksPath .githooks`). El paquete no puede impedir que alguien
escriba con su editor: la guarda detecta y el hook del host decide; lo que sí
cierra son las herramientas del MCP.

La migración de Markdown empieza por `migrate scan`, que solo lee: recorre una
carpeta del repo y devuelve cada `.md` con su `sha256`, frontmatter, títulos y
tareas. `migrate classify` (alias `plan`) propone el manifiesto `documentos`
(allowlist `mapa`/`parcial` vs `referencia`). Las pautas para el agente están
en [`docs/migracion.md`](docs/migracion.md), y el esquema sale de
`eui schema migrate`; `migrate check` lo valida sin escribir (refs, ciclos,
origen, hash y clasificación). `migrate apply` lo envía al core en una
transacción (`POST /migracion/aplicar`); repetir el mismo plan no duplica.
El plan v2 admite `proposed`/`draft`/`historial`/`rejected`; el v3 añade
`documentos`. `migrate undo <lote>` lo deshace
(`DELETE /migracion/lotes/{lote}`) solo si nadie movió, editó o reemplazó sus
ítems después.

El CRUD del CLI no adivina campos: `create` manda título, descripción,
contenido, tipo, estado, etiquetas y dependencias; `edit` cambia solo lo que se
le da (`--tag`/`--dep` reemplazan la lista y `--sin-etiquetas`/
`--sin-dependencias` la vacían); `move` lleva los datos de la ficha de destino
(`--resultado`, `--verificacion-resultado`, `--nota`, `--motivo`,
`--sustituye-a`…); `fases` reemplaza la lista desde un JSON y `requisito` marca
o desmarca uno conservando estados, notas y el resto de marcas. Todos aceptan
`--json`.

### MCP para agentes

`eui` y el MCP son las dos caras del mismo cliente. El servidor MCP habla
JSON-RPC por stdio (`python -m events_core.mcp_servidor`, o `eui mcp`) y no
reimplementa nada: cada herramienta arma el comando del CLI y devuelve su
`--json` como texto. Arranca en solo lectura; las herramientas que escriben
solo se anuncian con `--permitir-escritura` o `EVENTSUI_MCP_ESCRITURA=1`.

```json
{
  "mcpServers": {
    "events-ui": {
      "command": "uv",
      "args": [
        "run", "--directory", "<ruta-a-events-ui>/shared/core",
        "python", "-m", "events_core.mcp_servidor"
      ],
      "env": { "EVENTSUI_MCP_ESCRITURA": "1" }
    }
  }
}
```

Herramientas de lectura: `doctor`, `repo_actual`, `repo_list`, `item_list`,
`item_get`, `mapa`, `migrate_scan`, `migrate_classify` y `migrate_check`. Con escritura
se suman `item_create`, `item_edit`, `item_move`, `item_fases`,
`item_requisito`, `migrate_apply` y `migrate_undo`. El esquema del plan se lee
en el recurso `eui://schema/plan-migracion`, y el mapa en `eui://mapa` (mismo
JSON que `GET /mapa`, con la raíz configurada). stdout es solo protocolo; los
errores del CLI vuelven como `isError: true` y los logs van a stderr. Las
puertas del flujo retiran herramientas según el mapa: `tools/list` no anuncia
las que una puerta cierra y `tools/call` las rechaza con su motivo, así que la
política de `.EUI/protocolos.json` se aplica también al agente.

El registro operativo de la app (arranques, errores y operaciones) vive en su
propio SQLite, `data/registro.sqlite` en la raíz del repo (`EVENTSUI_REGISTRO_DB` para cambiarlo);
se ve con `GET /log` y su purga —90 días / 2.000 entradas, automática al
escribir— también se puede forzar por `POST /log/purgar`.

Los tipos TS del cliente no se escriben a mano: se generan del OpenAPI del
core con [`openapi-typescript`](https://openapi-ts.dev/) y las llamadas van
por [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch), tipado por esos
`paths`: ruta, query y el **cuerpo** de POST/PATCH se comprueban contra el
contrato (`api.POST("/items", { params, body })` compone el `body` contra
`WorkItemCreate` generado). El cliente vive en `packages/ui/src/core/api.ts` junto
con `unwrap`, que convierte el error del core en su `detail`. Tras
cambiar la API del core:

```bash
corepack pnpm gen:api    # vuelca app.openapi() y regenera la UI
```

Eso deja `packages/ui/openapi.json` (snapshot versionado: el diff muestra qué
cambió del contrato) y `packages/ui/src/core/schema.ts` (generado, no editar).
`api.ts` deriva `WorkItem`, `Mapa`, `Revision` y `RepoListado` de
ahí, así que un cambio en el core se ve en el siguiente `check`. No necesita
el core en marcha: el volcado importa la app con `uv run` (módulo
`events_core.dump_openapi`).

pnpm 11+ no ejecuta postinstall de dependencias sin permiso: la política vive en
`allowBuilds` dentro de `pnpm-workspace.yaml`, no en `package.json`.

## Ítems por repositorio

La primera tabla no es la de eventos, es la de ítems.
La carpeta raíz elegida lleva dentro `.EUI/EUI_DATABASE.sqlite`, un SQLite con esa tabla: los
ítems sobre un repo viajan con su código.

La raíz es la carpeta que se abre en la app —la del diálogo nativo o el nombre dentro
de `repoprobe/repos`— y es la única que se siembra: desplegar subcarpetas en Files no
crea `.EUI` en ellas. Abrir una subcarpeta como raíz la convierte en un workspace
propio, con su propio almacén; el estado de Git puede seguir viniendo del repo que la
contiene. Es la misma regla que VS Code: lo que abres es la raíz.

La primera petición sobre esa raíz siembra su `.EUI/EUI_DATABASE.sqlite` con el
esquema de `schema/` si aún no está, así que abrir un repo en la UI basta. El seed sigue
existiendo para hacerlo sin arrancar el core:

```bash
git clone <url> repoprobe/repos/<repo>
corepack pnpm core:seed <repo>   # o <ruta-absoluta>: siembra esa raíz
corepack pnpm core:dev           # Swagger en http://127.0.0.1:18765/docs
```

| Método | Ruta |
| --- | --- |
| GET | `/repos` — carpetas del laboratorio ya sembradas |
| GET | `/fs?path=<ruta>` — un nivel del explorador de carpetas (raíz del usuario o `EVENTSUI_FS_ROOT`) |
| GET / PUT | `/config` — raíz por defecto y puerto compartidos con el CLI |
| GET | `/archivo?repo=<ruta>&ruta=<relativa>` — texto de un archivo (512 KiB, 415 si es binario) |
| GET | `/archivo-bytes?repo=<ruta>&ruta=<relativa>` — bytes de una imagen (12 MiB, solo `image/*`) |
| GET | `/items?repo=<ruta>` (filtros `status`, `kind` — `work_item`, `adr`, `note` —, `limit`, `offset`) |
| POST | `/items?repo=<ruta>` |
| GET / PATCH / DELETE | `/items/{uid}?repo=<ruta>` |
| GET | `/mapa?repo=<ruta>` — los ítems del mapa en una sola lectura |
| GET | `/revision?repo=<ruta>` — firma barata (`PRAGMA data_version` + conteos) para el refresco en vivo |
| POST | `/migracion/aplicar?repo=<ruta>` — aplica un plan de migración como lote (cada ítem a su carril, idempotente) |
| DELETE | `/migracion/lotes/{lote}?repo=<ruta>` — deshace el lote si sus ítems no cambiaron (409 con conflictos) |
| GET | `/protocolos?repo=<ruta>` — uniones permitidas entre carriles (allowlist) |
| GET | `/eventos?repo=<ruta>` — tail del log (`desde`, `limite`, `origen`) |
| GET | `/eventos/stream?repo=<ruta>` — SSE en vivo con backfill |
| POST | `/eventos/compactar?repo=<ruta>` — aplica la retención del log (90 días / 5 000) |
| GET | `/proyecciones/repo?repo=<ruta>` — identidad (ruta, si es work tree Git, raíz, rama/commit) y conteos del repo |
| GET | `/log` — registro operativo de la app (filtros `nivel`, `origen`) |
| POST | `/log/purgar` — purga del registro forzada (también pasa sola al escribir) |
| POST | `/reiniciar?repo=<ruta>` — vacía ítems, fichas y eventos del laboratorio |

### Pruebas en el laboratorio

En escritorio, abre un repo de `repoprobe/repos` (o de la raíz configurada en
`EVENTSUI_REPOS_ROOT`) y pulsa **Pruebas → Lanzar**. Puedes cerrar el diálogo
para ver el movimiento y volver a abrirlo para consultar los pasos. El selector
del lanzador ofrece:

- **Reparto y limpieza**: diez ítems, siete en cola y tres descartados.
- **Mapa completo por carriles**: siembra ítems en todos los carriles, con
  fases en varios estados, requisitos, motivos y dependencias, para ver las
  fichas, los contadores, los cables, sus compuertas y el grosor según la
  presión.
- **Cable en marcha**: un ítem salta de carril en carril cinco veces para ver
  el cable de llegada abrirse en guiones y correr con la chispa.
- **Fases hasta aprobar**: un ítem con una fase recorre el flujo hasta la
  aprobación, con las compuertas de fases en el camino.
- **Fases: crear, completar y fallar**: un ítem con cuatro fases recorre
  pendiente, completada, fallida y rechazada, con pausas para mirarlo, y
  termina cruzando a verificación cuando ya no queda ninguna abierta.
- **Fases: el motivo sobrevive**: una fase rechazada con motivo vuelve a la
  cola como pendiente sin perderlo.
- **Fases con requisitos**: una fase con dos requisitos se completa solo al
  cerrarlos y entonces cruza a verificación.
- **Ida y vuelta y descarte**: un ítem llega a verificación, vuelve a la cola y
  se descarta con motivo.

Cada prueba deja seis segundos para ver el resultado y después **vacía todos los
datos operativos del lab**, incluidos los anteriores a la prueba. Detenerla o
fallar un paso también activa la limpieza. Se conservan las reglas del repo, el
esquema y el registro operativo de la app. Si el core falla durante el vaciado,
el diálogo ofrece **Reintentar limpieza**.

Si la app se cierra a mitad de la prueba, al reabrir el mismo laboratorio se
cobra el vaciado pendiente: la ejecución deja una marca con latido en
`localStorage`, y una marca con latido reciente (otra ejecución viva en ese
laboratorio) se respeta. La batería E2E corre en sus propios puertos: si 18765
o 15175 están ocupados por la app, el runner elige otros libres;
`--core-port`/`--ui-port` los fijan.

### Flujo de carriles

El recorrido por defecto es **entrada → cola → roadmap → verificación → revisión aprobada → historial**.
Desde entrada o cola se puede descartar un ítem. Desde verificación se puede
devolver al final de la cola, volver a roadmap para rehacerla o descartarla con
su motivo; el mapa dibuja un nodo de **Revisión rechazada** que cuelga del nudo
del cable Verificación→Revisión aprobada y tres cables ortogonales de vuelta,
sin un carril nuevo. Aprobar archiva: el ítem cae en historial con sus fases y ya no se mueve
ni se edita desde el mapa. El core admite un ítem activo en roadmap y consulta
`protocolo_flujo` para autorizar los traslados entre grupos. La UI obtiene esas
reglas con `GET /protocolos`.

La línea termina en un nodo **Git** de solo lectura. Se enciende cuando la
carpeta es un work tree Git —también con un `git init` sin commits— y se apaga
si no lo es. Una carpeta ignorada por el repo que la contiene no cuenta, que es
el caso del laboratorio dentro del repo de la aplicación. La proyección expone
`git`, `git_root`, `branch`, `commit`, `git_cambios` y `eui_ignorado`; este
último dice si el `.EUI` entraría en el próximo commit (`False`), si el repo ya
lo ignora (`True`) o si no hay Git (`None`). Resumen lo enseña y ofrece
«Ignorar .EUI», que añade `.EUI/` al `.gitignore` de esa raíz.

Hay dos mapas enlazados. El **Mapa de Trabajo** termina en el puente **Entregar
a Git**, que solo se activa con work tree y abre el **Mapa de Git**.
Su primer nodo, **Cambios sin commit**, lista lo que ve
`git status --porcelain`: archivos modificados, preparados o sin seguimiento.
Si Git está apagado, el puente y el nodo también lo están y no inventan cambios.
Se cambia con las pestañas de arriba o con el botón del puente; al cambiar,
la cámara reencuadra y los nodos se funden en cascada. El repo local se crea
(`git init`) y se elimina (solo su `.git`, sin tocar `.EUI`) desde el propio
puente, con confirmación: `POST /git/inicializar` lo crea y `POST /git/eliminar`
lo borra, sin anidar dentro de otro repo ni tocar el `.git` de un contenedor.

Un ítem puede declarar `depende_de` (uids de otros ítems del repo): el core no
lo deja entrar en roadmap, verificación, revisión aprobada ni historial mientras
alguno de ellos no esté aprobado (`revision_aprobada` o `historial`). Se edita con el `PATCH` del ítem y la fila
del mapa enseña a quién espera; las dependencias descartadas no liberan.

Para actualizar un almacén v12 existente, ábrelo desde la aplicación o ejecuta
`core:seed`: en los dos casos se aplica la migración que falte. Si un almacén
quedó marcado como v13 por el fallo anterior de `core:seed`, al abrirlo se
termina la migración 0013. Consulta el
[modelo de datos](docs/base-de-datos.md) y la [migración de Markdown](docs/migracion.md).

`repo` es la ruta de la carpeta (la que devuelve el selector de la UI) o un nombre
dentro de `repoprobe/repos`. Va en query porque las rutas de Windows no son un
segmento válido de URL.

Sin ORM y sin scripts sueltos: el esquema vive en
`shared/core/src/events_core/schema/*.sql` y las operaciones se hacen por API,
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
(dentro se ignora el `PRAGMA`): sin eso, tirar `work_item_data` arrastraría su nodo
y el detalle por `ON DELETE CASCADE`. El paso `0004` es el ejemplo: reconstruyó la tabla de ítems de entonces para añadir `CHECK (json_valid(tags))`.

## Estado

- **F0 (hecho):** andamio, `/health`, proxy UI→core.
- **F0.5 (hecho):** tablas de ítems, seed de `.EUI/EUI_DATABASE.sqlite`, API CRUD por repo.
- **F0.6 (hecho):** `/revision` y visor en vivo: cada dos segundos se comprueba la
  revisión y, si cambia, se lee `/mapa`. Un ítem se anima al pasar entre carriles.
- **F0.7 (hecho):** la UI escribe, no solo mira: crear ítems («Nuevo ítem»), editar
  título/descripción/tags y moverlos entre carriles. Eliminar es un segundo paso
  solo desde Descartadas (nodo Eliminadas con quema visual; el core rechaza el
  DELETE fuera de `rejected`/`superseded`). Todo por `openapi-fetch` tipado por
  el OpenAPI generado, con los errores 400/404 declarados en el contrato.
- **F1–F3 (hecho):** sobre de evento + SSE en vivo por repo (F1), proyección de repo
  con identidad git (F2) y empaquetado con sidecar Python en la desktop, con
  bandeja (F3). El instalador firmado queda fuera (cuesta dinero).
- **Dependencias entre ítems (0018) y fuera `connections` (0019)**: un ítem
  declara `depende_de` y no avanza de carril hasta que esos ítems estén
  aprobados; la tabla de conexiones y sus enlaces laterales se retiraron, así
  que el mapa pinta cada carril plano.
- **El ítem y su nodo (0020)**: `work_item_data` guarda qué es el ítem y
  `work_item_node` dónde está (`estado`, `posicion` y `entered_at`), una fila
  por ítem; el detalle
  de cada carril vive en `roadmap_node`, `verificacion_node`, `revision_node` y
  `rejected_node`. La entrada (`draft`) es un nodo más y no hay triggers de
  exclusividad: no puede estar en dos carriles porque solo tiene una fila.
- **Fases del ítem (0021)**: `work_item_fase` lo descompone con su propio estado
  (`pendiente`, `completada`, `fallida`, `rechazada`); el protocolo puede exigir
  al menos una para cruzar una unión (`protocolo_flujo.exige_fases`, hoy al
  entrar en roadmap y al aprobar la revisión, 0024) y ninguna abierta para salir de él a verificación
  (`exige_fases_listas`, 0022), y todas completadas para aprobar la revisión
  (`exige_fases_completas`, 0023). La lista viaja en el `PATCH` y se reemplaza
  en la misma transacción que el traslado. Al aprobar se exige además que todos
  los requisitos estén hechos y el ítem se archiva en historial.
- **Archivos por fase (0028)**: `work_item_foto` guarda la última foto del árbol
  y `work_item_fase_archivo` los cambios de cada fase. No hay watcher: se fotografía al
  entrar en roadmap (donde empieza el trabajo) y cada vez que una fase se
  cierra; lo que cambió entre dos fotos es lo que tocó esa fase. Sin Git solo
  van ruta y estado (`nuevo`, `modificado`, `borrado`); con Git, además, el
  parche del archivo, acotado por tamaño. La base del propio repo (`.EUI`) y lo
  ignorado por Git nunca cuentan. La fila resume con un contador (`2 archivos`) y
  la ficha los lista; el que tiene parche se despliega al pulsarlo. Cada
  requisito enseña los archivos que cambiaron mientras se hacía; lo que se marca
  en bloque o lo cierra la fase se queda en la fase. Deshacer la marca de un
  requisito no borra lo anotado: un clic de más no se lleva el registro. Un ítem que nace ya en
  roadmap también toma su foto de partida, y un archivo movido se anota una vez
  (`renombrado`, con su origen) en vez de como borrado y nuevo.
- **Historial (0026)**. Aprobar es la compuerta: el core guarda la firma en
  `revision_node` y deja el ítem en `historial` con sus fases y requisitos. El
  carril es terminal y se lee sin editar. La migración archiva las aprobadas
  existentes y conserva su firma.
- **Flujo de ítems (0013)**. La migración incorpora roadmap, verificación y
  revisión aprobada, y traslada las fichas históricas de completadas a `revision_node`.
- **Log con pestañas:** un solo flyout con `Eventos` (timeline del repo, por
  origen y nivel) y `Registro` (operativo de la app, por etiqueta y nivel).

## Histórico: por qué queda `idea` en el repositorio

La primera versión llamó «idea» a lo que hoy es un ítem de implementación. El
renombrado terminó: la API solo publica `/items`, el CLI solo tiene
`eui item …`, el MCP solo anuncia `item_*`, el almacén habla `work_item_*`
(0034), el lote vive en `migracion_item` (0035) y el tipo del dato se llama
`work_item` (0036). La UI también: sus componentes (`NuevoItem`, `EditorItem`,
`DescartaItem`), variables (`items`, `cargarItem`) y copy dicen ítem; «Work
Item» queda para el dominio.

`idea` sigue apareciendo en cuatro sitios, y ninguno es un alias vivo:

- las migraciones `0001`–`0036`, que son historia y no se tocan;
- `kind: "adr"` y `"note"`, tipos históricos que se leen pero no se crean;
- la clave `ideas` que trae un plan v1-v3 guardado: el contrato la acepta como
  alias de `items` al leer (`PlanWorkItem`) y escribe siempre `items`;
- los eventos `idea.*` que ya estén escritos en un log: el lector los sigue
  pintando y filtrando junto a los `item.*`.

## Licencia

MIT — ver [`LICENSE`](LICENSE).
