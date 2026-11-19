-- 0029 — los archivos de un requisito, no solo de su fase.
--
-- El árbol se fotografía por evento y marcar un requisito también lo es: lo que
-- cambió desde la foto anterior es lo que tocó ese requisito. Si se marcan
-- varios a la vez no hay forma de repartir el trabajo, así que ese cambio se
-- queda en la fase.
--
-- `requisito_orden = 0` significa «de la fase»: el cierre, una tanda de varios
-- o lo que quedó suelto. `desde` es de dónde vino un archivo renombrado (sin
-- Git un `mv` solo se ve así). La clave primaria cambia, así que la tabla se
-- reconstruye; las filas de la 0028 se conservan como trabajo de su fase.

CREATE TABLE idea_fase_archivo_nueva (
    idea_uid        TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    fase_orden      INTEGER NOT NULL CHECK (fase_orden > 0),
    requisito_orden INTEGER NOT NULL DEFAULT 0 CHECK (requisito_orden >= 0),
    ruta            TEXT    NOT NULL,
    estado          TEXT    NOT NULL CHECK (
        estado IN ('nuevo', 'modificado', 'borrado', 'renombrado')
    ),
    desde           TEXT,
    contenido       TEXT,
    PRIMARY KEY (idea_uid, fase_orden, requisito_orden, ruta)
);

INSERT INTO idea_fase_archivo_nueva
    (idea_uid, fase_orden, requisito_orden, ruta, estado, contenido)
    SELECT idea_uid, fase_orden, 0, ruta, estado, contenido FROM idea_fase_archivo;

DROP TABLE idea_fase_archivo;

ALTER TABLE idea_fase_archivo_nueva RENAME TO idea_fase_archivo;
