-- Ideas de un repositorio investigado.
--
-- Vive en la raíz del repo elegido, en `.EUI/EUI_DATABASE.sqlite`. Es a propósito: las
-- sobre un repo viajan, se versionan y se revisan junto a su código.
--
-- Este fichero es la fuente de verdad del esquema. Se aplica con
-- `python -m events_core.seed <repo>` y es idempotente.
--
-- Dos piezas, no cinco (una idea no es un estado):
-- - `idea_data`: qué es la idea (uid, título, descripción, contenido, tipo,
--   etiquetas, dependencias y los intentos de verificación, que son del ítem
--   y no de la estancia). El `uid` no cambia nunca.
-- - `idea_node`: dónde está. Una fila por idea, siempre: `estado` dice el
--   carril, `posicion` ordena la cola (solo ahí) y `entered_at` es cuándo entró
--   en el nodo actual. La entrada (`draft`) es un nodo más, no una ausencia.
-- El detalle de la estancia vive en `roadmap_node`, `verificacion_node`,
-- `revision_node` y `rejected_node`; solo existe mientras dura. `revision_node`
-- es la excepción: la firma se conserva al archivar la idea en `historial`.
-- El historial de movimientos vive en `event`.

CREATE TABLE IF NOT EXISTS idea_data (
    -- Rowid normal, sin AUTOINCREMENT: eso solo añade la tabla `sqlite_sequence`
    -- sin darnos nada aquí (`uid` es la identidad).
    id          INTEGER PRIMARY KEY,

    -- Identidad estable fuera de este fichero. `id` es local al repo; `uid`
    -- permite mover o comparar ideas entre repos sin colisiones.
    uid         TEXT    NOT NULL UNIQUE,

    title       TEXT    NOT NULL,
    -- Resumen de una línea, para listar sin cargar `content`.
    description TEXT    NOT NULL DEFAULT '',
    -- Cuerpo completo en markdown.
    content     TEXT    NOT NULL DEFAULT '',

    -- Al crear solo se escribe la idea; los históricos (`adr` y `note`) se
    -- conservan al leer, como los dejó la migración 0004.
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),

    -- Tags en texto JSON; lista de cadenas. El 0004 solo pedía JSON válido y
    -- `{}` también lo es: pasaba el CHECK y el listado no sabía leerlo, así
    -- que la 0017 exige que el tipo sea `array`.
    tags        TEXT    NOT NULL DEFAULT '[]'
                CHECK (json_valid(tags) AND json_type(tags) = 'array'),

    -- Vueltas por verificación (0014). El contador pertenece al ítem, no a la
    -- estancia: el detalle se retira al volver a la cola y el número sigue.
    verificacion_intentos INTEGER NOT NULL DEFAULT 0
                CHECK (verificacion_intentos >= 0),

    -- Dependencias (0018): uids de otros ítems que tienen que estar en
    -- revisión aprobada para que este avance de carril. Es una lista JSON
    -- porque SQLite no admite FK dentro de un JSON: el core valida que cada
    -- uid exista, rechaza ciclos y la limpia al borrar una idea. No es la
    -- jerarquía del mapa ni las fases: eso será `padre_uid` en su tabla.
    depende_de  TEXT    NOT NULL DEFAULT '[]'
                CHECK (json_valid(depende_de) AND json_type(depende_de) = 'array'),

    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- El nodo: dónde está la idea. Una sola fila por idea, así que no hace falta
-- ningún trigger de exclusividad: no puede estar en dos carriles a la vez.
CREATE TABLE IF NOT EXISTS idea_node (
    uid         TEXT    PRIMARY KEY REFERENCES idea_data (uid) ON DELETE CASCADE,
    estado      TEXT    NOT NULL
                CHECK (estado IN ('draft', 'proposed', 'roadmap', 'verificacion',
                                  'revision_aprobada', 'historial', 'rejected')),
    -- Solo la cola tiene orden. `posicion` es única por carril, no por repo:
    -- una idea fuera de la cola no ocupa sitio.
    posicion    INTEGER,
    -- Cuándo entró en el nodo actual. Sustituye a `entered_at`, `started_at`,
    -- `approved_at` y `rejected_at`, que eran la misma fecha con cuatro nombres.
    entered_at  TEXT    NOT NULL,
    CHECK (posicion IS NULL OR estado = 'proposed'),
    CHECK (posicion IS NULL OR posicion > 0)
);

-- La cola ordenada: la primera posición es la más pequeña. El índice parcial
-- también impide repetir posición, como el `UNIQUE` de la tabla vieja.
CREATE UNIQUE INDEX IF NOT EXISTS idea_cola_orden
    ON idea_node (posicion) WHERE estado = 'proposed';

-- Roadmap admite un solo ítem activo: es la regla del flujo, en SQLite y no
-- solo en el core, así que también paran a un escritor a mano.
CREATE UNIQUE INDEX IF NOT EXISTS idea_roadmap_unico
    ON idea_node (estado) WHERE estado = 'roadmap';

-- El filtro del mapa (`/ideas?status=...`) y el del CLI: sin índice, cada
-- listado por estado recorría la tabla entera. Compuesto porque la cola ordena
-- por `posicion`: el prefijo sirve para el filtro y el par para el orden.
CREATE INDEX IF NOT EXISTS idea_node_estado ON idea_node (estado, posicion);

-- El detalle de la estancia en roadmap: el resultado y la referencia del
-- trabajo. Vive solo mientras dura: al pasar a verificación se retira y la
-- fecha de completado queda en el detalle de la verificación.
CREATE TABLE IF NOT EXISTS roadmap_node (
    uid         TEXT    PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    resultado   TEXT    NOT NULL DEFAULT '',
    referencia  TEXT    NOT NULL DEFAULT ''
);

-- El detalle de la verificación: sus intentos (acumulados en `idea_data`,
-- repetidos aquí para la estancia), el último resultado y el comentario.
CREATE TABLE IF NOT EXISTS verificacion_node (
    uid                  TEXT    PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    intentos             INTEGER NOT NULL DEFAULT 1 CHECK (intentos >= 1),
    ultimo_resultado     TEXT    NOT NULL DEFAULT '',
    comentario           TEXT    NOT NULL DEFAULT '',
    roadmap_completed_at TEXT
);

-- La firma de la revisión aprobada. Al aprobar, la idea se archiva en
-- `historial`, pero esta fila se conserva: el historial no perdería quién
-- aprobó ni cuándo.
CREATE TABLE IF NOT EXISTS revision_node (
    uid         TEXT    PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    approved_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (approved_by IN ('usuario', 'agente', 'sistema')),
    nota        TEXT    NOT NULL DEFAULT ''
);

-- El detalle del descarte: un ítem descartado tiene un porqué, y ese viene
-- con sus propios campos, mientras la descripción inicial y `created_at` se
-- quedan en `idea_data`. La fila vive solo mientras dura el descarte.
CREATE TABLE IF NOT EXISTS rejected_node (
    uid TEXT PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    -- La razón del descarte, en palabras del que descarta.
    rejected_description TEXT NOT NULL DEFAULT '',
    -- Quién: el usuario, un agente o el sistema. Hoy solo `usuario` lo escribe.
    rejected_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (rejected_by IN ('usuario', 'agente', 'sistema')),
    -- Para `superseded`: por qué idea fue reemplazada (la entrada que la releva).
    superseded_by_uid TEXT REFERENCES idea_data (uid),
    CHECK (superseded_by_uid IS NULL OR superseded_by_uid <> uid)
);

-- Las fases de una idea (0021): su descomposición en trabajo. No son una
-- estancia (no cambian con el carril), así que cuelgan de `idea_data` y
-- sobreviven al paso por verificación y a la vuelta a la cola. Cada fase lleva
-- su propio estado y `entered_at` es cuándo entró en él, igual que el nodo.
CREATE TABLE IF NOT EXISTS idea_fase (
    idea_uid   TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    orden      INTEGER NOT NULL CHECK (orden > 0),
    titulo     TEXT    NOT NULL CHECK (length(trim(titulo)) > 0),
    estado     TEXT    NOT NULL DEFAULT 'pendiente'
               CHECK (estado IN ('pendiente', 'completada', 'fallida', 'rechazada')),
    nota       TEXT    NOT NULL DEFAULT '',
    entered_at TEXT    NOT NULL,
    PRIMARY KEY (idea_uid, orden)
);

-- Los requisitos de cada fase (0025): su criterio de hecho. Cuelgan de la fase
-- —no de la idea— para que borrar una fase se lleve los suyos; `hecho` es
-- binario y `done_at` guarda cuándo se marcó, para la ficha. Sin estado
-- `fallida` propio: lo que falla es la fase.
CREATE TABLE IF NOT EXISTS idea_requisito (
    idea_uid   TEXT    NOT NULL,
    fase_orden INTEGER NOT NULL CHECK (fase_orden > 0),
    orden      INTEGER NOT NULL CHECK (orden > 0),
    titulo     TEXT    NOT NULL CHECK (length(trim(titulo)) > 0),
    hecho      INTEGER NOT NULL DEFAULT 0 CHECK (hecho IN (0, 1)),
    done_at    TEXT,
    PRIMARY KEY (idea_uid, fase_orden, orden),
    FOREIGN KEY (idea_uid, fase_orden) REFERENCES idea_fase (idea_uid, orden)
        ON DELETE CASCADE
);

-- La última foto del árbol por idea (0028): la huella desde la que se mide el
-- próximo cierre de fase. Una fila por idea —es el estado, no un historial— y
-- el texto es `ruta<TAB>tamaño<TAB>mtime_ns` por línea. Sin watcher: solo se
-- fotografía al entrar en roadmap y al cerrar una fase.
-- Los lotes de la migración de Markdown (0030). Un plan se aplica entero en
-- una transacción y deja su huella; repetirlo no duplica. `migracion_idea`
-- guarda la procedencia de cada idea (fichero, líneas y hash) y la firma
-- `creada_at` que luego compara `undo` con `idea_data.updated_at`.
CREATE TABLE IF NOT EXISTS migracion_lote (
    id          TEXT    PRIMARY KEY,
    plan_sha256 TEXT    NOT NULL UNIQUE,
    creado_at   TEXT    NOT NULL,
    ideas       INTEGER NOT NULL CHECK (ideas > 0)
);

CREATE TABLE IF NOT EXISTS migracion_idea (
    lote_id     TEXT    NOT NULL REFERENCES migracion_lote (id) ON DELETE CASCADE,
    idea_uid    TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    ref         TEXT    NOT NULL,
    ruta        TEXT    NOT NULL,
    desde_linea INTEGER NOT NULL CHECK (desde_linea > 0),
    hasta_linea INTEGER NOT NULL CHECK (hasta_linea >= desde_linea),
    sha256      TEXT    NOT NULL,
    creada_at   TEXT    NOT NULL,
    -- El carril con el que nació: `undo` lo compara con el nodo actual.
    estado      TEXT    NOT NULL DEFAULT 'proposed'
                CHECK (estado IN ('draft', 'proposed', 'historial', 'rejected')),
    PRIMARY KEY (lote_id, ref),
    UNIQUE (lote_id, idea_uid)
);

CREATE INDEX IF NOT EXISTS migracion_idea_uid ON migracion_idea (idea_uid);

CREATE TABLE IF NOT EXISTS idea_foto (
    idea_uid TEXT PRIMARY KEY REFERENCES idea_data (uid) ON DELETE CASCADE,
    ts       TEXT NOT NULL,
    archivos TEXT NOT NULL
);

-- Los archivos que cambiaron durante una fase o un requisito (0028, 0029). No
-- cuelga de `idea_fase` a propósito: un PATCH reemplaza las fases enteras y una
-- FK con cascada se llevaría los archivos en cada edición; la jerarquía va por
-- `fase_orden`/`requisito_orden` y el core poda los huérfanos. `contenido` es
-- el parche de Git (o el texto del archivo nuevo); `NULL` sin Git, sin commits
-- o si no cabe. `requisito_orden = 0` es «de la fase»: el cierre, una tanda de
-- requisitos marcados a la vez o lo que quedó suelto.
CREATE TABLE IF NOT EXISTS idea_fase_archivo (
    idea_uid        TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    fase_orden      INTEGER NOT NULL CHECK (fase_orden > 0),
    requisito_orden INTEGER NOT NULL DEFAULT 0 CHECK (requisito_orden >= 0),
    ruta            TEXT    NOT NULL,
    estado          TEXT    NOT NULL CHECK (
        estado IN ('nuevo', 'modificado', 'borrado', 'renombrado')
    ),
    -- De dónde vino un archivo renombrado; `NULL` en el resto.
    desde           TEXT,
    contenido       TEXT,
    PRIMARY KEY (idea_uid, fase_orden, requisito_orden, ruta)
);

-- Los protocolos de flujo: qué carriles pueden unirse a cuáles. Una allowlist:
-- solo las parejas listadas están permitidas; el resto se prohíbe. Las
-- descartadas y el historial son terminales: no hay fila que salga de ellas.
-- Revisión aprobada no retiene ideas: al aprobar se archivan en historial, así
-- que su única salida es automática y no se ofrece como traslado.
-- `superseded` comparte grupo con `rejected` para mover (el detalle lo
-- distingue, el carril no), así que no lleva filas propias: el grupo manda.
-- Se siembra aquí para los almacenes nuevos; a los existentes les llega por
-- la migración 0011, se amplía en la 0013 y la 0027 añade los retornos de
-- verificación a roadmap y a descartadas.
CREATE TABLE IF NOT EXISTS protocolo_flujo (
    origen  TEXT NOT NULL CHECK (origen IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')),
    destino TEXT NOT NULL CHECK (destino IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')),
    -- ¿Exige al menos una fase al cruzar por esta unión? (0021). Es dato del
    -- protocolo, no un `if` del core: la UI lo lee y el PATCH lo impone.
    exige_fases INTEGER NOT NULL DEFAULT 0 CHECK (exige_fases IN (0, 1)),
    -- ¿Exige que no queden fases pendientes ni fallidas? (0022). "Cerrada" es
    -- completada o rechazada: rechazar una fase también la cierra.
    exige_fases_listas INTEGER NOT NULL DEFAULT 0 CHECK (exige_fases_listas IN (0, 1)),
    -- ¿Exige que todas las fases estén completadas? (0023). Aquí rechazada no
    -- vale: aprobar la revisión es dar el trabajo por hecho, no por descartado.
    exige_fases_completas INTEGER NOT NULL DEFAULT 0
               CHECK (exige_fases_completas IN (0, 1)),
    PRIMARY KEY (origen, destino)
);

INSERT OR IGNORE INTO protocolo_flujo
    (origen, destino, exige_fases, exige_fases_listas, exige_fases_completas) VALUES
    ('draft', 'proposed', 0, 0, 0),
    ('draft', 'rejected', 0, 0, 0),
    ('proposed', 'roadmap', 1, 0, 0),
    ('proposed', 'rejected', 0, 0, 0),
    ('roadmap', 'verificacion', 0, 1, 0),
    ('verificacion', 'proposed', 0, 0, 0),
    ('verificacion', 'roadmap', 0, 0, 0),
    ('verificacion', 'rejected', 0, 0, 0),
    ('verificacion', 'revision_aprobada', 1, 0, 1);
