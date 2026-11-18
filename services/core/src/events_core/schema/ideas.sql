-- Ideas y ADRs de un repositorio investigado.
--
-- Vive dentro del propio repo, en `.EUI/EUI_DATABASE.sqlite`. Es a propósito: las ideas
-- sobre un repo viajan, se versionan y se revisan junto a su código.
--
-- Este fichero es la fuente de verdad del esquema. Se aplica con
-- `python -m events_core.seed <repo>` y es idempotente.
--
-- Dos tablas, no una (la «idea» no es un solo estado):
-- - `idea_entry`: la identidad del ítem (`uid`, título, `kind`, `tags`...).
--   El `uid` no cambia nunca: el ítem es el mismo aunque mute de carril.
-- - `idea_lane_log`: el historial de carriles. Cada paso escribe una fila con
--   su propio `entered_at`: cuándo entró cada idea en cola, en descartadas, o
--   la completó. Un solo `status` aplanaba eso.

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

    -- La tabla sirve para las dos cosas: una idea suelta o un ADR formal.
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),

    -- Tags en texto JSON; ver el comentario histórico en la migración 0004.
    tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),

    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- El historial de carriles: una fila por paso, con su momento. El carril
-- actual de una idea es la última fila de su log (ordenando por `id`), así que
-- no hay una columna `lane` que pueda desincronizarla del historial.
CREATE TABLE IF NOT EXISTS idea_lane_log (
    id         INTEGER PRIMARY KEY,
    -- La identidad del ítem que muve; se borra con él (ON DELETE CASCADE).
    uid        TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    -- `cola` = esperando revisión; `descartadas` = cerrada; `completada` = hecha.
    lane       TEXT    NOT NULL CHECK (lane IN ('cola', 'descartadas', 'completada')),
    -- Cuándo entró: leído junto con `lane`, no separado.
    entered_at TEXT    NOT NULL
);

-- El log se lee por ítem (último paso) y en orden cronológico.
CREATE INDEX IF NOT EXISTS idx_lane_log_uid ON idea_lane_log (uid, id);

-- La ficha del descarte: un ítem en `descartadas` tiene un porqué, y ese viene
-- con sus propios campos (`rejected_at`, `rejected_description`), mientras la
-- descripción inicial y `created_at` se quedan en la entrada. La fila vive
-- solo mientras dura el descarte: al volver a cola se retira (el historial
-- de pasos queda en `idea_lane_log`).
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

-- La fila de la entrada que se acaba de crear vive aquí: el log se escribe
-- con ella en la misma transacción, así nunca falta la primera fila.
