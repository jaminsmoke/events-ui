-- Los almacenes sembrados antes de que el esquema incluyera el log nacieron
-- sin `event`: el core emitía sus `idea.*` y no había dónde. Se crea aquí,
-- idempotente, con la forma final del sobre.

CREATE TABLE IF NOT EXISTS event (
    id         INTEGER PRIMARY KEY,
    ts         TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    payload    TEXT    NOT NULL DEFAULT '{}',
    origen     TEXT    NOT NULL DEFAULT 'externo',
    dedupe_key TEXT,
    UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_event_origen ON event (origen, id);
