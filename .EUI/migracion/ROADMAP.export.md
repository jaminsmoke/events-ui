# ROADMAP

> Exportado desde Events UI · 98 ítems · documento `ROADMAP.md`

## Backlog

- **PATH opt-in.** Instalar `eui` en el PATH es una casilla del instalador,
  nunca por defecto, con el binario en los datos del usuario; el MCP se
  configura por ruta absoluta, sin depender del PATH.

- **Clasificación y manifiesto de documentos.** `migrate classify` o
  `migrate plan` produce `{documentos: [{ruta, clase, motivo, destino}]}`,
  con una allowlist de documentos que alimentan el mapa y el resto como
  referencia; `check` exige que todos los bloques estén clasificados y que
  los parciales declaren sus rangos.

- **Absorción total.** `migrate absorb <lote> --dry-run|--confirmar` copia el
  origen a `.EUI/migracion/`, comprueba que no queda ningún bloque sin migrar
  y solo entonces retira el fichero. `undo` restaura la copia si el hash
  sigue.

- **Absorción parcial.** Después de la total: rangos no solapados, se retiran
  solo los bloques migrados y queda un marcador visible con el uid; nunca
  por defecto.

- **Stub o export del ROADMAP.** Al absorber el ROADMAP entero, dejar un stub
  generado con contadores y cómo abrirlo en EventsUI, o exportarlo desde el
  almacén; el repo no se queda sin roadmap público.

## Hecho

- **Arranque en un comando** (`scripts/dev.mjs`): `pnpm dev` levanta el core
  si no está y lo apaga al salir; arranca siempre en limpio (un core viejo
  atendiendo dejaba `ECONNREFUSED 127.0.0.1:18765` y un mapa caducado).

- **UI compartida desktop + web** (`packages/ui`): `apps/desktop` (Tauri con
  diálogo nativo, 15175) y `apps/web` (Vite, 15174) montan el mismo visor.
  El selector de repo funciona en ambos (lista de `GET /repos` + ruta manual).

- **Cliente generado del OpenAPI**: tipos con `openapi-typescript`, llamadas
  con `openapi-fetch` tipado por `paths`; errores 400/404 declarados en el
  contrato (`ErrorDetail`) y `pnpm check` falla si `schema.ts` no está
  regenerado (`check:contract`).

- **La UI escribe**: crear, editar, borrar y mover ideas por la API tipada.
  Las conexiones no se gestionan desde la UI: son arquitectura.

- **Estado por idea**. El core mueve la idea de nodo en una transacción: un
  `UPDATE` de `idea_node` con carril, posición de cola y fecha de entrada. La
  entrada es un carril más, no una ausencia.

- **Dependencias entre ideas** (0018): `idea_data.depende_de` guarda los uids
  que bloquean el avance. El core valida que existan, rechaza auto-dependencias
  y ciclos, limpia el uid al borrar y frena roadmap/verificación/revisión
  aprobada mientras alguna no esté aprobada. La fila del mapa enseña a quién
  espera y permite añadir o quitar dependencias. El mapa es plano: `connections`
  se retiró en la 0019 y cada carril pinta su lista sin anidar.

- **F1 — motor en vivo por repo**: sobre de evento (`id`, `ts`, `type`,
  `payload`, `dedupe_key`) en la tabla `event` de cada `EUI_DATABASE`
  (migración 0005), conexión RO, tail `WHERE id > :last` y SSE con backfill
  (`GET /eventos` y `GET /eventos/stream`). Renderers conocidos para
  `idea.created`/`updated`/`deleted`/`status` y fallback genérico.

- **F2 — proyección de repo**: `GET /proyecciones/repo` con identidad
  (ruta + rama/commit git) y conteos; el core emite `idea.*` al escribir.

- **F3 — sidecar empaquetado**: el core se congela con PyInstaller
  (`sidecar.py` + `pnpm build:sidecar`, verificado con `/health` en frío) y
  viaja como `externalBin` de Tauri; en release `lib.rs` lo arranca junto al
  ejecutable y lo mata al salir, y la UI empaquetada habla directo con
  `127.0.0.1:18765` (`.env.production`). `pnpm release` construye el sidecar
  antes del bundle desktop.

- **F3 — bandeja y avisos**: cerrar la ventana minimiza a la bandeja (el
  sidecar sigue vivo para los avisos); «Salir» del menú es la única salida
  y lo mata. Notificaciones del sistema con ajustes de verbosidad
  (apagado / errores / eventos / todo) y «solo cuando no estoy mirando»,
  guardados en `localStorage`.

- **Protocolos de flujo** (0011): la allowlist `protocolo_flujo` decide qué
  traslados entre carriles están permitidos; lo no listado se rechaza con
  400. La UI apaga los traslados prohibidos validando la respuesta con Zod.

- **Flujo completo** (0013). Roadmap, verificación y revisión aprobada tienen
  ficha propia. La migración recoge las antiguas completadas en `revision_node`.

- **Versionado único** (`scripts/bump.mjs`): la raíz es la fuente de verdad;
  `pnpm bump` sin argumento es el check, con argumento fija la versión y
  sincroniza el lockfile. `pnpm release` encadena bump + gen:api + check +
  builds + commit + tag `vX.Y.Z`.

- **Retención del log** (`eventos.compactar`): 90 días / 5 000 eventos por
  repo, `POST /eventos/compactar` y CLI `events_core.compact`;
  con `VACUUM` cuando hay hueco bastante.

- **Log con pestañas**: un solo flyout con `Eventos` (timeline del repo) y
  `Registro` (operativo de la app), coloreado por nivel y filtrado por
  etiqueta (`origen`).

- **Etiquetas del editor sin pérdida**: la carga se hace una sola vez al abrir,
  el refresco de 2 s no pisa el borrador y, si la lectura falla, guardar sin
  tocar el campo no envía `tags`. Cubierto por `e2e/escenarios/editor-conserva-etiquetas.mjs`.

- **Actualización con `core:seed`**: sobre un almacén existente el comando migra
  por número en vez de reaplicar el esquema fresco; la segunda ejecución no
  toca nada y un v13 firmado sin migrar termina la 0013 al abrirse. Cubierto
  por `services/core/tests/test_seed_migracion.py`.

- **Almacenes anteriores a `user_version`**: un fichero histórico con la
  tabla `ideas` se copia a `idea_data` (y su nodo) conservando UID, campos y estado
  (`proposed` a cola, `accepted` a revisión aprobada, `rejected`/`superseded`
  a descartada), y `connections` se retira (0019).
  También se recupera un v13 que ya quedó marcado con la fila en la tabla
  vieja. Cubierto en `services/core/tests/test_idea_cola.py`.

- **Edición de la ficha activa**: un PATCH sin `status` (o reafirmándolo)
  actualiza la ficha en la que ya vive la idea (roadmap, verificación,
  revisión aprobada o descarte); un campo de otra ficha recibe un 400
  claro. Cubierto en `services/core/tests/test_flujo_items.py`.

- **Protocolos personalizados**: la migración 0013 copia las uniones
  antiguas tal como están y solo añade las nuevas, así que una unión
  retirada en v12 (p. ej. `draft → rejected`) sigue retirada tras migrar.
  Cubierto en `services/core/tests/test_seed_migracion.py`.

- **Orden de cola en el mapa**: `GET /mapa` entrega cada carril en el mismo
  orden que `GET /ideas` (la cola por `posicion`, roadmap y verificación por
  `started_at`), así que devolver una idea desde verificación la deja al final
  también en el visor. Cubierto en `services/core/tests/test_flujo_items.py`.

- **Intentos de verificación acumulados**: el contador vive en la entrada
  (`verificacion_intentos`, migración 0014), no en la ficha, así que una
  segunda vuelta por cola y roadmap muestra dos intentos aunque la ficha se
  retire al salir. Cubierto en `services/core/tests/test_flujo_items.py`.

- **Rutas con `#`**: la conexión de solo lectura escapa la ruta antes de
  armarla como URI (`uri_lectura`), así que una carpeta `carpeta#1` no se parte
  en fragmento y `/mapa`, `/revision` y el log abren su almacén. Cubierto en
  `services/core/tests/test_rutas.py`.

- **Ráfagas en el stream**: al cambiar la firma, el vivo drena el log por
  páginas hasta vaciarlo; una transacción de 250 eventos entrega los 250 en
  orden aunque no haya otra escritura. Cubierto en
  `services/core/tests/test_sse.py`.

- **Primer uso del historial**: el almacén siembra su propia tabla `event`
  (y la 0015 se la añade a los que nacieron sin ella), así que el primer
  `idea.created` queda en el log y `GET /eventos` lo devuelve. El runner de
  e2e ya no crea la tabla a mano. Cubierto en
  `services/core/tests/test_sse.py`.

- **Cursor tras vaciar el log**: si el log se vacía y los IDs vuelven a
  empezar, el stream reinicia el cursor cuando queda por delante del último
  evento, tanto en la conexión viva como al reconectar con `Last-Event-ID`,
  en vez de omitir el alta nueva. Cubierto en `services/core/tests/test_sse.py`.

- **Compatibilidad de tipos históricos**: un almacén con `kind = 'adr'` o
  `'note'` se lee entero; el contrato conserva esos valores al devolver la
  idea y sigue sin ofrecerlos al crear o editar. Cubierto en
  `services/core/tests/test_idea_cola.py`.

- **Borrado de una idea sustituta**: si otra ficha la referencia en
  `superseded_by_uid`, el DELETE responde 400 con las ideas afectadas y no
  toca ni el vínculo ni ninguna de las dos; el dato se conserva. Cubierto en
  `services/core/tests/test_flujo_items.py`.

- **Reproducción de la base versionada**: `python -m events_core.instantanea`
  saca una copia con el API de backup (incluye el WAL confirmado), la deja sin
  auxiliares y comprueba `integrity_check`; verificado desde una copia limpia
  en `services/core/tests/test_instantanea.py` y documentado en
  `docs/base-de-datos.md`.

- **Límite de retención**: la edad se compara como instante
  (`datetime(ts) < datetime('now', …)`), así un evento de la mañana del día de
  corte ya no sobrevive a la retención; probado en ambos lados del corte para
  `event` y `registro` en `services/core/tests/test_retencion.py`.

- **Un nodo por idea** (0020): `idea_data` guarda qué es la idea y `idea_node`
  dónde está, con carril, posición y fecha de entrada. La exclusividad es por
  construcción (una fila), así que los triggers de la 0016 se retiraron; un
  índice parcial mantiene un solo roadmap activo. Cubierto en
  `services/core/tests/test_flujo_items.py`.

- **Fases de la idea** (0021): `idea_fase` la descompone con su propio estado
  (`pendiente`, `completada`, `fallida`, `rechazada`); `protocolo_flujo.exige_fases`
  marca la unión que no se cruza sin al menos una, hoy `proposed → roadmap` y
  `verificacion → revision_aprobada` (0024, para que cero fases no cuele), y
  `exige_fases_listas` la que no se cruza con fases pendientes o fallidas, hoy
  `roadmap → verificacion`, y `exige_fases_completas` la que pide todas en
  `completada`, hoy `verificacion → revision_aprobada`. La lista viaja en el
  `PATCH` y se reemplaza en la misma transacción que el traslado. Cubierto en `services/core/tests/test_fases.py`.

- **Historial (0026)**: aprobar archiva. `revision_aprobada` es la compuerta;
  al cruzarla, la firma se queda en `revision_node` y la idea pasa a `historial`
  en la misma transacción, con sus fases y todos sus requisitos hechos. El
  carril es terminal y la UI lo enseña de lectura. Las aprobadas existentes se
  archivan en la migración. Cubierto en `services/core/tests/test_flujo_items.py`
  y `e2e/escenarios/historial-aprobacion.mjs`.

- **Nodo Git (F2)**: la línea de ideas cierra en un nodo de estado que se
  enciende solo si la carpeta pertenece a un work tree Git. Un `git init` sin
  commits ya cuenta; una carpeta ignorada por el repo contenedor, como el
  laboratorio, no. La proyección separa `git`/`git_root` de `branch`/`commit`
  para no confundir «no hay repo» con «repo sin commits». El flujo de ideas
  cierra en el puente **Entregar a Git**, que abre el **Mapa de Git**; su
  primer nodo lista los cambios sin commit desde `git_cambios`. El repo local
  se crea y se elimina desde el puente, con confirmación (`POST /git/inicializar`
  y `POST /git/eliminar`, sin anidar ni tocar el `.git` ajeno); el botón
  «Volver a Ideas» sobraba junto a las pestañas y se retiró. Cubierto en
  `services/core/tests/test_git.py` y `e2e/escenarios/git-local.mjs`.

- **Revisión rechazada (0027)**: desde verificación se vuelve a roadmap para
  rehacer, a la cola para replanificar o a descartadas con motivo. No hay un
  carril nuevo: el mapa dibuja un nodo de rechazo que cuelga del nudo del cable
  Verificación→Revisión aprobada y tres cables ortogonales de vuelta con sus
  compuertas. La vuelta a roadmap conserva las fases; el descarte guarda su
  motivo. Cubierto en `services/core/tests/test_flujo_items.py`
  y `e2e/escenarios/mapa-completo.mjs`.

- **Archivos por fase (0028)**: cada fase se lleva los archivos que cambiaron
  mientras estuvo abierta. Va por eventos, sin watcher: se toma una foto del
  árbol al entrar en roadmap y al cerrar la fase, y el cambio es la diferencia
  entre las dos. Sin Git se anotan ruta y estado; con Git, además, el parche de
  cada archivo (acotado por tamaño). El mapa resume con un contador y la ficha
  lista los archivos; al pulsar uno con parche se despliega el cambio. Desde la
  0029 el evento también puede ser un requisito: lo que cambió hasta marcarlo es
  lo suyo, y la fase suma siempre a sus requisitos. Deshacer la marca no pierde
  lo anotado (solo se va si el requisito desaparece); volver a marcarlo suma. Un archivo movido se anota
  una vez como `renombrado` (con su `desde`), también sin Git, y una idea que
  nace en roadmap toma su foto de partida. Cubierto en
  `services/core/tests/test_archivos.py` y `e2e/escenarios/archivos-fase.mjs`.

- **Formato de etiquetas**: `tags` es una lista JSON de cadenas en el
  esquema (migración 0017, que sanea `{}` y los elementos no textuales) y en
  la API (422 con valores que no son cadenas); una fila antigua se lee como
  lista vacía en vez de tumbar `/ideas`. Cubierto en
  `services/core/tests/test_etiquetas.py`.

- **Ruta del registro operativo**: el destino por defecto es
  `<raíz del repo>/data/registro.sqlite` sea cual sea el directorio de
  arranque (el empaquetado, sin el marcador del repo, conserva el cwd);
  `EVENTSUI_REGISTRO_DB` sigue mandando. Cubierto en
  `services/core/tests/test_registro_ruta.py`.

- **Los cables se miden solo cuando toca**: `useCables` vuelve a medir con el
  zoom, con el tamaño del tablero y cuando cambia un nodo, pero ya no al
  arrastrar el lienzo: la medida va en coordenadas del mapa, así que `vista.x/y`
  no mueven ni un trazado. El aviso de recorte, que sí depende de dónde esté la
  cámara, se calcula aparte con dos `getBoundingClientRect()`.
  `e2e/escenarios/mapa-completo.mjs` comprueba que arrastrar mueve la vista y no
  los cables, y que el zoom tampoco los mueve.

- **`ideas` por capas**: `ideas.py` (2 113 líneas) pasó a un paquete con la
  misma API pública, así que ni el cliente ni los tests cambian de imports.
  `base/` no sabe de ideas (rutas del almacén, esquema y migraciones, y
  utilidades comunes); `modelo/` tiene las reglas del flujo (estados y fichas,
  dependencias y compuertas de fases y protocolos); `trabajo/` el desglose
  (fases, requisitos y anotación de archivos); y `consulta.py`/`crud.py` son las
  dos caras de la API. `__init__.py` es la fachada. Después salieron las
  migraciones a `base/migraciones.py` (el historial de versiones ya no sepulta
  la creación del almacén) y `tests/test_capas.py` vigila que nadie importe
  hacia arriba: recorre los imports de cada módulo y falla si uno mira a una
  capa superior. Cubierto por los tests del core, sin tocarlos.

- **El almacén al día no se abre dos veces**: `ensure_repo` comprobaba
  `user_version` en cada lectura —una conexión extra— y el llamante abría otra
  para leer o escribir. Ahora `migraciones` recuerda la huella del fichero
  (`mtime_ns`, tamaño) que dejó al día y se ahorra la conexión; si el fichero
  cambia por detrás (una copia restaurada, una migración desde fuera) vuelve a
  comprobarlo, y un intento fallido no deja la marca. Cubierto en
  `services/core/tests/test_almacen_al_dia.py`. El `.gitignore` de `.EUI` se
  sigue repasando en cada lectura: es un fichero de dos líneas y se deja.

- **El registro operativo se prepara una vez**: `registro.conectar` creaba la
  tabla y el índice (`IF NOT EXISTS`) en cada línea escrita; ahora la primera
  conexión del proceso prepara el fichero y las demás solo insertan. Si el
  fichero se recrea por debajo, la marca se olvida y la línea se reintenta una
  vez. Cubierto en `services/core/tests/test_registro_preparado.py`.

- **El sidecar se vigila**: en release un hilo arranca `events-core` si no hay
  nadie, espera `/health` (un GET mínimo escrito a mano, sin dependencias) y, si
  el hijo muere, lo vuelve a arrancar con espera creciente. Si el puerto ya lo
  atiende otro core, se usa ese en vez de arrancar otro encima. «Salir» marca la
  parada antes de matarlo, para que el vigilante no lo resucite.

- **La documentación va con el esquema**: `docs/base-de-datos.md` está en la
  versión 29 y lista `idea_requisito`, `idea_foto` y `idea_fase_archivo`; el
  README ya cuenta que el runner de e2e elige puertos libres en vez de negarse
  a arrancar.

- **`styles.css` partido por zonas**: las 2.324 líneas pasaron a `src/styles/`
  (base, marco, repo, ficha, log, mapa, cables y nodo), importadas desde
  `index.css`; el paquete sigue exportando `./styles.css`, así que las apps no
  cambian ni un import. El corte es mecánico —mismas reglas y mismo orden— y se
  comprobó que la suma de las zonas cuenta las mismas líneas que el fichero
  original.

- **`nodos.tsx` partido por componentes**: las 1.469 líneas pasan a `mapa/fila`
  (fila, cabecera y acciones), `fases` (editor de fases), `ficha-fases` (detalle
  y parches), `nodos-git` (estado, cambios y puente), `fase` (tipo y etiquetas)
  y `formato` (fechas); `nodos.tsx` queda como fachada con `NodeBox`,
  `VueloFila` y los tres nodos de Git, así que `App.tsx` no cambia ni un import.

- **Los guiones de las pruebas salen de `Pruebas.tsx`**: los nueve escenarios y
  sus tipos viven en `pantalla/guiones.ts` como datos; el componente se queda
  con el motor (pasos, latido, limpieza, reintento y diálogo) y baja de 1.194 a
  unas 250 líneas.

- **Las rutas de `main.py` por dominio**: el `app` se queda con CORS, los
  handlers de error y `/health`; las rutas viven en `routers/ideas.py`,
  `routers/eventos.py`, `routers/log.py` y `routers/git.py`, y los modelos y
  tipos compartidos en `contrato.py`. Se incluyen en el mismo orden en que
  estaban, así que el OpenAPI sale idéntico y `gen:api --check` no pide
  regenerar nada.

- **CI**: `pnpm check` global en cada push a main y en PRs
  (`.github/workflows/ci.yml`). Batería e2e y builds de Tauri quedan fuera
  del CI a propósito (navegador y puertos; se corren en local).

- **CI también en Windows**: un segundo job (`windows-latest`, Node 24, pnpm
  12 y Python 3.12) corre `check:py` y `check:ui` con los mismos comandos que
  en local, para que lo que solo se rompe en el sistema donde se desarrolla
  falle en el CI (rutas con unidad, `#` en el nombre del repo, venv de otra
  plataforma).

- **Tope global de parches por almacén**: `idea_fase_archivo` guarda una fila
  por archivo y fase, así que el tope por fase (512 KiB) no acotaba la base. Al
  escribir, si los parches pasan de 8 MiB se sueltan los de las fases más
  viejas —por `entered_at`, la fase entera y conservando ruta y estado— y el
  aviso queda en el registro. Medido: 16 fases llenas son 8 MiB de parches y un
  fichero de 8,02 MiB; hoy no hay almacenes en el repo, así que ese era el techo
  real, sin límite de fases.

- **El listado de un almacén vacío no falla**: `consulta._en_lote` cortaba sin
  uids devolviendo cuatro diccionarios cuando el llamador espera cinco, así que
  `GET /ideas` daba 500 en un repo recién sembrado —y con un `offset` más allá
  del final—. Ahora devuelve también el diccionario de fases;
  `test_listado_vacio.py` cubre el almacén vacío, el offset y un filtro sin
  resultados.

- **`seed` ya no siembra al importarse**: el `raise SystemExit` estaba al nivel
  del módulo, así que cualquier `import events_core.seed` imprimía el uso y
  salía con 2. Queda bajo la guarda `__main__`, con `test_seed.py` cubriendo el
  import y la CLI sin repo.

- **El `git status` del mapa lee rutas raras**: los cambios se piden con
  `--porcelain=v1 -z`, donde Git no entrecomilla ni escapa, y el origen de un
  renombrado viaja aparte en `CambioGit.origen`; el nodo de cambios lo enseña
  como «viejo → nuevo». Dos tests cubren un `git mv` con espacios y acentos y
  una ruta suelta con acentos y `#`.

- **Las conexiones vigilantes caducan**: cada entrada guarda el inodo del
  fichero y su último uso. Se suelta al recrearse el almacén (si no, seguía
  mirando el inodo viejo y `data_version` dejaba de subir), tras cinco minutos
  inactiva y con `cerrar_vigilantes()`. `test_db_vigilante.py` cubre
  reutilizar, recrear, caducar y soltar.

- **Un solo sondeo para el mapa**: `core/sondeo.ts` mantiene un temporizador
  común cada 2 s —antes tres, de 2 s, 5 s y 5 s—, se para con `document.hidden`
  y avisa al instante al volver. La proyección y los protocolos se piden uno de
  cada tres latidos (~6 s) y cada hook se salta el turno si ya tiene una
  lectura en vuelo.

- **El tope de contenido por fase cuenta bytes**: `archivos.contenidos` sumaba
  `len(texto)` (caracteres), así que un árbol no ASCII podía pasarse de los
  512 KiB en disco. Ahora mide `len(texto.encode("utf-8"))` y el test deja
  claro que 20 caracteres de 40 bytes no caben en 30.

- **Las mutaciones exigen origen conocido**: un `POST` con `Origin` ajeno
  responde 403 en vez de ejecutarse; sin `Origin` (CLI, e2e, tests) pasa, que es
  lo que un navegador no puede falsificar. Cubre POST, PATCH y DELETE, con test.

- **El registro del sidecar va a datos del usuario**: congelado, el core ya no
  usa el directorio de trabajo sino `%LOCALAPPDATA%/EventsUI`, y `lib.rs` arranca
  el sidecar con `current_dir` en su carpeta. Comprobado ejecutando el binario
  desde un CWD ajeno: allí solo queda el PID y el registro aparece en
  `LOCALAPPDATA`.

- **La instantánea abre el origen en solo lectura**, así que copiar no puede
  recuperar journals ni dejar auxiliares en el almacén versionado; el test la
  ejecuta con el fichero marcado de solo lectura.

- **`release.mjs` incluye `Cargo.lock`** en el commit del bump, así que el
  release deja de terminar con el árbol sucio.

- **`bump.mjs` reconoce la versión con argumentos extra o en varias líneas**:
  probado con el constructor de `FastAPI` partido y después restaurado.

- **Los instaladores los publica la CI**: al empujar el tag `v*`, el workflow
  `release` construye el sidecar y los bundles en Windows y adjunta MSI y NSIS
  a la GitHub Release (la crea con notas generadas si no existe, o reemplaza
  los adjuntos). `pnpm release` sigue subiendo la versión y creando el tag en
  local; la prueba con `workflow_dispatch` y `publicar: false` salió en verde
  sin tocar la release publicada.

- **El Mapa de Git enseña el historial**: `GET /git/commits` devuelve los
  últimos commits (`hash` abreviado, asunto, autor y fecha ISO) con `git log`;
  sin work tree o sin commits responde `[]`, que no es un error. El nodo
  **Commits** los lista bajo Git y Cambios, a todo el ancho de la línea y con
  scroll a partir de 20.

- **Los cambios vuelan a su commit**: cuando cambia HEAD y había cambios sin
  commit, sus filas salen del nodo de Cambios y aterrizan en la cabecera de
  Commits (~0,85 s, máximo 8 fichas), sin hooks: lo detecta el sondeo. El
  historial se pide al cambiar el hash, no en cada latido. Cubierto por
  `e2e/escenarios/vuelo-commit.mjs`, que comprueba que no quedan fichas
  colgadas; la revisión a ojo destapó que `.node` topaba el nodo en 340 px.

- **Runtime fijado a 3.12**: `.python-version` y el CI apuntan a 3.12 y
  `requires-python` cierra el techo en `<3.14`, así que `uv` deja de resolver
  contra el 3.14 del sistema, donde las pruebas síncronas de `starlette` se han
  visto quedarse colgadas en Windows. Ruff ya compilaba a `py312`. El aviso de
  `starlette.testclient` con `httpx` no venía del intérprete: lo emite
  `starlette` 1.10, y no se arregla bajando Python: se fue instalando `httpx2`
  en las dependencias de desarrollo.

- **Nodos y cables estables.** Las seis cabeceras mantienen su posición al llenar o plegar el mapa. Los cables se trazan en ángulo recto, como pistas de circuito impreso. Los cables de etapa se anclan a las cabeceras; la rama de Descartadas nace de un nudo en mitad del cable Entrada↔En cola y la de rechazo, del nudo del cable Verificación→Revisión aprobada.

- **Limpieza de la prueba manual.** La Prueba 1 deja ver el reparto y después vacía el laboratorio en una transacción, también al detenerla o fallar un paso. El E2E compara coordenadas y trazados, consulta las siete tablas operativas y comprueba los protocolos antes de que el runner haga su propia limpieza.

- **Prueba interrumpida al cerrar la app.** La ejecución deja una marca con
  latido en `localStorage`; al reabrir el mismo laboratorio, una marca sin
  latido se cobra vaciándolo y una con latido reciente (otra ejecución viva)
  se respeta. Cubierto por `e2e/escenarios/prueba-recuperacion.mjs`.

- **E2E con la app abierta.** El runner usa puertos libres cuando 18765 o
  15175 están ocupados (o los que pidan `--core-port`/`--ui-port`) y le pasa a
  Vite `EVENTSUI_UI_PORT` y `EVENTSUI_CORE_URL`; la batería termina sin parar
  la sesión de escritorio.

- **Inspector completo**: carril, idea, commit, cambio, historial, cable,
  puente, nodo de Git y nudos —con sus compuertas— tienen ficha en el panel
  derecho; las celdas de protocolo se pulsan y llevan a la ficha de su nudo.

- **Teclado en el lienzo**: las flechas recorren las paradas en orden
  —Entrada, carriles, ideas, nudos, cables y puente; en Git, el nodo, el
  historial, sus commits y los cambios— y Enter abre en el Inspector lo
  marcado. Escape sigue soltando la selección y los campos no se tragan las
  flechas.

- **Historial filtrable**: la ficha del nodo de commits filtra por asunto,
  hash o autor, sin tocar la selección ni el mapa, y cuenta lo que queda.

- **El almacén dice si se versiona**: la proyección expone `eui_ignorado` y
  Resumen lo enseña con una acción explícita que añade `.EUI/` al `.gitignore`
  de la raíz elegida —nunca al de una carpeta superior— de forma idempotente.
  Cubierto en `services/core/tests/test_git.py` y `e2e/escenarios/git-local.mjs`.

- **El inspector se prueba solo**: `e2e/escenarios/inspector.mjs` abre el
  panel por su icono, selecciona una idea y un carril desde el lienzo y desde
  la lista del propio panel, y comprueba que Escape y el clic en el fondo
  sueltan la selección. El resto de la batería sigue en verde.

- **Línea temporal de commits y primer Inspector**: el nodo **Commits** del
  Mapa de Git es una línea temporal (riel, un punto por commit, HEAD
  encendido) con una fila de 20 px por commit —asunto, hash y fecha—; el
  autor y la fecha larga pasaron al panel derecho, que estrena vista
  **Inspector** en la barra de actividad derecha y se abre al pulsar un
  commit. Las clases `.fila-commit`/`.nodo-commits` no cambian, así que los
  escenarios e2e que cuentan filas y leen el asunto siguen valiendo; la
  selección se verificó solo con `tsc`/`eslint`, falta la revisión a ojo.

- **Los instaladores se publican desde el tag**: al empujar `v0.2.3` el job
  construía el sidecar y los bundles pero saltaba «Publicar en GitHub Releases»
  y subía los MSI como artefacto del run. `inputs.publicar` solo existe en
  `workflow_dispatch`, así que en un push de tag quedaba vacío y GitHub lo
  comparaba como `false`; las condiciones miran ahora `github.event_name`, y
  `publicar: false` sigue sirviendo para reconstruir sin tocar la release.
  La v0.2.3 salió con su MSI y su NSIS.

- **Visor: decisiones**: Markdown con `react-markdown` 10 + `remark-gfm` 4 y
  sin `rehype-raw` —el HTML crudo se queda como texto, así que no hay
  `innerHTML` ni sanitizador que mantener—; el código con **Shiki** 4 desde
  `shiki/core` y el motor de regex JS (sin WASM), con gramáticas cargadas bajo
  demanda desde un mapa extensión→lenguaje; el bloque de código del Markdown
  reutiliza el mismo resaltador. Se descartan `highlight.js` (5,5 MB
  desempaquetado) y `prism-react-renderer` (734 KB y gramáticas más pobres en
  TSX y diffs): el coste inicial de Shiki es su core y crece solo con los
  lenguajes que se abren. Las imágenes del Markdown se resuelven contra el repo
  (`/archivo-bytes`) y los enlaces abren fuera; el visor vive en el panel
  derecho, no en un modal.

- **Lectura de archivos para el visor**: `GET /archivo` devuelve el texto de
  cualquier archivo del repo, acotado a 512 KiB (`bytes` real y `truncado`
  aparte), con UTF-8 tolerante, 415 en binarios y la guarda de rutas de
  `/arbol`; la ruta vuelve canónica. Cubierto en
  `services/core/tests/test_visor.py`.

- **Imágenes para el visor**: `GET /archivo-bytes` sirve solo `image/*` con su
  `Content-Type`, `nosniff` y tope de 12 MiB (413); comparte la guarda de rutas
  de `/archivo`. El visor pinta la imagen con sus medidas y resuelve las rutas
  relativas del Markdown. Cubierto en `services/core/tests/test_imagenes.py`.

- **Visor de archivos**: pulsar un archivo del Explorador lo abre en la vista
  **Archivo** del panel derecho —con su icono junto a Resumen e Inspector—, sin
  modal ni otro panel; esa vista se ensancha para leer. El árbol fija la
  extensión aunque el nombre se recorte. Markdown abre renderizado y ofrece Raw;
  un JSON válido abre formateado y guarda su fuente en Original; el
  resto se pinta con Shiki 4 —`shiki/core`, motor de regex JS y gramáticas bajo
  demanda—, con números de línea y texto plano si no hay gramática o el archivo
  pasa de 200 000 caracteres. El mapa cubre lenguajes de web, scripts, sistemas,
  datos e infraestructura; las extensiones desconocidas se leen sin colores. El
  HTML crudo del Markdown se queda como texto, los enlaces abren fuera y las
  imágenes —también las relativas del Markdown— se pintan desde
  `/archivo-bytes`; el fuente se puede copiar. También se abre desde la ficha de
  un cambio del inspector (un archivo borrado no ofrece el botón).
  Cubierto en `e2e/escenarios/visor.mjs` y `e2e/escenarios/git-local.mjs`.

- **Configuración compartida y `eui doctor`**: la raíz elegida vivía solo en
  `localStorage` (`eui.repo`) y el puerto, en constantes por proceso, así que un
  cliente de fuera no encontraba ni una ni otro. Ahora hay un `config.json` con
  `repo` y `port` en los datos del usuario (`%LOCALAPPDATA%/EventsUI`,
  `EVENTSUI_CONFIG` para cambiarlo): la UI lo escribe al abrir una carpeta
  (`PUT /config`, previa validación de la raíz en el core), `GET /health`
  publica versión y raíz, y `eui doctor`/`eui config` comprueban fichero, core,
  versión coincidente, raíz y permiso de escritura, con `--json` de una línea y
  salida 1 si algo falla. Encima de esa puerta, `eui repo` (y `repo list`),
  `eui idea list|get` con los filtros del contrato y `eui schema` leen por la
  misma API, con `--repo`/`--url`/`--port` y salidas 0/1/2 (bien, no encontrado,
  fallo). El CLI sale como módulo (`python -m events_core.cli`) con cliente
  HTTP propio sobre `urllib`, y la versión ya no se duplica: `__version__` en
  `services/core/src/events_core/__init__.py` la comparten core y CLI, y
  `bump.mjs` la sincroniza y la vigila. Cubierto en
  `services/core/tests/test_config.py`, `services/core/tests/test_cli.py` y
  `e2e/escenarios/config-compartida.mjs`, que abre el lab en la app y comprueba
  con `eui doctor` que la raíz llegó al fichero.

- **Migración: `eui migrate scan`**: recorre una carpeta del repo (o un Markdown
  suelto) sin salir de la raíz y sin escribir nada, y devuelve cada fichero con
  bytes, `sha256`, frontmatter simple, títulos fuera de bloques de código y
  tareas `[ ]`/`[x]`, más un resumen; orden estable, ignora `.git`, `.EUI`,
  `node_modules`, `.venv`, `dist` y `build`, y recorta a 1 000 ficheros
  avisando. Las pautas del agente —una idea por elemento accionable, todo a
  `proposed`, origen con líneas y hash— viven en `docs/migracion.md`. Cubierto
  en `services/core/tests/test_migracion.py`.

- **Esquema del plan de migración**: `eui schema migrate` publica el JSON
  Schema (2020-12) del plan que propondrá el agente y `--pretty` lo da para
  leerlo; `eui schema` sigue volcando el OpenAPI del core. El esquema cierra lo
  que no se negocia: `version: 1`, ideas no vacías, `ref` locales con patrón
  (`depende_de` apunta a refs, nunca a uids), `kind: idea`, `status: proposed`,
  fases solo en `pendiente`, requisitos sin marcar y un `origen` obligatorio por
  idea con ruta relativa, líneas 1-based y sha256 de 64 hex. Cubierto en
  `services/core/tests/test_migracion.py`.

- **Migración: `eui migrate check`**: valida un `plan.json` sin escribir nada ni
  abrir el almacén. Primero lo pasa por el esquema publicado con un validador
  propio de las palabras que este usa (tipos, `const`, `enum`, `required`,
  `pattern`, `uniqueItems`, `additionalProperties: false`, sin dependencias
  nuevas); después comprueba lo que el esquema no ve: `ref` repetidos,
  `depende_de` inexistentes o apuntándose a sí mismas, ciclos, `origen` fuera
  del repo o que ya no coincide con el `sha256` o las líneas del fichero, y dos
  ideas con el mismo título en el mismo fichero. Enseña lo que se crearía (todo
  a `proposed`) y sale con 0 si se aplicaría, 1 si hay problemas y 2 si el plan
  no se puede leer. Cubierto en `services/core/tests/test_migracion.py`.

- **Migración: `eui migrate apply`**: aplica `plan.json` como un lote con
  `POST /migracion/aplicar`. El core recibe el plan ya normalizado, vuelve a
  pasarlo por `revisar` (origen, refs y ciclos) y lo escribe entero en una
  transacción: `migracion_lote` guarda la huella canónica del plan, la fecha y
  el número de ideas, y `migracion_idea` la procedencia de cada una (`ref`,
  fichero, líneas, `sha256` y `creada_at`). Todas nacen en `proposed`, al final
  de la cola, con sus fases pendientes y requisitos sin marcar, y `depende_de`
  resuelto de refs a uids dentro del lote. Se emite `idea.created` por idea y
  un `migracion.aplicada`; repetir el mismo plan devuelve el mismo lote con
  `repetido: true` sin duplicar, y un fallo a mitad deshace todo. El CLI valida
  antes de enviar y sale 0 aplicado o ya aplicado, 1 plan con problemas y 2
  fallo. Cubierto en `services/core/tests/test_migracion_apply.py` y
  `services/core/tests/test_migracion.py`.

- **Migración: `eui migrate undo`**: deshace un lote con
  `DELETE /migracion/lotes/{lote}`. Antes de borrar comprueba las ideas una a
  una: si alguna salió de `proposed`, su `updated_at` ya no es el `creada_at`
  del lote o una ficha de fuera la usa como sustituta, devuelve 409 con la
  lista completa de conflictos y no toca nada. Si solo falta alguna porque el
  usuario la borró a mano, la cuenta como ausente y deshace el resto. Borra en
  una transacción (ideas, su cascada, el lote y su procedencia), emite
  `idea.deleted` por idea y un `migracion.deshacer`, y retira los uids del lote
  de las listas `depende_de` de las supervivientes. El CLI resume cuántas
  borró y cuántas ya no estaban. Cubierto en
  `services/core/tests/test_migracion_apply.py` y
  `services/core/tests/test_migracion.py`.

- **CRUD del CLI**: `eui idea create|edit|move|fases|requisito` cubre el ciclo de
  una idea sin tocar la API cruda. `create` manda título, descripción,
  contenido, tipo, estado, etiquetas y dependencias; `edit` cambia solo los
  campos dados y permite vaciar etiquetas o dependencias; `move` traslada a
  cualquier carril con los datos de su ficha (resultado y referencia de
  roadmap, resultado y comentario de verificación, autor y nota de la
  aprobación, motivo/autor/sustituta del descarte); `fases` reemplaza la lista
  desde un JSON o `{"fases": [...]}`; y `requisito` marca o desmarca uno
  leyendo la idea y conservando estados, notas y las demás marcas. Todos
  aceptan `--json` y salen 0 bien, 1 no encontrado y 2 fallo. Cubierto en
  `services/core/tests/test_cli.py`.

- **E2E de la migración**: `e2e/escenarios/migracion-lote.mjs` recorre el flujo
  real por el CLI contra el core del runner: `check`, `apply`, repetir el plan
  (mismo lote, sin duplicar), comprobar por API que las dos ideas están en
  `proposed` y que `depende_de` quedó resuelto a uids, y `undo` hasta dejar el
  almacén vacío.

- **MCP por stdio**: `python -m events_core.mcp_servidor` (o `eui mcp`) habla
  JSON-RPC 2.0 por líneas sin dependencias nuevas: `initialize` (negocia la
  versión), `ping`, `tools/list`, `tools/call`, `resources/list`,
  `resources/templates/list` y `resources/read`. Cada herramienta arma el argv
  del CLI y ejecuta `cli.main` en proceso con stdout y stderr capturados, así
  que no reimplementa payloads ni validaciones. En solo lectura anuncia
  `doctor`, `repo_actual`, `repo_list`, `idea_list`, `idea_get`, `migrate_scan`
  y `migrate_check`; con `--permitir-escritura` o `EVENTSUI_MCP_ESCRITURA=1` se
  suman `idea_create`, `idea_edit`, `idea_move`, `idea_fases`,
  `idea_requisito`, `migrate_apply` y `migrate_undo`. Publica el esquema del
  plan en `eui://schema/plan-migracion`. Los errores del CLI vuelven como
  `isError: true` con su texto y stdout queda solo para el protocolo. Cubierto
  en `services/core/tests/test_mcp.py`, incluido un subproceso real por stdio.

- **Plan v2: destinos y fechas.** El plan admite `proposed`, `draft`,
  `historial` y `rejected`, con `fecha`/`completado_at` opcional para el
  archivo. Los pendientes explícitos van a `proposed`, las notas crudas a
  `draft`, lo hecho a `historial` y «No se hace» a `rejected` con motivo;
  `historial` y `rejected` no llevan fases. `apply` escribe el carril
  indicado.
  - Fases:
    - 2. Plan v2 implementado y verificado (completada)
      - [x] Plan v2 en el esquema, apply y undo
      - [x] Migración 0031, documentación y ROADMAP
      - [x] Pruebas, lint y contrato en verde

## Descartado

- **Extensión de VS Code**: empaquetado y webview grandes; rinde más con el
  modelo y la UI estables. Reabrir cuando el mapa y las acciones dejen de
  moverse.

- **Instalador firmado**: cuesta dinero.
