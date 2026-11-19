# Roadmap

Plan vivo del proyecto: lo hecho se resume aquí; lo que no se hace queda anotado
con el motivo, para no reabrirlo cada semana.

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
- **CI**: `pnpm check` global en cada push a main y en PRs
  (`.github/workflows/ci.yml`). Batería e2e y builds de Tauri quedan fuera
  del CI a propósito (navegador y puertos; se corren en local).

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

## Pendientes

Nada abierto por ahora.

## No se hace (por ahora)

- **Extensión de VS Code**: empaquetado y webview grandes; rinde más con el
  modelo y la UI estables. Reabrir cuando el mapa y las acciones dejen de
  moverse.
- **Instalador firmado**: cuesta dinero.
