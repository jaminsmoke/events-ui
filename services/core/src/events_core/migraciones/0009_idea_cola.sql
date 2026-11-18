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

-- La posición de cada idea en cola es su orden de entrada: el de la fila que
-- la puso en cola, en orden creciente. Solo entran las que siguen en cola,
-- es decir, cuyo ÚLTIMO paso es `cola`: una idea que ya salió (a descartadas
-- o a completada) pasó por cola al nacer, pero no debe volver a entrar aquí.
INSERT INTO idea_cola (uid, posicion, entered_at)
SELECT uid, ROW_NUMBER() OVER (ORDER BY ultimo), entered_at FROM (
    SELECT uid, entered_at, lane, max(id) AS ultimo
    FROM idea_lane_log GROUP BY uid
) WHERE lane = 'cola';

CREATE TABLE idea_completada (
    uid          TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    completed_at TEXT    NOT NULL
);

-- Lo mismo para las completadas: cuyo último paso es `completada`, en su
-- ficha. Una que volvió a cola después ya no cuenta como completada.
INSERT INTO idea_completada (uid, completed_at)
SELECT uid, entered_at FROM (
    SELECT uid, entered_at, lane, max(id) AS ultimo
    FROM idea_lane_log GROUP BY uid
) WHERE lane = 'completada';

DROP TABLE idea_lane_log;
