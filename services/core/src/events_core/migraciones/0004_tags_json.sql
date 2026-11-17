-- 0004 — `tags` tiene que ser JSON válido.
--
-- `_row` hace `json.loads` de la columna al listar: un `tags` escrito a mano con
-- texto suelto rompía el listado entero de /ideas, no solo esa fila. El CHECK lo
-- para en la puerta.
--
-- sin-foreign-keys
--
-- SQLite no sabe añadir un CHECK a una tabla que ya existe, así que se reconstruye
-- con la receta de doce pasos: crear la nueva, copiar, tirar la vieja y renombrar.
-- `connections` apunta a `ideas` con `ON DELETE CASCADE`, de modo que el `DROP`
-- se llevaría por delante todas las conexiones si las claves foráneas estuvieran
-- activas al empezar la transacción.
--
-- Las etiquetas que ya no eran JSON se quedan en `[]`: para la app ese texto no
-- era legible de ninguna forma, y una fila mala no puede bloquear la migración de
-- todo el almacén. El original sigue en el WAL y en el backup del repo.

CREATE TABLE ideas_nuevo (
    id          INTEGER PRIMARY KEY,
    uid         TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    content     TEXT    NOT NULL DEFAULT '',
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),
    status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'superseded')),
    tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- El `id` se copia tal cual: es la identidad local y no debe cambiar al migrar.
INSERT INTO ideas_nuevo
    (id, uid, title, description, content, kind, status, tags, created_at, updated_at)
SELECT
    id, uid, title, description, content, kind, status,
    CASE WHEN json_valid(tags) THEN tags ELSE '[]' END,
    created_at, updated_at
FROM ideas;

DROP TABLE ideas;

ALTER TABLE ideas_nuevo RENAME TO ideas;
