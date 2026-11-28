-- 0017 — `tags` es una lista JSON, no cualquier JSON válido.
--
-- El 0004 paró el texto suelto con `json_valid`, pero `{}` también es JSON:
-- pasaba el CHECK y el listado intentaba leerlo como lista, devolviendo 500.
-- Aquí el CHECK exige `json_type = 'array'` y las filas existentes se sanean:
-- lo que no sea lista queda en `[]`; las listas se conservan tal cual (quedarse
-- solo con los elementos de texto es cosa de la lectura, en `_tags_json`).
--
-- sin-foreign-keys
--
-- `idea_entry` es el padre de fichas, cola y conexiones: se reconstruye con la
-- receta de doce pasos y las claves foráneas apagadas fuera de la transacción
-- para que el `DROP` no arrastre las hijas.

CREATE TABLE idea_entry_nueva (
    id          INTEGER PRIMARY KEY,
    uid         TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    content     TEXT    NOT NULL DEFAULT '',
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),
    tags        TEXT    NOT NULL DEFAULT '[]'
                CHECK (json_valid(tags) AND json_type(tags) = 'array'),
    verificacion_intentos INTEGER NOT NULL DEFAULT 0
                CHECK (verificacion_intentos >= 0),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

INSERT INTO idea_entry_nueva
    (id, uid, title, description, content, kind, tags,
     verificacion_intentos, created_at, updated_at)
SELECT id, uid, title, description, content, kind,
       CASE
           WHEN json_valid(tags) AND json_type(tags) = 'array' THEN tags
           ELSE '[]'
       END,
       verificacion_intentos, created_at, updated_at
FROM idea_entry;

DROP TABLE idea_entry;

ALTER TABLE idea_entry_nueva RENAME TO idea_entry;
