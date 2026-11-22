-- 0030 — los lotes de la migración de Markdown.
--
-- Aplicar un plan no es crear ideas sueltas: es un lote que se puede deshacer y
-- que no se repite. `migracion_lote` guarda la huella canónica del plan, la
-- fecha y cuántas ideas trajo; `migracion_idea` guarda de qué fichero, líneas y
-- sha256 salió cada idea, con `creada_at` como firma para que `undo` sepa si
-- alguien la movió o editó después.
--
-- El lote cuelga de las ideas con cascada: si el usuario borra una a mano, su
-- procedencia se va con ella y el resto del lote sigue siendo reversible.

CREATE TABLE migracion_lote (
    id          TEXT    PRIMARY KEY,
    plan_sha256 TEXT    NOT NULL UNIQUE,
    creado_at   TEXT    NOT NULL,
    ideas       INTEGER NOT NULL CHECK (ideas > 0)
);

CREATE TABLE migracion_idea (
    lote_id     TEXT    NOT NULL REFERENCES migracion_lote (id) ON DELETE CASCADE,
    idea_uid    TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    ref         TEXT    NOT NULL,
    ruta        TEXT    NOT NULL,
    desde_linea INTEGER NOT NULL CHECK (desde_linea > 0),
    hasta_linea INTEGER NOT NULL CHECK (hasta_linea >= desde_linea),
    sha256      TEXT    NOT NULL,
    creada_at   TEXT    NOT NULL,
    PRIMARY KEY (lote_id, ref),
    UNIQUE (lote_id, idea_uid)
);

CREATE INDEX migracion_idea_uid ON migracion_idea (idea_uid);
