# Modelo de datos de Events UI

Cada repositorio guarda sus ideas, relaciones y protocolos en
`.EUI/EUI_DATABASE.sqlite`. El core activa WAL y las claves foráneas en sus
conexiones de escritura. La versión del esquema de ideas es 17. El registro
operativo de la aplicación vive en otro fichero y abarca varios repositorios.

## Tablas y relaciones

| Tabla | Identidad y relación | Qué representa |
| --- | --- | --- |
| `idea_entry` | `id` local y `uid` único | Identidad estable, título, descripción, contenido, tipo, etiquetas, intentos acumulados de verificación y fechas de la idea. Las relaciones usan el UID. |
| `idea_cola` | Una ficha por UID y una posición única | Orden de la cola y fecha de entrada. Una idea que vuelve desde verificación recibe una posición nueva. |
| `idea_roadmap` | Una ficha por UID | Inicio, resultado y referencia del trabajo en curso. El core comprueba que haya como máximo una idea activa en el repo. |
| `idea_verificacion` | Una ficha por UID | Inicio, intentos acumulados, último resultado, comentario y fecha de finalización del roadmap previo. |
| `idea_revision` | Una ficha por UID | Fecha de aprobación, autor y nota. La migración 0013 copia aquí las antiguas completadas. |
| `idea_rejected` | Una ficha por UID y una referencia opcional a otro UID | Fecha, motivo y autor del descarte. `superseded_by_uid` identifica la idea sustituta. |
| `connections` | Dos FK a `idea_entry.uid` | Aristas entre ideas. La combinación de padre, hijo y tipo es única. Se admiten varios padres. Los tipos son `child`, `related` y `supersedes`. |
| `protocolo_flujo` | Clave compuesta `(origen, destino)` | Transiciones permitidas entre grupos. Es configuración del repo y se conserva al reiniciar el laboratorio. |
| `event` | `id` entero para el cursor y `dedupe_key` opcional única | Historial por repo con fecha, tipo, origen y payload. Se siembra con el almacén y la migración 0015 lo añade a los que nacieron sin él. |
| `registro` | `id` entero en un SQLite independiente | Fecha, nivel, origen y mensaje de operaciones del core. `EVENTSUI_REGISTRO_DB` permite elegir el fichero. |

Las cinco fichas de estado referencian `idea_entry.uid` con borrado en cascada.
Una idea sin ficha está en entrada. La unicidad del UID dentro de cada ficha es
una restricción de SQLite. La exclusividad entre fichas la mantienen el core al
mover la idea y los triggers del almacén (migración 0016), que rechazan
cualquier inserción que deje la idea en dos fichas o dos ideas en roadmap. Los extremos de `connections` también se borran en cascada y un
`CHECK` impide que sean iguales. La referencia opcional a una idea sustituta
impide borrarla mientras exista el vínculo.

La posición única indexa la cola. Las conexiones tienen índices por cada extremo
y el log por `(origen, id)`. El cursor general usa la clave entera de `event`.
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
[conexiones](../services/core/src/events_core/schema/connections.sql),
[eventos](../services/core/src/events_core/schema/eventos.sql),
[registro](../services/core/src/events_core/registro.py) y
[migraciones](../services/core/src/events_core/migraciones/).

## Comprobación local del 18 de noviembre de 2026

Se abrieron los cuatro SQLite del proyecto con `mode=ro` y una transacción de
lectura por fichero. Se comprobaron versión, tablas, columnas, índices, conteos,
integridad y referencias. Las escrituras de prueba se hicieron en bases temporales.

| Ficheros observados | Resultado |
| --- | --- |
| Dos almacenes de ideas | Ambos en v13 y WAL, con siete protocolos. Uno tenía seis ideas repartidas entre entrada y las cinco fichas, sin tabla `event`. El otro estaba vacío y sí tenía `event`. |
| Dos registros operativos | Uno bajo `data/` y otro bajo `services/core/data/`, con una y 21 entradas respectivamente. La ruta predeterminada depende del directorio de arranque. |
| Integridad | `PRAGMA integrity_check` devolvió `ok` en los cuatro ficheros y `PRAGMA foreign_key_check` devolvió cero filas. En ambos almacenes había cero conexiones y cero ideas en varias fichas a la vez. |

Los datos locales por sí solos no ejercitan las relaciones entre ideas. Con
almacenes temporales se comprobaron sustituciones, enlaces recíprocos, fichas
solapadas, tipos históricos, cursores tras un reinicio y lecturas con WAL activo.
Los resultados y las pruebas de cierre están en los [pendientes del proyecto](../ROADMAP.md#pendientes).
