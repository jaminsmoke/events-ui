-- 0031 — la procedencia recuerda el carril con el que nació cada idea.
--
-- `undo` ya no puede asumir `proposed`: un plan v2 puede archivar en historial,
-- dejar una nota en draft o descartar con motivo. El estado esperado viaja en
-- la misma fila que la firma `creada_at`, así que el lote se deshace entero o
-- no se toca, con el mismo criterio que antes.

ALTER TABLE migracion_idea ADD COLUMN estado TEXT NOT NULL DEFAULT 'proposed'
    CHECK (estado IN ('draft', 'proposed', 'historial', 'rejected'));
