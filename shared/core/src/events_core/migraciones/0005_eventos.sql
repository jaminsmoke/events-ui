-- Sobre del evento (F1): la parte estable que no se toca.
--
-- Vive en cada `EUI_DATABASE`: el fichero ya implica el repo, así que no hay
-- columna `repo` (ADR 0002) ni log central. La app no produce eventos: el
-- productor externo los escribe aquí y esta tabla es el contrato. `type` es
-- texto libre (no un enum cerrado) y `payload` es JSON libre; el significado
-- lo define cada tipo (decisión 7 del ADR 0001). La UI renderiza con un
-- registro de renderers y un fallback genérico, así un tipo desconocido
-- nunca rompe la vista.
--
-- El log nunca se crea desde la app: si este fichero no existe, no hay eventos
-- y /health lo dice (`degraded`); nunca se crea una BD vacía en su sitio.
CREATE TABLE IF NOT EXISTS event (
    id         INTEGER PRIMARY KEY,
    -- ISO-8601 con segundo, como el resto del core (`ideas.now_iso`).
    ts         TEXT    NOT NULL,
    -- Texto libre: cada tipo define su payload. No es un enum a propósito.
    type       TEXT    NOT NULL,
    -- JSON libre del evento. Vacío = `{}`.
    payload    TEXT    NOT NULL DEFAULT '{}',
    -- Idempotencia: dos eventos con la misma clave son el mismo evento.
    dedupe_key TEXT,
    UNIQUE (dedupe_key)
);

-- El tail (F1) es `WHERE id > :last ORDER BY id`: el índice lo hace casi gratis.
CREATE INDEX IF NOT EXISTS idx_event_id ON event (id);
