-- 0021 — las fases de la idea, y el protocolo que las exige.
--
-- `idea_data` dice qué es la idea; `idea_fase` la descompone en trabajo con su
-- propio estado (`pendiente`, `completada`, `fallida`, `rechazada`). Cuelga de
-- `idea_data` y no de `idea_node`: las fases no son una estancia, sobreviven al
-- paso por verificación y a la vuelta a la cola.
--
-- El requisito es dato del protocolo, no código: `exige_fases` marca la unión
-- que no se puede cruzar sin al menos una fase (entrar en roadmap, hoy). Así
-- mañana se puede exigir en otra unión sin tocar el core.

ALTER TABLE protocolo_flujo ADD COLUMN exige_fases INTEGER NOT NULL DEFAULT 0
    CHECK (exige_fases IN (0, 1));

UPDATE protocolo_flujo SET exige_fases = 1
    WHERE origen = 'proposed' AND destino = 'roadmap';

CREATE TABLE idea_fase (
    idea_uid   TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    orden      INTEGER NOT NULL CHECK (orden > 0),
    titulo     TEXT    NOT NULL CHECK (length(trim(titulo)) > 0),
    estado     TEXT    NOT NULL DEFAULT 'pendiente'
               CHECK (estado IN ('pendiente', 'completada', 'fallida', 'rechazada')),
    nota       TEXT    NOT NULL DEFAULT '',
    entered_at TEXT    NOT NULL,
    PRIMARY KEY (idea_uid, orden)
);
