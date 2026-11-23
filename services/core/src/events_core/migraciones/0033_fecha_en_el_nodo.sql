-- 0033 — la fecha de creación en el nodo, para ordenar sin B-tree temporal.
--
-- `list_ideas` ordena por `created_at DESC, id DESC` y los dos viven en
-- `idea_data`, así que el filtro por estado y el orden no los podía servir el
-- mismo índice: SQLite leía las coincidencias y las ordenaba en un B-tree
-- temporal (184 ms para `historial` con 160 000 fichas). Ninguno de los dos
-- cambia nunca, así que se copian al nodo y `(estado, created_at, id)` sirve
-- para las dos cosas.
--
-- sin-foreign-keys
--
-- Es un cambio de columnas: `idea_node` se reconstruye y sus cuatro hijas
-- (`roadmap_node`, `verificacion_node`, `revision_node`, `rejected_node`) van
-- con `ON DELETE CASCADE`. Sin apagar las claves foráneas, el `DROP` se las
-- llevaría por delante.

CREATE TABLE idea_node_nuevo (
    uid         TEXT    PRIMARY KEY REFERENCES idea_data (uid) ON DELETE CASCADE,
    estado      TEXT    NOT NULL
                CHECK (estado IN ('draft', 'proposed', 'roadmap', 'verificacion',
                                  'revision_aprobada', 'historial', 'rejected')),
    posicion    INTEGER,
    created_at  TEXT    NOT NULL,
    id          INTEGER NOT NULL,
    entered_at  TEXT    NOT NULL,
    CHECK (posicion IS NULL OR estado = 'proposed'),
    CHECK (posicion IS NULL OR posicion > 0)
);

-- La fecha y el `id` salen de la idea: son los que la 0006 guardó al crearla.
INSERT INTO idea_node_nuevo (uid, estado, posicion, created_at, id, entered_at)
SELECT nodo.uid, nodo.estado, nodo.posicion, datos.created_at, datos.id, nodo.entered_at
FROM idea_node AS nodo
JOIN idea_data AS datos ON datos.uid = nodo.uid;

DROP TABLE idea_node;

ALTER TABLE idea_node_nuevo RENAME TO idea_node;

-- Los índices se van con la tabla vieja: se recrean los tres.
CREATE UNIQUE INDEX idea_cola_orden
    ON idea_node (posicion) WHERE estado = 'proposed';

CREATE UNIQUE INDEX idea_roadmap_unico
    ON idea_node (estado) WHERE estado = 'roadmap';

CREATE INDEX idea_node_estado ON idea_node (estado, posicion);

CREATE INDEX idea_node_estado_fecha ON idea_node (estado, created_at, id);
