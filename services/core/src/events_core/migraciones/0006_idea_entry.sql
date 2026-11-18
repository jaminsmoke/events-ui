-- sin-foreign-keys
-- Parte `ideas` en identidad (`idea_entry`) e historial de carriles
-- (`idea_lane_log`). El `uid` no cambia: el ítem es el mismo aunque mute.
--
-- Los carriles viejos (`draft`/`proposed`/`accepted`/`rejected`/`superseded`)
-- se traducen al traducirse cada fila:
--   `rejected`/`superseded` -> `descartadas`
--   `accepted`              -> `completada`
--   el resto (`draft`, `proposed`) -> `cola`
-- El `entered_at` de la fila creada es el `updated_at` de la idea: es lo más
-- cercano a «cuándo entró en ese carril» que queda.

CREATE TABLE idea_entry (
    id          INTEGER PRIMARY KEY,
    uid         TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    content     TEXT    NOT NULL DEFAULT '',
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),
    tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

INSERT INTO idea_entry
    (id, uid, title, description, content, kind, tags, created_at, updated_at)
SELECT id, uid, title, description, content, kind, tags, created_at, updated_at
FROM ideas;

CREATE TABLE idea_lane_log (
    id         INTEGER PRIMARY KEY,
    uid        TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    lane       TEXT    NOT NULL CHECK (lane IN ('cola', 'descartadas', 'completada')),
    entered_at TEXT    NOT NULL
);

INSERT INTO idea_lane_log (uid, lane, entered_at)
SELECT uid,
       CASE
           WHEN status IN ('rejected', 'superseded') THEN 'descartadas'
           WHEN status = 'accepted' THEN 'completada'
           ELSE 'cola'
       END,
       updated_at
FROM ideas;

CREATE INDEX idx_lane_log_uid ON idea_lane_log (uid, id);

-- `connections` colgaba de `ideas(uid)`: se reconstruye apuntando a la entrada.
CREATE TABLE connections_nueva (
    id         INTEGER PRIMARY KEY,
    parent_uid TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    child_uid  TEXT    NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
    kind       TEXT    NOT NULL DEFAULT 'child'
               CHECK (kind IN ('child', 'related', 'supersedes')),
    created_at TEXT    NOT NULL,
    UNIQUE (parent_uid, child_uid, kind)
);

INSERT INTO connections_nueva (id, parent_uid, child_uid, kind, created_at)
SELECT id, parent_uid, child_uid, kind, created_at FROM connections;

DROP TABLE connections;

ALTER TABLE connections_nueva RENAME TO connections;

CREATE INDEX idx_connections_parent ON connections (parent_uid);

DROP TABLE ideas;
