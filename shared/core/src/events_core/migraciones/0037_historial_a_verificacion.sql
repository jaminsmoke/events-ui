-- 0037 — reabrir la verificación de una ficha archivada.
--
-- Hasta aquí el historial era terminal: aprobar era el final. Reabrir la
-- verificación permite volver a comprobarla sin desarchivar a mano ni crear un
-- carril nuevo. Al entrar se suma una vuelta a `verificacion_intentos` y el
-- detalle anterior se retira: la nueva estancia cuenta su propio resultado.
--
-- Sin compuertas de fases: el ítem ya se aprobó con todas completadas y las
-- fases sobreviven al archivo, así que no hay nada que volver a exigir. Las
-- fases listas siguen siendo requisito de `roadmap → verificacion` (0022).
--
-- La tabla se reconstruye porque sus `CHECK` de `origen` y `destino` no
-- admitían `historial` (la 0013 no lo conocía) y un `INSERT OR IGNORE` habría
-- descartado la fila en silencio. Las uniones que ya tenía el repo se copian
-- tal cual: lo que se retiró a propósito no vuelve.

CREATE TABLE protocolo_flujo_nueva (
    origen  TEXT NOT NULL
            CHECK (origen IN ('draft', 'proposed', 'roadmap', 'verificacion',
                              'revision_aprobada', 'historial', 'rejected')),
    destino TEXT NOT NULL
            CHECK (destino IN ('draft', 'proposed', 'roadmap', 'verificacion',
                               'revision_aprobada', 'historial', 'rejected')),
    exige_fases INTEGER NOT NULL DEFAULT 0 CHECK (exige_fases IN (0, 1)),
    exige_fases_listas INTEGER NOT NULL DEFAULT 0 CHECK (exige_fases_listas IN (0, 1)),
    exige_fases_completas INTEGER NOT NULL DEFAULT 0
               CHECK (exige_fases_completas IN (0, 1)),
    PRIMARY KEY (origen, destino)
);

INSERT INTO protocolo_flujo_nueva
    (origen, destino, exige_fases, exige_fases_listas, exige_fases_completas)
SELECT origen, destino, exige_fases, exige_fases_listas, exige_fases_completas
FROM protocolo_flujo;

DROP TABLE protocolo_flujo;

ALTER TABLE protocolo_flujo_nueva RENAME TO protocolo_flujo;

-- `OR IGNORE` porque la reparación de un almacén viejo reaplica la semilla de
-- `schema/items.sql` antes de llegar aquí: la fila puede estar ya puesta.
INSERT OR IGNORE INTO protocolo_flujo (origen, destino) VALUES
    ('historial', 'verificacion');
