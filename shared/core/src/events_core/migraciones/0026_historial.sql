-- 0026 — historial: aprobar archiva.
--
-- El flujo gana un carril terminal después de revisión aprobada. Aprobar sigue
-- siendo la unión `verificacion → revision_aprobada`, pero el core escribe la
-- firma y deja la idea en `historial` en la misma transacción: `revision_node`
-- se conserva como firma y `idea_fase` no se toca. Las que ya estaban
-- aprobadas se archivan aquí; para los almacenes antiguos, «aprobada» era el
-- estado final.
--
-- No se toca `protocolo_flujo`: archivar no es un traslado que ofrezca la UI,
-- es el desenlace automático de la aprobación. El historial, como las
-- descartadas, no tiene salida.
--
-- sin-foreign-keys
--
-- SQLite no sabe cambiar un CHECK sin reconstruir la tabla. `idea_node` tiene
-- cuatro hijas con `ON DELETE CASCADE`; sin apagar las claves foráneas, el
-- `DROP` se las llevaría por delante.

CREATE TABLE idea_node_nuevo (
    uid         TEXT    PRIMARY KEY REFERENCES idea_data (uid) ON DELETE CASCADE,
    estado      TEXT    NOT NULL
                CHECK (estado IN ('draft', 'proposed', 'roadmap', 'verificacion',
                                  'revision_aprobada', 'historial', 'rejected')),
    posicion    INTEGER,
    entered_at  TEXT    NOT NULL,
    CHECK (posicion IS NULL OR estado = 'proposed'),
    CHECK (posicion IS NULL OR posicion > 0)
);

INSERT INTO idea_node_nuevo (uid, estado, posicion, entered_at)
SELECT uid, estado, posicion, entered_at FROM idea_node;

UPDATE idea_node_nuevo SET estado = 'historial' WHERE estado = 'revision_aprobada';

DROP TABLE idea_node;

ALTER TABLE idea_node_nuevo RENAME TO idea_node;

CREATE UNIQUE INDEX idea_cola_orden
    ON idea_node (posicion) WHERE estado = 'proposed';

CREATE UNIQUE INDEX idea_roadmap_unico
    ON idea_node (estado) WHERE estado = 'roadmap';
