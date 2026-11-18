-- Los intentos de verificación sobreviven a la ficha: al volver a la cola la
-- ficha se retira, pero la idea conserva cuántas vueltas lleva. El contador
-- vive en la entrada, que es la identidad del ítem.

ALTER TABLE idea_entry ADD COLUMN verificacion_intentos INTEGER NOT NULL DEFAULT 0
    CHECK (verificacion_intentos >= 0);

-- Lo que ya está en verificación arranca con los intentos que tenía la ficha,
-- para no perder la vuelta en curso al migrar.

UPDATE idea_entry SET verificacion_intentos = coalesce(
    (SELECT intentos FROM idea_verificacion WHERE idea_verificacion.uid = idea_entry.uid),
    0);
