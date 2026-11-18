-- 0020: la idea y su sitio.
--
-- `idea_entry` era dos cosas: la composición de la idea y la fila que siempre
-- existe. Se queda con lo primero y pasa a llamarse `idea_data`; el sitio
-- estrena `idea_node`, una fila por idea con `estado`, `posicion` (solo en
-- cola) y `entered_at`. Las cuatro fichas pasan a ser detalle de la estancia
-- (`roadmap_node`, `verificacion_node`, `revision_node`, `rejected_node`) y
-- `idea_cola` desaparece: su posición es del nodo. Los cinco triggers de
-- exclusividad se van con las tablas viejas: con una sola fila de nodo, una
-- idea no puede estar en dos carriles.

ALTER TABLE idea_entry RENAME TO idea_data;

CREATE TABLE idea_node (
    uid         TEXT    PRIMARY KEY REFERENCES idea_data (uid) ON DELETE CASCADE,
    estado      TEXT    NOT NULL
                CHECK (estado IN ('draft', 'proposed', 'roadmap', 'verificacion',
                                  'revision_aprobada', 'rejected')),
    posicion    INTEGER,
    entered_at  TEXT    NOT NULL,
    CHECK (posicion IS NULL OR estado = 'proposed'),
    CHECK (posicion IS NULL OR posicion > 0)
);

-- El estado sale de en qué ficha vivía; el orden de cola, de `idea_cola`; la
-- fecha, de la ficha que la tenga (o de la creación si está en la entrada).
INSERT INTO idea_node (uid, estado, posicion, entered_at)
SELECT datos.uid,
       CASE
           WHEN rechazo.uid IS NOT NULL THEN 'rejected'
           WHEN revision.uid IS NOT NULL THEN 'revision_aprobada'
           WHEN verificacion.uid IS NOT NULL THEN 'verificacion'
           WHEN roadmap.uid IS NOT NULL THEN 'roadmap'
           WHEN cola.uid IS NOT NULL THEN 'proposed'
           ELSE 'draft'
       END,
       cola.posicion,
       COALESCE(rechazo.rejected_at, revision.approved_at, verificacion.started_at,
                roadmap.started_at, cola.entered_at, datos.created_at)
FROM idea_data AS datos
LEFT JOIN idea_cola AS cola ON cola.uid = datos.uid
LEFT JOIN idea_roadmap AS roadmap ON roadmap.uid = datos.uid
LEFT JOIN idea_verificacion AS verificacion ON verificacion.uid = datos.uid
LEFT JOIN idea_revision AS revision ON revision.uid = datos.uid
LEFT JOIN idea_rejected AS rechazo ON rechazo.uid = datos.uid;

CREATE UNIQUE INDEX idea_cola_orden
    ON idea_node (posicion) WHERE estado = 'proposed';

CREATE UNIQUE INDEX idea_roadmap_unico
    ON idea_node (estado) WHERE estado = 'roadmap';

CREATE TABLE roadmap_node (
    uid         TEXT    PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    resultado   TEXT    NOT NULL DEFAULT '',
    referencia  TEXT    NOT NULL DEFAULT ''
);

INSERT INTO roadmap_node (uid, resultado, referencia)
SELECT uid, resultado, referencia FROM idea_roadmap;

CREATE TABLE verificacion_node (
    uid                  TEXT    PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    intentos             INTEGER NOT NULL DEFAULT 1 CHECK (intentos >= 1),
    ultimo_resultado     TEXT    NOT NULL DEFAULT '',
    comentario           TEXT    NOT NULL DEFAULT '',
    roadmap_completed_at TEXT
);

INSERT INTO verificacion_node
    (uid, intentos, ultimo_resultado, comentario, roadmap_completed_at)
SELECT uid, intentos, ultimo_resultado, comentario, roadmap_completed_at
FROM idea_verificacion;

CREATE TABLE revision_node (
    uid         TEXT    PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    approved_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (approved_by IN ('usuario', 'agente', 'sistema')),
    nota        TEXT    NOT NULL DEFAULT ''
);

INSERT INTO revision_node (uid, approved_by, nota)
SELECT uid, approved_by, nota FROM idea_revision;

CREATE TABLE rejected_node (
    uid TEXT PRIMARY KEY REFERENCES idea_node (uid) ON DELETE CASCADE,
    rejected_description TEXT NOT NULL DEFAULT '',
    rejected_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (rejected_by IN ('usuario', 'agente', 'sistema')),
    superseded_by_uid TEXT REFERENCES idea_data (uid),
    CHECK (superseded_by_uid IS NULL OR superseded_by_uid <> uid)
);

INSERT INTO rejected_node (uid, rejected_description, rejected_by, superseded_by_uid)
SELECT uid, rejected_description, rejected_by, superseded_by_uid
FROM idea_rejected;

-- La cola ordenable deja de ser tabla: su posición vive en el nodo.
DROP TABLE idea_cola;

-- Las fichas viejas ya están copiadas y sus triggers se van con ellas.
DROP TABLE idea_roadmap;
DROP TABLE idea_verificacion;
DROP TABLE idea_revision;
DROP TABLE idea_rejected;
