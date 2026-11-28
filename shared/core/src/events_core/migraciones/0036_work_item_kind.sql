-- 0036 — el tipo del dato deja de llamarse «idea».
--
-- `work_item_data.kind` nace hoy con `work_item`; los almacenes anteriores
-- traen `idea` en cada fila. SQLite no cambia un `CHECK` con `ALTER`, así que
-- la tabla se reconstruye: se copian las filas con el `id` intacto (el nodo lo
-- copia) y `kind` pasa de `idea` a `work_item`. `adr` y `note` son históricos
-- y se quedan como están.
--
-- sin-foreign-keys
--
-- `work_item_data` tiene hijas con `ON DELETE CASCADE` (`work_item_node`,
-- `work_item_fase`, `migracion_item`…): sin apagar las claves foráneas, el
-- `DROP` se las llevaría por delante.

CREATE TABLE work_item_data_nuevo (
    id          INTEGER PRIMARY KEY,
    uid         TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    content     TEXT    NOT NULL DEFAULT '',
    kind        TEXT    NOT NULL DEFAULT 'work_item'
                CHECK (kind IN ('work_item', 'adr', 'note')),
    tags        TEXT    NOT NULL DEFAULT '[]'
                CHECK (json_valid(tags) AND json_type(tags) = 'array'),
    verificacion_intentos INTEGER NOT NULL DEFAULT 0
                CHECK (verificacion_intentos >= 0),
    depende_de  TEXT    NOT NULL DEFAULT '[]'
                CHECK (json_valid(depende_de) AND json_type(depende_de) = 'array'),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

INSERT INTO work_item_data_nuevo
    (id, uid, title, description, content, kind, tags,
     verificacion_intentos, depende_de, created_at, updated_at)
SELECT id, uid, title, description, content,
       CASE kind WHEN 'idea' THEN 'work_item' ELSE kind END,
       tags, verificacion_intentos, depende_de, created_at, updated_at
FROM work_item_data;

DROP TABLE work_item_data;

ALTER TABLE work_item_data_nuevo RENAME TO work_item_data;
