-- Ideas y ADRs de un repositorio investigado.
--
-- Vive dentro del propio repo, en `.EUI/EUI_DATABASE`. Es a propósito: las ideas
-- sobre un repo viajan, se versionan y se revisan junto a su código.
--
-- Este fichero es la fuente de verdad del esquema. Se aplica con
-- `python -m events_core.seed <repo>` y es idempotente.

CREATE TABLE IF NOT EXISTS ideas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,

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

    -- Ciclo de vida. `superseded` es para ADRs reemplazados por otro.
    status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'superseded')),

    -- Array JSON de etiquetas. Se guarda como texto para no necesitar tabla
    -- aparte; JSON1 permite consultarlo si hace falta.
    tags        TEXT    NOT NULL DEFAULT '[]',

    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ideas_created_at ON ideas (created_at DESC);
CREATE INDEX IF NOT EXISTS ideas_status     ON ideas (status);
CREATE INDEX IF NOT EXISTS ideas_kind       ON ideas (kind);
