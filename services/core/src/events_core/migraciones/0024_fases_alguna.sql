-- 0024 — aprobar la revisión también exige al menos una fase.
--
-- `exige_fases` (0021) ya significa exactamente eso: no cruzar sin ninguna
-- fase. Se activa en `verificacion → revision_aprobada` para que el caso
-- vacío —borrar todas las fases ya en verificación— no cuele por vacuidad
-- en `exige_fases_completas`, donde cero fases cumple «todas completadas».

UPDATE protocolo_flujo SET exige_fases = 1
    WHERE origen = 'verificacion' AND destino = 'revision_aprobada';
