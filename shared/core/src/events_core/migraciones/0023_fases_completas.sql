-- 0023 — no se aprueba la revisión con fases sin completar.
--
-- `exige_fases_completas` marca la unión que exige que toda fase esté en
-- `completada`. A diferencia de `exige_fases_listas`, `rechazada` no vale:
-- cerrar una fase por descarte no es darla por hecha. Hoy solo aplica a
-- `verificacion → revision_aprobada`; es dato del protocolo, no un `if`.

ALTER TABLE protocolo_flujo ADD COLUMN exige_fases_completas INTEGER NOT NULL DEFAULT 0
    CHECK (exige_fases_completas IN (0, 1));

UPDATE protocolo_flujo SET exige_fases_completas = 1
    WHERE origen = 'verificacion' AND destino = 'revision_aprobada';
