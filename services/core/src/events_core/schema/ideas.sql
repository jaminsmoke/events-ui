-- Ideas y ADRs de un repositorio investigado.
--
-- Vive dentro del propio repo, en `.EUI/EUI_DATABASE.sqlite`. Es a propósito: las ideas
-- sobre un repo viajan, se versionan y se revisan junto a su código.
--
-- Este fichero es la fuente de verdad del esquema. Se aplica con
-- `python -m events_core.seed <repo>` y es idempotente.

CREATE TABLE IF NOT EXISTS ideas (
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

    -- Ciclo de vida. `superseded` es para ADRs reemplazados por otro.
    status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'superseded')),

    -- Array JSON de etiquetas. Se guarda como texto para no necesitar tabla
    -- aparte; JSON1 permite consultarlo si hace falta. El CHECK no es adorno:
    -- `_row` hace `json.loads` al listar, así que un `tags` a mano con texto
    -- suelto devolvía un 500 en /ideas en vez de fallar solo en su fila.
    tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),

    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- Sin índices propios: `uid` ya trae el suyo por el UNIQUE, y con una tabla
-- vacía cualquier otro solo añade objetos que mantener. Se añadirán cuando haya
-- volumen que lo justifique.
