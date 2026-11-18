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
- **Estado por idea**. El core mueve la idea entre fichas en una transacción.
  La entrada se representa con la ausencia de ficha y la cola tiene posición propia.
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
  ficha propia. La migración recoge las antiguas completadas en `idea_revision`.
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
  tabla `ideas` se copia a `idea_entry` conservando UID, campos y estado
  (`proposed` a cola, `accepted` a revisión aprobada, `rejected`/`superseded`
  a descartada), y `connections` se reconstruye apuntando a la entrada.
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
- **CI**: `pnpm check` global en cada push a main y en PRs
  (`.github/workflows/ci.yml`). Batería e2e y builds de Tauri quedan fuera
  del CI a propósito (navegador y puertos; se corren en local).

## Pendientes

Revisión del 18 de noviembre de 2026. Cada casilla indica la prueba que debe pasar
para cerrarla. El [modelo de datos](docs/base-de-datos.md) recoge las tablas,
las relaciones y el alcance de las comprobaciones locales.

### Prioridad alta


### Flujo y visor


### Historial y almacenamiento

- [ ] **Cursor tras vaciar el log.** Tras leer los eventos 1 y 2, reiniciar el laboratorio y crear otro, SQLite reutiliza el ID 1. Un cliente con cursor 2 omite el alta. Cubrir la conexión en vivo y la reconexión tras el vaciado.
- [ ] **Compatibilidad de tipos históricos.** Una v9 con `kind='adr'` llega a v13 y se ve en el mapa, pero el listado y la ficha devuelven 500. Acordar cómo conservar los tipos históricos `adr` y `note` y comprobar ambos recorridos con sus datos originales.
- [ ] **Borrado de una idea sustituta.** Si otra ficha la referencia mediante `superseded_by_uid`, el DELETE devuelve 500. Definir si se conserva el vínculo y se comunica el conflicto o si se permite retirarlo. Probar la respuesta y el estado de ambas ideas.
- [ ] **Reproducción de la base versionada.** Una copia del fichero principal con WAL activo puede omitir escrituras confirmadas. Definir cómo obtener una instantánea SQLite consistente para los repos que versionan su almacén y verificarla desde una copia limpia.
- [ ] **Límite de retención.** La comparación textual mezcla fechas ISO con `T` y el espacio de `datetime('now', …)`. Un evento anterior al corte, pero del mismo día, se conserva. Probar ambos lados del instante de corte en eventos y registro.

### Integridad de las escrituras SQL

Estos casos se reprodujeron con datos de prueba y claves foráneas activadas.

- [ ] **Exclusividad de fichas.** SQLite admite dos ideas en roadmap y una idea en cola y roadmap a la vez. Definir dónde imponer estas reglas para todos los escritores y comprobar que una escritura rechazada deja intacto el estado anterior.
- [ ] **Ciclos en el árbol.** Dos enlaces `child` recíprocos son válidos en SQLite. En el mismo carril, ambas ideas tienen padre y el visor las excluye de las raíces. Cubrir la importación y la visualización de ese caso manteniendo el soporte de varios padres.
- [ ] **Formato de etiquetas.** El esquema acepta `{}` como JSON válido y después `GET /ideas` devuelve 500. Validar una lista de cadenas y contemplar la recuperación de filas existentes con otro formato.
- [ ] **Ruta del registro operativo.** Al arrancar desde dos directorios se resuelve `data/registro.sqlite` en ubicaciones distintas. Unificar el destino predeterminado, conservar el override y verificar que ambos arranques consultan el mismo historial.

## No se hace (por ahora)

- **Extensión de VS Code**: empaquetado y webview grandes; rinde más con el
  modelo y la UI estables. Reabrir cuando el mapa y las acciones dejen de
  moverse.
- **Instalador firmado**: cuesta dinero.
- **`related`/`supersedes` como carriles propios**: son conexiones, no
  columnas; solo se pintan si el visor lo necesita.
- **Gestionar conexiones desde la UI**: son arquitectura o vienen de tooling
  con SQL; la UI solo las lee dentro del mapa.
