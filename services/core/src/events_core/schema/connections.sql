-- Conexiones del mapa: qué idea cuelga de cuál.
--
-- No es una columna `parent_uid` dentro de `ideas` porque una idea puede colgar
-- de dos sitios (dos roadmaps) y porque mover de rama debe ser cambiar una línea,
-- no reescribir la idea. `kind` deja sitio a enlaces laterales sin tocar nada.

CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY,

    -- UIDs y no ids: el id es local al repo, la conexión debe sobrevivir a
    -- exportar/importar ideas entre repos.
    parent_uid  TEXT    NOT NULL REFERENCES ideas(uid) ON DELETE CASCADE,
    child_uid   TEXT    NOT NULL REFERENCES ideas(uid) ON DELETE CASCADE,

    -- `child` = rama del organigrama; `related` = enlace lateral;
    -- `supersedes` = un ADR que reemplaza a otro.
    kind        TEXT    NOT NULL DEFAULT 'child'
                CHECK (kind IN ('child', 'related', 'supersedes')),

    created_at  TEXT    NOT NULL,

    -- La misma conexión no se duplica; dos ideas sí pueden estar unidas por
    -- `child` y por `related` a la vez.
    UNIQUE (parent_uid, child_uid, kind),
    CHECK (parent_uid <> child_uid)
);

-- El chequeo de ciclos de `create_connection` sube por el árbol buscando por
-- `child_uid`. También está en `migraciones/0003`: un almacén nuevo nace con el
-- índice, uno viejo lo recibe al abrirse. El texto debe ser idéntico en los dos
-- sitios, o las dos rutas no darían el mismo esquema.
CREATE INDEX IF NOT EXISTS idx_connections_child_uid ON connections (child_uid);
