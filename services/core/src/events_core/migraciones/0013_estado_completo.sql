-- El flujo crece (0013): entran roadmap, verificación y revisión aprobada.
--
-- Las tres fichas nuevas guardan los campos propios de cada estado mientras
-- dura. La revisión aprobada sucede a la vieja idea_completada (cimiento):
-- sus filas se copian con `approved_at` y la tabla vieja se retira. Los
-- carriles nuevos entran en la allowlist de protocolos con sus uniones
-- permitidas. La tabla de protocolos se reconstruye para ampliar los CHECK
-- sin romper las filas ya sembradas.

CREATE TABLE IF NOT EXISTS idea_roadmap (
    uid          TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    started_at   TEXT    NOT NULL,
    completed_at TEXT,
    resultado    TEXT    NOT NULL DEFAULT '',
    referencia   TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS idea_verificacion (
    uid                  TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    started_at           TEXT    NOT NULL,
    intentos             INTEGER NOT NULL DEFAULT 1 CHECK (intentos >= 1),
    ultimo_resultado     TEXT    NOT NULL DEFAULT '',
    comentario           TEXT    NOT NULL DEFAULT '',
    roadmap_completed_at TEXT
);

CREATE TABLE IF NOT EXISTS idea_revision (
    uid         TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    approved_at TEXT    NOT NULL,
    approved_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (approved_by IN ('usuario', 'agente', 'sistema')),
    nota        TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS idea_completada (
    uid          TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    completed_at TEXT    NOT NULL
);

INSERT OR IGNORE INTO idea_revision (uid, approved_at)
    SELECT uid, completed_at FROM idea_completada;

DROP TABLE IF EXISTS idea_completada;

DROP TABLE IF EXISTS protocolo_flujo_nueva;

CREATE TABLE protocolo_flujo_nueva (
    origen  TEXT NOT NULL CHECK (origen IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')),
    destino TEXT NOT NULL CHECK (destino IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')),
    PRIMARY KEY (origen, destino)
);

INSERT OR IGNORE INTO protocolo_flujo_nueva (origen, destino)
    SELECT origen, destino FROM protocolo_flujo
    WHERE origen IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')
      AND destino IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected');

DROP TABLE IF EXISTS protocolo_flujo;

ALTER TABLE protocolo_flujo_nueva RENAME TO protocolo_flujo;

INSERT OR IGNORE INTO protocolo_flujo (origen, destino) VALUES
    ('draft', 'proposed'),
    ('draft', 'rejected'),
    ('proposed', 'roadmap'),
    ('proposed', 'rejected'),
    ('roadmap', 'verificacion'),
    ('verificacion', 'proposed'),
    ('verificacion', 'revision_aprobada');
