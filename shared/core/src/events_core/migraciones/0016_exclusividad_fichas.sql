-- La exclusividad de fichas y el roadmap único pasan a SQLite.
--
-- El core ya retira las fichas anteriores al mover una idea, pero otro
-- escritor (una consulta a mano, una importación, el productor) podía dejar
-- una idea en cola y roadmap a la vez, o dos ideas en roadmap. Los triggers
-- valen para cualquier conexión y son los mismos de `schema/ideas.sql`.
--
-- Cada trigger mira las otras cuatro fichas, nunca la suya: la clave primaria
-- de `uid` ya impide repetir dentro de una y el upsert del descarte tiene que
-- poder actualizar su propia fila.
--
-- No reescriben filas existentes: un almacén que ya venía mal conserva sus
-- filas, pero no admite nuevas que rompan la regla. Si el roadmap ya tenía
-- dos fichas, el core seguirá rechazando mover una tercera.

CREATE TRIGGER IF NOT EXISTS idea_cola_exclusiva
BEFORE INSERT ON idea_cola
WHEN EXISTS (SELECT 1 FROM idea_roadmap WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_verificacion WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_revision WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_rejected WHERE uid = NEW.uid)
BEGIN
    SELECT RAISE(ABORT, 'la idea ya está en otra ficha');
END;

CREATE TRIGGER IF NOT EXISTS idea_roadmap_unico
BEFORE INSERT ON idea_roadmap
WHEN EXISTS (SELECT 1 FROM idea_roadmap)
BEGIN
    SELECT RAISE(ABORT, 'roadmap solo admite un item activo');
END;

CREATE TRIGGER IF NOT EXISTS idea_roadmap_exclusiva
BEFORE INSERT ON idea_roadmap
WHEN EXISTS (SELECT 1 FROM idea_cola WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_verificacion WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_revision WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_rejected WHERE uid = NEW.uid)
BEGIN
    SELECT RAISE(ABORT, 'la idea ya está en otra ficha');
END;

CREATE TRIGGER IF NOT EXISTS idea_verificacion_exclusiva
BEFORE INSERT ON idea_verificacion
WHEN EXISTS (SELECT 1 FROM idea_cola WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_roadmap WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_revision WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_rejected WHERE uid = NEW.uid)
BEGIN
    SELECT RAISE(ABORT, 'la idea ya está en otra ficha');
END;

CREATE TRIGGER IF NOT EXISTS idea_revision_exclusiva
BEFORE INSERT ON idea_revision
WHEN EXISTS (SELECT 1 FROM idea_cola WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_roadmap WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_verificacion WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_rejected WHERE uid = NEW.uid)
BEGIN
    SELECT RAISE(ABORT, 'la idea ya está en otra ficha');
END;

CREATE TRIGGER IF NOT EXISTS idea_rejected_exclusiva
BEFORE INSERT ON idea_rejected
WHEN EXISTS (SELECT 1 FROM idea_cola WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_roadmap WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_verificacion WHERE uid = NEW.uid)
   OR EXISTS (SELECT 1 FROM idea_revision WHERE uid = NEW.uid)
BEGIN
    SELECT RAISE(ABORT, 'la idea ya está en otra ficha');
END;
