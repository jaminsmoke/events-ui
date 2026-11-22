# Modelo de datos de Events UI

La raíz elegida de cada repo guarda sus ideas, relaciones y protocolos en
`.EUI/EUI_DATABASE.sqlite`. Es un almacén por raíz, no por subcarpeta: desplegar
carpetas en Files no siembra nada. El core activa WAL y las claves foráneas en sus
conexiones de escritura. La versión del esquema de ideas es 29. El registro
operativo de la aplicación vive en otro fichero y abarca varios repositorios.

## Tablas y relaciones

| Tabla | Identidad y relación | Qué representa |
| --- | --- | --- |
| `idea_data` | `id` local y `uid` único | Qué es la idea: título, descripción, contenido, tipo, etiquetas, intentos acumulados de verificación, fechas y sus dependencias (`depende_de`, migración 0018). Las relaciones usan el UID. |
| `idea_fase` | Una fila por fase y orden | Descomposición de la idea en trabajo: título, estado (`pendiente`, `completada`, `fallida`, `rechazada`), nota y cuándo entró en ese estado. Cuelga de `idea_data`, así que sobrevive a los cambios de carril. |
| `idea_requisito` | Una fila por requisito de una fase | Criterio de hecho que cierra la fase: título, `hecho` y `done_at`. Cuelga de `idea_fase` con borrado en cascada y no tiene estado propio. |
| `idea_foto` | Una fila por idea | Última foto del árbol, `ruta<TAB>tamaño<TAB>mtime_ns` por línea. Es el punto desde el que se mide el cierre de cada fase; una idea que nace en roadmap toma la suya al crearse. |
| `idea_fase_archivo` | Una fila por archivo anotado | Lo que cambió mientras una fase o un requisito estuvo abierto: `estado` (`nuevo`, `modificado`, `borrado`, `renombrado`), `desde` en el renombrado y el parche de Git acotado por tamaño (64 KiB por archivo, 512 KiB por fase y 8 MiB por almacén; al pasarse se sueltan los de las fases más viejas). `requisito_orden = 0` es «de la fase». |
| `idea_node` | Una fila por UID | Dónde está: `estado`, `posicion` (solo en cola) y `entered_at`, la fecha de entrada en el carril actual. La entrada (`draft`) es un estado más; el historial es terminal. |
| `roadmap_node` | Una fila por UID mientras dura | Resultado y referencia del trabajo en curso. Un índice parcial impide dos ideas en roadmap. |
| `verificacion_node` | Una fila por UID mientras dura | Intentos de la estancia, último resultado, comentario y fecha de finalización del roadmap previo. |
| `revision_node` | Una fila por UID, conservada al archivar | Autor y nota de la aprobación. La fecha es `entered_at` del nodo. Al aprobar, la idea pasa a `historial` y esta firma se conserva. La migración 0013 copia aquí las antiguas completadas. |
| `rejected_node` | Una fila por UID mientras dura y una referencia opcional a otro UID | Motivo y autor del descarte. `superseded_by_uid` identifica la idea sustituta. |
| `protocolo_flujo` | Clave compuesta `(origen, destino)` | Transiciones permitidas entre grupos y, con `exige_fases` (0021 y 0024), las que exigen al menos una fase, ninguna abierta (0022) o todas completadas (0023). Desde la 0027, verificación también puede volver a roadmap o descartarse. Es configuración del repo y se conserva al reiniciar el laboratorio. |
| `event` | `id` entero para el cursor y `dedupe_key` opcional única | Historial por repo con fecha, tipo, origen y payload. Se siembra con el almacén y la migración 0015 lo añade a los que nacieron sin él. |
| `registro` | `id` entero en un SQLite independiente | Fecha, nivel, origen y mensaje de operaciones del core. El destino por defecto es `data/registro.sqlite` en la raíz del repo y `EVENTSUI_REGISTRO_DB` permite elegir el fichero. |

`idea_node` referencia `idea_data.uid` y el detalle referencia `idea_node.uid`,
todo con borrado en cascada. Una idea tiene exactamente una fila de nodo, así
que no puede estar en dos carriles a la vez y no hacen falta triggers de
exclusividad: los que traía la migración 0016 se retiraron en la 0020. La
posición de la cola es única con un índice parcial y otro impide dos ideas en
roadmap. La referencia opcional a una idea sustituta impide borrarla mientras
exista el vínculo.

Las dependencias viven en `idea_data.depende_de`, una lista JSON de uids: SQLite no
admite una FK dentro de un JSON, así que el core valida que cada uid exista,
rechaza ciclos y auto-dependencias, y retira el uid de las listas ajenas al
borrar la idea. Un ítem no entra en roadmap, verificación, revisión aprobada ni historial
mientras alguna dependencia no esté aprobada (`revision_aprobada` o
`historial`); descartarse y editarse sí se permite, para que un ítem bloqueado
tenga salida. El historial cuenta como aprobado: archivar no vuelve a bloquear
a las ideas que dependen de ella.

Las fases viven en `idea_fase`, colgadas de `idea_data` y no de `idea_node`:
no son una estancia, sobreviven al paso por verificación y a la vuelta a la
cola o a roadmap. Cada una lleva su estado (`pendiente`, `completada`, `fallida`,
`rechazada`) y `entered_at`. La lista se reemplaza desde el `PATCH` de la idea
en la misma transacción que el traslado, y `protocolo_flujo.exige_fases` marca
las uniones que no se cruzan sin al menos una (hoy, entrar en roadmap y aprobar
la revisión, que además no cuele el caso vacío) y
`exige_fases_listas` las que no se cruzan con fases `pendiente` o `fallida`
(hoy, pasar a verificación); `rechazada` cuenta como cerrada. Para aprobar la
revisión, `exige_fases_completas` pide todas en `completada`: aquí rechazar no
vale, porque aprobar es dar el trabajo por hecho. Además, todos los requisitos
de todas las fases tienen que estar hechos: el core comprueba la lista que
quedará y, al aprobar, archiva la idea en `historial` en la misma transacción,
conservando la firma de `revision_node`.

La posición única indexa la cola y el log tiene índice por `(origen, id)`. Las
migraciones 0019 y 0020 retiraron `connections` y `idea_cola` junto con sus
índices. El cursor general usa la clave entera de `event`.
Los eventos guardan la referencia a la idea en el payload, de modo que borrar la
idea conserva su historial cuando existe la tabla. El reinicio del laboratorio
vacía expresamente el log. La retención del historial por defecto es de 90 días
o 5.000 eventos y la del registro operativo de 90 días o 2.000 entradas.

## Versionar el almacén

El fichero principal se versiona con el repo, pero `-wal` y `-shm` quedan
fuera por el `.gitignore` del almacén. Copiar `EUI_DATABASE.sqlite` a mano
mientras la app lo tiene abierto deja fuera lo confirmado que aún vive en el
WAL. La instantánea se saca con el API de backup de SQLite, que lee una
transacción y escribe una copia completa:

```sh
uv run --directory services/core python -m events_core.instantanea \
  repoprobe/repos/<repo>/.EUI/EUI_DATABASE.sqlite /tmp/EUI_DATABASE.sqlite
```

El comando deja la copia sin auxiliares, en modo rollback, y comprueba
`PRAGMA integrity_check` antes de darla por buena. Se sustituye el fichero
versionado por la copia y se comprueba desde un directorio limpio abriéndola:
debe ver las mismas ideas que la app, sin `-wal` al lado.

Fuentes del modelo: [ideas y protocolos](../services/core/src/events_core/schema/ideas.sql),
[eventos](../services/core/src/events_core/schema/eventos.sql),
[registro](../services/core/src/events_core/registro.py) y
[migraciones](../services/core/src/events_core/migraciones/).

## Comprobación local del 18 de noviembre de 2026

Se abrieron los cuatro SQLite del proyecto con `mode=ro` y una transacción de
lectura por fichero. Se comprobaron versión, tablas, columnas, índices, conteos,
integridad y referencias. Las escrituras de prueba se hicieron en bases temporales.

| Ficheros observados | Resultado |
| --- | --- |
| Dos almacenes de ideas | Ambos en v13 y WAL, con siete protocolos (la observación es anterior a la 0021). Uno tenía seis ideas repartidas entre los carriles, sin tabla `event`. El otro estaba vacío y sí tenía `event`. |
| Dos registros operativos | Uno bajo `data/` y otro bajo `services/core/data/`, con una y 21 entradas respectivamente. La ruta predeterminada depende del directorio de arranque. |
| Integridad | `PRAGMA integrity_check` devolvió `ok` en los cuatro ficheros y `PRAGMA foreign_key_check` devolvió cero filas. En ambos almacenes había cero conexiones y cero ideas en varias fichas a la vez. |

Los datos locales por sí solos no ejercitan las relaciones entre ideas. Con
almacenes temporales se comprobaron sustituciones, enlaces recíprocos, fichas
solapadas, tipos históricos, cursores tras un reinicio y lecturas con WAL activo.
Los resultados y las pruebas de cierre están en los [pendientes del proyecto](../ROADMAP.md#pendientes).
