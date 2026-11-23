-- 0034: el almacén habla de ítems de trabajo (`work_item*`).
--
-- Renombrado puro: no se copia ni se reescribe ninguna fila. SQLite arrastra
-- las claves, los CHECK y las FK en el `RENAME`; los índices se recrean
-- porque no hay `ALTER INDEX`. Cero triggers en el esquema, así que nada
-- apunta a los nombres viejos.
--
-- `migracion_idea` conserva su nombre —no es una tabla `idea_*`— y solo cambia
-- su columna, que apunta a `work_item_data`.

ALTER TABLE idea_data RENAME TO work_item_data;
ALTER TABLE idea_node RENAME TO work_item_node;
ALTER TABLE idea_fase RENAME TO work_item_fase;
ALTER TABLE idea_requisito RENAME TO work_item_requisito;
ALTER TABLE idea_foto RENAME TO work_item_foto;
ALTER TABLE idea_fase_archivo RENAME TO work_item_fase_archivo;

ALTER TABLE work_item_fase RENAME COLUMN idea_uid TO work_item_uid;
ALTER TABLE work_item_requisito RENAME COLUMN idea_uid TO work_item_uid;
ALTER TABLE work_item_foto RENAME COLUMN idea_uid TO work_item_uid;
ALTER TABLE work_item_fase_archivo RENAME COLUMN idea_uid TO work_item_uid;
ALTER TABLE migracion_idea RENAME COLUMN idea_uid TO work_item_uid;

DROP INDEX IF EXISTS idea_cola_orden;
DROP INDEX IF EXISTS idea_roadmap_unico;
DROP INDEX IF EXISTS idea_node_estado;
DROP INDEX IF EXISTS idea_node_estado_fecha;
DROP INDEX IF EXISTS migracion_idea_uid;

CREATE UNIQUE INDEX work_item_cola_orden
    ON work_item_node (posicion) WHERE estado = 'proposed';
CREATE UNIQUE INDEX work_item_roadmap_unico
    ON work_item_node (estado) WHERE estado = 'roadmap';
CREATE INDEX work_item_node_estado ON work_item_node (estado, posicion);
CREATE INDEX work_item_node_estado_fecha
    ON work_item_node (estado, created_at, id);
CREATE INDEX migracion_item_uid ON migracion_idea (work_item_uid);
