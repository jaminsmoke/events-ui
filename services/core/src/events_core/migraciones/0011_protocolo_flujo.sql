-- Los protocolos de flujo (0011): qué carriles pueden unirse a cuáles.
--
-- Una allowlist: solo las parejas listadas están permitidas; el resto se
-- prohíbe. Las descartadas y las completadas son terminales: no hay fila que
-- salga de ellas, y volver al cajón desde la cola tampoco está listado.
-- `superseded` comparte grupo con `rejected` para mover (la ficha lo distingue,
-- el carril no), así que no lleva filas propias: el grupo manda.
CREATE TABLE IF NOT EXISTS protocolo_flujo (
    origen  TEXT NOT NULL CHECK (origen IN ('draft', 'proposed', 'accepted', 'rejected')),
    destino TEXT NOT NULL CHECK (destino IN ('draft', 'proposed', 'accepted', 'rejected')),
    PRIMARY KEY (origen, destino)
);

INSERT OR IGNORE INTO protocolo_flujo (origen, destino) VALUES
    ('draft', 'proposed'),
    ('draft', 'rejected'),
    ('draft', 'accepted'),
    ('proposed', 'rejected'),
    ('proposed', 'accepted');
