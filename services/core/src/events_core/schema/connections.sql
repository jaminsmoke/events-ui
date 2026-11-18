-- Conexiones del mapa: qué idea cuelga de cuál.
--
-- No es una columna `parent_uid` dentro de `ideas` porque una idea puede colgar
-- de dos sitios (dos roadmaps) y porque mover de rama debe ser cambiar una línea,
-- no reescribir la idea. `kind` deja sitio a enlaces laterales sin tocar nada.

CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY,

    -- UIDs y no ids: el id es local al repo, la conexión debe sobrevivir a
    -- exportar/importar ideas entre repos. Apuntan a `idea_entry` (la tabla
    -- `ideas` se partió en la migración 0006: apuntar a ella rompe todo
    -- almacén que nazca con este fichero —`no such table: main.ideas`—).
    parent_uid  TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    child_uid   TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,

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

-- Dos índices, uno por cada sentido de lectura: el chequeo de ciclos de
-- `create_connection` sube por el árbol buscando por `child_uid`, y el panel
-- del carril y el mapa leen por `parent_uid`. Un almacén nuevo nace con los
-- dos; uno viejo los recibe de `migraciones/0008` (que además iguala el
-- `CHECK parent_uid <> child_uid`, que la reconstrucción de la 0006 olvidó).
CREATE INDEX IF NOT EXISTS idx_connections_child_uid ON connections (child_uid);
CREATE INDEX IF NOT EXISTS idx_connections_parent ON connections (parent_uid);
