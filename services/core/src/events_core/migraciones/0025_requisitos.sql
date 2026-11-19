-- 0025 — los requisitos de una fase.
--
-- La fase es el bloque de trabajo; el requisito es su criterio de hecho. Cuelga
-- de `idea_fase` —y no de la idea— para que borrar una fase se lleve los suyos:
-- la jerarquía real es idea -> fase -> requisito. `hecho` es binario; lo que
-- falla es la fase, así que aquí no hay estado `fallida`. `done_at` guarda
-- cuándo se marcó, para la ficha.
CREATE TABLE IF NOT EXISTS idea_requisito (
    idea_uid   TEXT    NOT NULL,
    fase_orden INTEGER NOT NULL CHECK (fase_orden > 0),
    orden      INTEGER NOT NULL CHECK (orden > 0),
    titulo     TEXT    NOT NULL CHECK (length(trim(titulo)) > 0),
    hecho      INTEGER NOT NULL DEFAULT 0 CHECK (hecho IN (0, 1)),
    done_at    TEXT,
    PRIMARY KEY (idea_uid, fase_orden, orden),
    FOREIGN KEY (idea_uid, fase_orden) REFERENCES idea_fase (idea_uid, orden)
        ON DELETE CASCADE
);
