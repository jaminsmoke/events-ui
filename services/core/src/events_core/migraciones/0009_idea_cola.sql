-- La cola deja de ser un paso de historial y pasa a ser estado real y
-- ordenable (0009): `idea_cola` guarda una fila por idea en cola, con
-- posición y momento de entrada. El historial queda en la tabla `event`,
-- así que `idea_lane_log` se retira. Las completadas tienen su ficha
-- propia, igual que las descartadas, y una idea que no está en ninguna de
-- las tres tablas es el cajón (recién creada, `draft`).
CREATE TABLE idea_cola (
    uid         TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    posicion    INTEGER NOT NULL UNIQUE,
    entered_at  TEXT    NOT NULL
);

-- La posición de cada idea en cola es su orden de entrada: el de la última
-- fila del log que la puso en cola, en orden creciente.
INSERT INTO idea_cola (uid, posicion, entered_at)
SELECT uid, ROW_NUMBER() OVER (ORDER BY ultimo), entered_at FROM (
    SELECT uid, entered_at, max(id) AS ultimo
    FROM idea_lane_log WHERE lane = 'cola' GROUP BY uid
);

CREATE TABLE idea_completada (
    uid          TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    completed_at TEXT    NOT NULL
);

-- Lo mismo para las completadas: su último paso del log, en su ficha.
INSERT INTO idea_completada (uid, completed_at)
SELECT uid, entered_at FROM (
    SELECT uid, entered_at, max(id) AS ultimo
    FROM idea_lane_log WHERE lane = 'completada' GROUP BY uid
);

DROP TABLE idea_lane_log;
