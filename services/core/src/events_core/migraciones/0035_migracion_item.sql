-- 0035: el lote de migración deja de llamarse «idea».
--
-- La 0034 renombró las tablas `idea_*`; `migracion_idea` se quedó porque no
-- lleva ese prefijo, pero su columna ya apunta a `work_item_data`. Aquí se
-- renombra la tabla y con ella su índice, que ya se llamaba
-- `migracion_item_uid`. Renombrado puro: ninguna fila se copia.

ALTER TABLE migracion_idea RENAME TO migracion_item;
