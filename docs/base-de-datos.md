# Modelo de datos de Events UI

La raíz elegida de cada repo guarda sus ítems, relaciones y protocolos en
`.EUI/EUI_DATABASE.sqlite`. Es un almacén por raíz, no por subcarpeta: desplegar
carpetas en Files no siembra nada. El core activa WAL y las claves foráneas en sus
conexiones de escritura. La versión del esquema es 33. El registro
operativo de la aplicación vive en otro fichero y abarca varios repositorios.

`.EUI` es configuración del producto, no un directorio de trabajo: solo
`EUI_DATABASE.sqlite` (y sus auxiliares WAL/SHM), `.gitignore` y
`migracion/<lote>/…` (copias y manifiesto de absorción). Cualquier otro
fichero o carpeta se considera ajeno: el core lo rechaza al escribir y lo
purga al abrir el almacén (`ensure_repo`).

## Tablas y relaciones

| Tabla | Identidad y relación | Qué representa |
| --- | --- | --- |
| `work_item_data` | `id` local y `uid` único | Qué es el ítem: título, descripción, contenido, tipo, etiquetas, intentos acumulados de verificación, fechas y sus dependencias (`depende_de`, migración 0018). Las relaciones usan el UID. |
| `work_item_fase` | Una fila por fase y orden | Descomposición del ítem en trabajo: título, estado (`pendiente`, `completada`, `fallida`, `rechazada`), nota y cuándo entró en ese estado. Cuelga de `work_item_data`, así que sobrevive a los cambios de carril. |
| `work_item_requisito` | Una fila por requisito de una fase | Criterio de hecho que cierra la fase: título, `hecho` y `done_at`. Cuelga de `work_item_fase` con borrado en cascada y no tiene estado propio. |
| `work_item_foto` | Una fila por ítem | Última foto del árbol, `ruta<TAB>tamaño<TAB>mtime_ns` por línea. Es el punto desde el que se mide el cierre de cada fase; un ítem que nace en roadmap toma la suya al crearse, con el almacén ya sembrado y antes de abrir la transacción de escritura. |
| `work_item_fase_archivo` | Una fila por archivo anotado | Lo que cambió mientras una fase o un requisito estuvo abierto: `estado` (`nuevo`, `modificado`, `borrado`, `renombrado`), `desde` en el renombrado y el parche de Git acotado por tamaño (64 KiB por archivo, 512 KiB por fase y 8 MiB por almacén; al pasarse se sueltan los de las fases más viejas). `requisito_orden = 0` es «de la fase». El delta de un PATCH se atribuye al primer evento que trae y se calcula fuera de la transacción. |
| `work_item_node` | Una fila por UID | Dónde está: `estado`, `posicion` (solo en cola) y `entered_at`, la fecha de entrada en el carril actual. La entrada (`draft`) es un estado más; el historial es terminal. |
| `roadmap_node` | Una fila por UID mientras dura | Resultado y referencia del trabajo en curso. Un índice parcial impide dos ítems en roadmap. |
| `verificacion_node` | Una fila por UID mientras dura | Intentos de la estancia, último resultado, comentario y fecha de finalización del roadmap previo. |
| `revision_node` | Una fila por UID, conservada al archivar | Autor y nota de la aprobación. La fecha es `entered_at` del nodo. Al aprobar, el ítem pasa a `historial` y esta firma se conserva. La migración 0013 copia aquí las antiguas completadas. |
| `rejected_node` | Una fila por UID mientras dura y una referencia opcional a otro UID | Motivo y autor del descarte. `superseded_by_uid` identifica el ítem sustituto. |
| `migracion_lote` | `id` único y `plan_sha256` único | Lote aplicado por `POST /migracion/aplicar`: huella canónica del plan, fecha y número de ítems. Repetir la misma huella devuelve el mismo lote sin crear nada. |
| `migracion_item` | Una fila por ítem del lote | Procedencia: `ref`, fichero, rango de líneas, `sha256` del origen, `creada_at` y `estado` (el carril con el que nació). Cuelga de `work_item_data.uid` con cascada. |
| `protocolo_flujo` | Clave compuesta `(origen, destino)` | Transiciones permitidas entre grupos y, con `exige_fases` (0021 y 0024), las que exigen al menos una fase, ninguna abierta (0022) o todas completadas (0023). Desde la 0027, verificación también puede volver a roadmap o descartarse. Es configuración del repo y se conserva al reiniciar el laboratorio. |
| `event` | `id` entero para el cursor y `dedupe_key` opcional única | Historial por repo con fecha, tipo, origen y payload. Se siembra con el almacén y la migración 0015 lo añade a los que nacieron sin él. |
| `registro` | `id` entero en un SQLite independiente | Fecha, nivel, origen y mensaje de operaciones del core. El destino por defecto es `data/registro.sqlite` en la raíz del repo y `EVENTSUI_REGISTRO_DB` permite elegir el fichero. |

`work_item_node` referencia `work_item_data.uid` y el detalle referencia
`work_item_node.uid`, todo con borrado en cascada. Un ítem tiene exactamente una
fila de nodo, así que no puede estar en dos carriles a la vez y no hacen falta
triggers de exclusividad: los que traía la migración 0016 se retiraron en la
0020. La posición de la cola es única con un índice parcial y otro impide dos
ítems en roadmap. El borrado definitivo solo se acepta si el ítem está en
Descartadas (`rejected`/`superseded`): no se salta ese paso. La referencia
opcional a un ítem sustituto impide borrarlo mientras exista el vínculo.

Las dependencias viven en `work_item_data.depende_de`, una lista JSON de uids:
SQLite no admite una FK dentro de un JSON, así que el core valida que cada uid
exista, rechaza ciclos y auto-dependencias, y retira el uid de las listas ajenas
al borrar el ítem. Un ítem no entra en roadmap, verificación, revisión aprobada ni historial
mientras alguna dependencia no esté aprobada (`revision_aprobada` o
`historial`); descartarse y editarse sí se permite, para que un ítem bloqueado
tenga salida. El historial cuenta como aprobado: archivar no vuelve a bloquear
a los ítems que dependen de él.

Las fases viven en `work_item_fase`, colgadas de `work_item_data` y no de
`work_item_node`:
no son una estancia, sobreviven al paso por verificación y a la vuelta a la
cola o a roadmap. Cada una lleva su estado (`pendiente`, `completada`, `fallida`,
`rechazada`) y `entered_at`. La lista se reemplaza desde el `PATCH` del ítem
en la misma transacción que el traslado, y `protocolo_flujo.exige_fases` marca
las uniones que no se cruzan sin al menos una (hoy, entrar en roadmap y aprobar
la revisión, que además no cuele el caso vacío) y
`exige_fases_listas` las que no se cruzan con fases `pendiente` o `fallida`
(hoy, pasar a verificación); `rechazada` cuenta como cerrada. Para aprobar la
revisión, `exige_fases_completas` pide todas en `completada`: aquí rechazar no
vale, porque aprobar es dar el trabajo por hecho. Además, todos los requisitos
de todas las fases tienen que estar hechos: el core comprueba la lista que
quedará y, al aprobar, archiva el ítem en `historial` en la misma transacción,
conservando la firma de `revision_node`.

Los lotes de la migración de Markdown (`migracion_lote` y `migracion_item`,
0030 y 0031) también cuelgan de los ítems: `plan_sha256` es único, así que
aplicar dos veces el mismo plan devuelve el mismo lote, y la procedencia de
cada ítem se va con él por la cascada. `creada_at` es la firma que `undo`
compara con `work_item_data.updated_at` y `estado` recuerda el carril con el que
nació; solo borra si el nodo sigue en ese carril, nadie editó el ítem y ninguna
ficha ajena lo usa como sustituto. Un historial importado conserva en
`revision_node` la firma `sistema` y la nota «Importado de …»; un descarte
importado guarda su motivo en `rejected_node`.

La posición única indexa la cola y el log tiene índice por `(origen, id)`. Las
migraciones 0019 y 0020 retiraron `connections` y `work_item_cola` junto con sus
índices. El cursor general usa la clave entera de `event`.
Los eventos guardan la referencia al ítem en el payload, de modo que borrarlo
conserva su historial cuando existe la tabla. El reinicio del laboratorio
vacía expresamente el log. La retención del historial por defecto es de 90 días
o 5.000 eventos y la del registro operativo de 90 días o 2.000 entradas.

## Cómo se anotan los archivos

La anotación no vigila nada: compara dos fotos del árbol.

- **La foto de partida** se toma al entrar en roadmap y al crear un ítem que ya
  nace ahí. En el alta, el almacén se siembra primero (`.EUI` y su `.gitignore`)
  y la foto se toma después, para que nada de lo que crea el sembrado cuente
  como trabajo; el recorrido se hace antes de abrir la transacción de escritura.
- **El delta de un PATCH** es lo que cambió desde la última foto. Se mide una
  sola vez por petición —un recorrido del árbol y un `git diff`— fuera de la
  transacción: el lock de escritura solo cubre el SQL.
- **La atribución**: si el PATCH cierra varias fases o marca varios requisitos,
  el delta entero se anota en el **primer** evento. Un único recorrido no se
  puede repartir entre eventos, y repartirlo sería inventar; el resto se queda
  sin lista propia.
- **Tope blando de 2 s**: si el recorrido ya se pasó, no se paga el `git diff`,
  el evento se queda sin archivos, la foto avanza igual y queda un aviso en el
  registro con el uid y los eventos saltados. Una fase cerrada sin lista es
  recuperable; un core que no acepta escrituras, no.

## Versionar el almacén

El fichero principal se versiona con el repo, pero `-wal` y `-shm` quedan
fuera por el `.gitignore` del almacén. La proyección lo dice en `eui_ignorado`
(`False` versionado, `True` ignorado, `None` sin Git); Resumen ofrece
«Ignorar .EUI» cuando no lo está, y añade `.EUI/` al `.gitignore` de esta raíz
—nunca al de una carpeta superior— con `POST /git/ignorar-almacen`, sin
duplicar la línea. Copiar `EUI_DATABASE.sqlite` a mano
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
debe ver los mismos ítems que la app, sin `-wal` al lado.

Fuentes del modelo: [ítems y protocolos](../services/core/src/events_core/schema/items.sql),
[eventos](../services/core/src/events_core/schema/eventos.sql),
[registro](../services/core/src/events_core/registro.py) y
[migraciones](../services/core/src/events_core/migraciones/).

## Histórico `idea`

El renombrado terminó: la 0034 dejó las tablas `work_item_*` y la columna
`work_item_uid`, y la 0035 renombró el lote a `migracion_item`. No quedan
alias de API ni de herramientas.

`idea` sigue en el repositorio como historia y como dato: las migraciones
`0001`–`0035`, `kind: "idea"`, la clave `ideas` del plan v1-v3 y de
`MapSnapshot`, y los eventos `idea.*` que ya estén escritos en un log (el
lector los pinta y filtra junto a los `item.*`).

## Comprobación local del 18 de noviembre de 2026

Se abrieron los cuatro SQLite del proyecto con `mode=ro` y una transacción de
lectura por fichero. Se comprobaron versión, tablas, columnas, índices, conteos,
integridad y referencias. Las escrituras de prueba se hicieron en bases temporales.

| Ficheros observados | Resultado |
| --- | --- |
| Dos almacenes de ítems | Ambos en v13 y WAL, con siete protocolos (la observación es anterior a la 0021). Uno tenía seis ítems repartidos entre los carriles, sin tabla `event`. El otro estaba vacío y sí tenía `event`. |
| Dos registros operativos | Uno bajo `data/` y otro bajo `services/core/data/`, con una y 21 entradas respectivamente. La ruta predeterminada depende del directorio de arranque. |
| Integridad | `PRAGMA integrity_check` devolvió `ok` en los cuatro ficheros y `PRAGMA foreign_key_check` devolvió cero filas. En ambos almacenes había cero conexiones y cero ítems en varias fichas a la vez. |

Los datos locales por sí solos no ejercitan las relaciones entre ítems. Con
almacenes temporales se comprobaron sustituciones, enlaces recíprocos, fichas
solapadas, tipos históricos, cursores tras un reinicio y lecturas con WAL activo.
Los resultados y las pruebas de cierre están en Events UI; `eui migrate export ROADMAP.md` genera la vista Markdown del documento absorbido.
