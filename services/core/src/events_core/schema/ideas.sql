-- Ideas de un repositorio investigado.
--
-- Vive dentro del propio repo, en `.EUI/EUI_DATABASE.sqlite`. Es a propósito: las ideas
-- sobre un repo viajan, se versionan y se revisan junto a su código.
--
-- Este fichero es la fuente de verdad del esquema. Se aplica con
-- `python -m events_core.seed <repo>` y es idempotente.
--
-- Cuatro piezas, no una (la «idea» no es un solo estado):
-- - `idea_entry`: la identidad del ítem (`uid`, título, `kind`, `tags`...).
--   El `uid` no cambia nunca: el ítem es el mismo aunque cambie de estado.
-- - `idea_cola`: la fila de cola de una idea en cola, con su posición y su
--   momento de entrada. Es estado real y ordenable, no una vista: estar en
--   la cola suma fila y no estar resta, y el cajón es justo lo que no suma.
-- - `idea_rejected`: la ficha del descarte, solo mientras dura el descarte.
-- - `idea_completada`: la ficha de la idea hecha, solo mientras dura así.
-- Una idea que no está en ninguna de las tres fichas es el cajón (recién
-- creada, `draft`). El historial de movimientos vive en `event`.

CREATE TABLE IF NOT EXISTS idea_entry (
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

    -- De momento solo hay un tipo: la idea. Nota/ADR no han sido pensados;
    -- la columna existe y siempre vale 'idea' (el contrato ya no crea otros).
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind = 'idea'),

    -- Tags en texto JSON; ver el comentario histórico en la migración 0004.
    tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),

    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- La cola: una fila por idea en cola, en orden. `posicion` ordena la cola
-- (la primera es la más pequeña) y `entered_at` dice cuándo entró en ella.
CREATE TABLE IF NOT EXISTS idea_cola (
    -- La identidad del ítem; se borra con él (ON DELETE CASCADE).
    uid         TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    posicion    INTEGER NOT NULL UNIQUE,
    entered_at  TEXT    NOT NULL
);

-- La ficha de la idea completada. La fila vive solo mientras dura así:
-- al volver a cola, a descartadas o al cajón se retira.
CREATE TABLE IF NOT EXISTS idea_completada (
    uid          TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    completed_at TEXT    NOT NULL
);

-- La ficha del descarte: un ítem descartado tiene un porqué, y ese viene
-- con sus propios campos (`rejected_at`, `rejected_description`), mientras la
-- descripción inicial y `created_at` se quedan en la entrada. La fila vive
-- solo mientras dura el descarte: al salir de descartadas se retira (el
-- historial de movimientos queda en `event`).
CREATE TABLE IF NOT EXISTS idea_rejected (
    uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    -- Cuándo se descartó, al mismo tiempo que la fila del log.
    rejected_at TEXT NOT NULL,
    -- La razón del descarte, en palabras del que descarta.
    rejected_description TEXT NOT NULL DEFAULT '',
    -- Quién: el usuario, un agente o el sistema. Hoy solo `usuario` lo escribe.
    rejected_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (rejected_by IN ('usuario', 'agente', 'sistema')),
    -- Para `superseded`: por qué idea fue reemplazada (la entrada que la releva).
    superseded_by_uid TEXT REFERENCES idea_entry (uid),
    CHECK (superseded_by_uid IS NULL OR superseded_by_uid <> uid)
);

-- Sin fila en ninguna de las tres fichas, la idea está en el cajón: es la
-- recién creada, que aún no entró en ninguna lista. No hay fila de cajón:
-- la ausencia de las demás ya la define.

-- Los protocolos de flujo: qué carriles pueden unirse a cuáles. Una allowlist:
-- solo las parejas listadas están permitidas; el resto se prohíbe. Las
-- descartadas son terminales: no hay fila que salga de ellas, y volver al
-- cajón desde la cola tampoco está listado. `superseded` comparte grupo con
-- `rejected` para mover (la ficha lo distingue, el carril no), así que no
-- lleva filas propias: el grupo manda. Las completadas no tienen diseño aún:
-- no hay flujo que llegue a `accepted` y `idea_completada` queda como
-- cimiento. Se siembra aquí para los almacenes nuevos; a los existentes les
-- llega por la migración 0011 (las filas de completadas, fuera en la 0012).
CREATE TABLE IF NOT EXISTS protocolo_flujo (
    origen  TEXT NOT NULL CHECK (origen IN ('draft', 'proposed', 'accepted', 'rejected')),
    destino TEXT NOT NULL CHECK (destino IN ('draft', 'proposed', 'accepted', 'rejected')),
    PRIMARY KEY (origen, destino)
);

INSERT OR IGNORE INTO protocolo_flujo (origen, destino) VALUES
    ('draft', 'proposed'),
    ('draft', 'rejected'),
    ('proposed', 'rejected');
