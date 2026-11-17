# 0002 — Ideas por repositorio, y por qué la primera tabla no es la de eventos

**Estado:** aceptado · 17 nov 2026

## Contexto

El sistema aún no vigila nada: no hay sobre de evento pactado ni productor. Lo
primero que hace falta es un sitio donde apuntar las ideas y decisiones sobre los
repos que investigamos, y una forma de operarlo sin escribir scripts a mano.

## Decisiones

1. **La primera tabla es `ideas`, no `events`.** Antes de mirar repos conviene que
   el sistema se explique a sí mismo. Se pospone el sobre de evento hasta que haya
   algo que observar.

2. **El almacén es por repositorio, no global.** Cada repo investigado lleva dentro
   `.EUI/EUI_DATABASE.sqlite`, un SQLite con la tabla `ideas`. Las ideas sobre un repo
   viajan, se versionan y se revisan junto a su código; no hay un fichero central
   que se desincronice del código al mover un repo.

   Consecuencia: la app ya no lee *un* log, lee *N* almacenes y tiene que resolver
   `repo → fichero`. Si más adelante hace falta una vista agregada, se hace con
   `ATTACH` sobre los ficheros resueltos, no duplicando datos.

3. **`EUI_DATABASE` sin extensión.** El nombre es fijo porque es un artefacto del
   repo, no un temporal: así se encuentra siempre en el mismo sitio y `*.db` no lo
   barre de ningún `.gitignore`. SQLite no necesita extensión.

4. **La API vive en el core Python, sin ORM.** Se descarta **drizzle**: es TS, y
   adoptarlo obliga a un segundo runtime Node para hablar con un SQLite local de
   seis columnas, partiendo el stack en dos servicios por un CRUD. También se
   descarta SQLAlchemy *por ahora*: con `sqlite3` + Pydantic el SQL queda a la vista
   y el esquema es un `.sql` editable. Si crecen las tablas, un ORM entra por debajo
   sin cambiar la superficie HTTP.

5. **El contrato es OpenAPI.** FastAPI lo publica en `/openapi.json` y los enums de
   `kind`/`status` salen del propio `Literal` de Pydantic. De ahí se generarán los
   tipos TS (decisión 9 de `0001`). La UI nunca define a mano lo que el core ya
   declara.

6. **El seed es explícito, no automático.** Nada crea `.EUI` por su cuenta: lo hace
   `python -m events_core.seed <repo>`, que es idempotente y solo aplica
   `schema/ideas.sql`. La app sigue sin inventar ficheros donde no los hay.

7. **`repoprobe/` como laboratorio de pruebas.** `repoprobe/repos/<repo>` es una
   carpeta de trabajo: puede estar vacía, ser un clon o una copia. Git ignora todo su
   contenido, así que se puede analizar y ensuciar sin tocar el producto. Se prueba
   contra material real, no contra fixtures inventados.

## Campos de `ideas`

Los pedidos: `id`, `title`, `description`, `content`, `created_at`. Los añadidos, y
por qué:

| Campo | Motivo |
| --- | --- |
| `uid` | `id` es local al fichero; `uid` permite mover ideas entre repos sin colisión. |
| `kind` | La tabla sirve para ideas sueltas y para ADRs formales: `idea`, `adr`, `note`. |
| `status` | Ciclo de vida real: `draft`, `proposed`, `accepted`, `rejected`, `superseded`. |
| `updated_at` | Sin él no se puede ordenar por actividad ni auditar un cambio. |
| `tags` | Array JSON, para agrupar sin tabla aparte; JSON1 permite consultarlo. |

## Consecuencias

- **Se asume que `EUI_DATABASE.sqlite` se commitea** en el repo investigado (es lo que
  justifica tenerlo dentro). Los auxiliares `-wal`/`-shm` se ignoran con un
  `.gitignore` que el seed escribe en `.EUI/`. Si se prefiere no versionar binarios,
  basta con ignorar `.EUI/` entero: es reversible y no afecta a la API.
- El nombre de repo en la URL es **un solo segmento**: se valida y se rechaza
  cualquier separador o `..`. Sin esa comprobación la API sería un lector de ficheros
  arbitrario.
- `id` deja de ser la identidad pública. En la UI y en las URLs se usa `uid`.

## Pendiente de pactar

- ¿La tabla de eventos vivirá en el mismo `EUI_DATABASE` de cada repo, o en un log
  central aparte? Cambia si `.EUI` es "el repo" o también "el log".
- ¿Hace falta `repo` como columna cuando un `EUI_DATABASE` agregue varios repos? Hoy
  sobra porque el fichero ya implica el repo.

## Enmienda — el repo se direcciona por ruta, no por nombre

El primer elemento de UI es un **selector de carpeta**, y devuelve rutas absolutas
(`C:\Users\...`). Una ruta así no es un segmento válido de URL, así que el repo dejó
de ir en el path (`/repos/{repo}/ideas`) y pasó a query param:

```
GET /ideas?repo=<ruta absoluta o nombre dentro del laboratorio>
```

`resolve_repo` acepta las dos formas: si es absoluta se respeta (el usuario eligió esa
carpeta), si es un nombre se resuelve bajo `repoprobe/repos` y se siguen rechazando
`..` y separadores. No se pierde la garantía: la API solo abre `<carpeta>/.EUI/EUI_DATABASE.sqlite`,
nunca un fichero arbitrario.

Sigue sin haber estado de sesión: el repo es parámetro de cada petición. Cuando haya
que recordar la última carpeta entre arranques, eso irá en la BD de estado propio de
la app (conexión B de 0001), no en el servidor.

## Enmienda — la primera lectura siembra el almacén

La decisión 6 no aguantó la prueba de la ventana real: pedir `core:seed` antes de abrir
una carpeta pone un paso manual justo en el momento de empezar a analizar. Ahora la
primera petición sobre una carpeta existente crea `.EUI/EUI_DATABASE.sqlite`, aplica
`schema/ideas.sql` y devuelve la lista vacía (`ensure_repo`).

Siguen en pie los dos límites de la decisión 6: la carpeta tiene que existir —un nombre
mal escrito no deja almacenes sueltos, la API responde 404— y el escritor de la BDde eventos sigue siendo otro proceso. El seed CLI se queda porque es idempotente y sirve
para sembrar un repo sin arrancar el core.

## Enmienda — el fichero lleva extensión

La decisión 3 se revierte al mirar el artefacto con ojos de repo: un binario **sin
extensión** no lo reconoce ningún editor ni visor, y en un diff no hay forma de saber
qué es. El almacén pasa a llamarse `.EUI/EUI_DATABASE.sqlite`.

Los auxiliares `-wal`/`-shm` siguen ignorados por el `.gitignore` que escribe el seed, y
un `EUI_DATABASE` viejo (sin extensión) se renombra solo —con sus auxiliares, para no
perder lo que hubiera en el WAL— la primera vez que se abre (`_migrar_nombre_viejo`).

Si en `.EUI` están **los dos** ficheros, manda el canónico y el viejo solo se retira
cuando está vacío: con ideas dentro no se borra nada. Perder datos no es tarea de una
migración de nombre.

Si aparecen los dos ficheros a la vez, manda el `.sqlite` y el viejo se retira solo
cuando no tiene ideas dentro: una migración no borra datos.

### Conexiones del mapa

`ideas` guarda los nodos y `connections` guarda qué idea cuelga de cuál
(`parent_uid`/`child_uid`/`kind`). El motivo de que sea tabla y no una columna
`parent_uid` en `ideas`: una idea puede colgar de dos ramas y mover de sitio debe
ser cambiar una línea, no reescribir la idea. `ON DELETE CASCADE` limpia las
conexiones al borrar una idea y `_alcanza` rechaza ciclos antes de insertar.

El esquema se aplica desde todos los `schema/*.sql` en orden y se marca con
`PRAGMA user_version`: un almacén que ya existía no pasa por `init_repo`, así que
`_migrar_esquema` lo pone al día en la primera lectura.

### Migraciones por versión

Reaplicar `schema/*.sql` no basta para lo que de verdad duele: todos son
`IF NOT EXISTS`, así que una columna nueva llega a un almacén nuevo y **nunca** a
uno que ya existe. Un `.EUI` commiteado en un repo es justamente el caso que no se
puede recrear.

Por eso `schema/` es el estado final y cada cambio vive además en
`migraciones/NNNN_nombre.sql`, numerado por versión. `_migrar_esquema` ejecuta los
pasos que falten, en orden, y aborta si la secuencia tiene un hueco. El mismo SQL
va en los dos sitios —`schema/` para el almacén que nace, la migración para el que
ya existía— y ese acuerdo se comprueba comparando el esquema resultante de las dos
rutas.

Cada paso se aplica con `BEGIN IMMEDIATE`, el SQL, `PRAGMA user_version` y
`PRAGMA foreign_key_check` en la misma transacción: si algo falla se deshace todo,
versión incluida, y el almacén se queda como estaba en vez de a medias. Nada de
`executescript` (hace COMMIT de lo abierto) y nada de `;` dentro de los comentarios
de una migración, que el troceador corta por ahí.
