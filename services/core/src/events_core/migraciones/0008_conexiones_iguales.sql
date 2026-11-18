-- sin-foreign-keys
-- Igualar los almacenes migrados con el esquema fresco de `schema/connections.sql`:
--
-- - La reconstrucción de la 0006 dejó `connections` sin el
--   `CHECK (parent_uid <> child_uid)` que el esquema fresco sí tiene (la app lo
--   comprueba en Python, pero la BD no lo garantiza).
-- - A la 0006 le quedó el índice por `parent_uid` y a los frescos el de
--   `child_uid`, que es el que usa el chequeo de ciclos de `create_connection`.
--   Los dos sentidos se quedan.
-- - `idx_event_id` es un índice sobre el rowid (`id INTEGER PRIMARY KEY`):
--   no acelera nada y paga en cada escritura del log.
--
-- Se reconstruye la tabla (como en la 0006) para que el DDL deje de depender
-- del camino que tomó cada almacén.

DROP INDEX IF EXISTS idx_event_id;

CREATE TABLE connections_nueva (
    id         INTEGER PRIMARY KEY,
    parent_uid TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    child_uid  TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    kind       TEXT    NOT NULL DEFAULT 'child'
               CHECK (kind IN ('child', 'related', 'supersedes')),
    created_at TEXT    NOT NULL,
    UNIQUE (parent_uid, child_uid, kind),
    CHECK (parent_uid <> child_uid)
);

INSERT INTO connections_nueva (id, parent_uid, child_uid, kind, created_at)
SELECT id, parent_uid, child_uid, kind, created_at FROM connections;

DROP TABLE connections;

ALTER TABLE connections_nueva RENAME TO connections;

CREATE INDEX IF NOT EXISTS idx_connections_child_uid ON connections (child_uid);
CREATE INDEX IF NOT EXISTS idx_connections_parent ON connections (parent_uid);
