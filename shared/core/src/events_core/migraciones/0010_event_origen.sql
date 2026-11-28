-- El origen del evento se hace explícito (0010): `origen` distingue de dónde
-- viene cada fila del log —`idea` (lo escribe el core con `_emitir`),
-- `externo` (lo escribe el productor) y las tablas futuras (conexiones, etc.).
-- Los eventos de ideas ya escritos se reconocen por su `type`.
--
-- Un almacén sembrado al que el productor aún no ha llegado no tiene tabla
-- `event` (la app no la crea): se le crea aquí, tal como hizo la migración
-- 0005. Por eso el CREATE lleva la forma vieja (sin `origen`) y el ALTER
-- siguiente siempre corre —con o sin tabla previa.
CREATE TABLE IF NOT EXISTS event (
    id         INTEGER PRIMARY KEY,
    ts         TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    payload    TEXT    NOT NULL DEFAULT '{}',
    dedupe_key TEXT,
    UNIQUE (dedupe_key)
);

ALTER TABLE event ADD COLUMN origen TEXT NOT NULL DEFAULT 'externo';

-- Sin esta etiqueta, el origen rompería el tail por cursor para los que aún
-- no saben de la columna: el UPDATE cubre los eventos de ideas ya escritos.
UPDATE event SET origen = 'idea' WHERE type LIKE 'idea.%';

-- El tail por origen es `WHERE origen = :origen AND id > :last`: con el
-- índice, el filtro no paga escaneo completo.
CREATE INDEX IF NOT EXISTS idx_event_origen ON event (origen, id);
