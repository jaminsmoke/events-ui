-- 0022 — no se sale de roadmap con fases abiertas.
--
-- `exige_fases_listas` marca la unión que exige que ninguna fase quede
-- `pendiente` ni `fallida`. `rechazada` cuenta como cerrada: descartar una
-- fase también es resolverla. Hoy solo aplica a `roadmap → verificacion`;
-- como el resto de requisitos, es dato del protocolo y no un `if` del core.

ALTER TABLE protocolo_flujo ADD COLUMN exige_fases_listas INTEGER NOT NULL DEFAULT 0
    CHECK (exige_fases_listas IN (0, 1));

UPDATE protocolo_flujo SET exige_fases_listas = 1
    WHERE origen = 'roadmap' AND destino = 'verificacion';
