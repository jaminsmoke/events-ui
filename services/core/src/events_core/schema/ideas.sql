-- Ideas de un repositorio investigado.
--
-- Vive dentro del propio repo, en `.EUI/EUI_DATABASE.sqlite`. Es a propósito: las ideas
-- sobre un repo viajan, se versionan y se revisan junto a su código.
--
-- Este fichero es la fuente de verdad del esquema. Se aplica con
-- `python -m events_core.seed <repo>` y es idempotente.
--
-- Seis piezas, no una (la «idea» no es un solo estado):
-- - `idea_entry`: la identidad del ítem (`uid`, título, `kind`, `tags`...).
--   El `uid` no cambia nunca: el ítem es el mismo aunque cambie de estado.
-- - `idea_cola`: la fila de cola de una idea en cola, con su posición y su
--   momento de entrada. Es estado real y ordenable, no una vista: estar en
--   la cola suma fila y no estar resta, y el cajón es justo lo que no suma.
-- - `idea_roadmap`: la ficha del ítem en curso, con inicio y resultado.
-- - `idea_verificacion`: la ficha del ítem en revisión, con sus intentos.
-- - `idea_revision`: la ficha de la revisión aprobada, estado final.
-- - `idea_rejected`: la ficha del descarte, solo mientras dura el descarte.
-- Una idea que no está en ninguna ficha es la entrada (recién creada,
-- `draft`). El historial de movimientos vive en `event`.

CREATE TABLE IF NOT EXISTS idea_entry (
    -- Rowid normal, sin AUTOINCREMENT: eso solo añade la tabla `sqlite_sequence`
    -- sin darnos nada aquí (`uid` es la identidad).
    id          INTEGER PRIMARY KEY,

    -- Identidad estable fuera de este fichero. `id` es local al repo; `uid`
    -- permite mover o comparar ideas entre repos sin colisiones.
    uid         TEXT    NOT NULL UNIQUE,

    title       TEXT    NOT NULL,
    -- Resumen de una línea, para listar sin cargar `content`.
    description TEXT    NOT NULL DEFAULT '',
    -- Cuerpo completo en markdown.
    content     TEXT    NOT NULL DEFAULT '',

    -- Al crear solo se escribe la idea; los históricos (`adr` y `note`) se
    -- conservan al leer, como los dejó la migración 0004.
    kind        TEXT    NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),

    -- Tags en texto JSON; ver el comentario histórico en la migración 0004.
    tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),

    -- Vueltas por verificación (0014). El contador pertenece al ítem, no a la
    -- estancia: la ficha se retira al volver a la cola y el número sigue.
    verificacion_intentos INTEGER NOT NULL DEFAULT 0
                CHECK (verificacion_intentos >= 0),

    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- La cola: una fila por idea en cola, en orden. `posicion` ordena la cola
-- (la primera es la más pequeña) y `entered_at` dice cuándo entró en ella.
CREATE TABLE IF NOT EXISTS idea_cola (
    -- La identidad del ítem; se borra con él (ON DELETE CASCADE).
    uid         TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    posicion    INTEGER NOT NULL UNIQUE,
    entered_at  TEXT    NOT NULL
);

-- La ficha del ítem en roadmap. Vive solo mientras dura ese trabajo:
-- al pasar a verificación se retira y su fecha de completado queda en la
-- ficha de verificación (`roadmap_completed_at`).
CREATE TABLE IF NOT EXISTS idea_roadmap (
    uid          TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    started_at   TEXT    NOT NULL,
    completed_at TEXT,
    resultado    TEXT    NOT NULL DEFAULT '',
    referencia   TEXT    NOT NULL DEFAULT ''
);

-- La ficha del ítem en verificación. Vive solo mientras dura la revisión:
-- al volver a cola o al aprobarse se retira.
CREATE TABLE IF NOT EXISTS idea_verificacion (
    uid                  TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    started_at           TEXT    NOT NULL,
    intentos             INTEGER NOT NULL DEFAULT 1 CHECK (intentos >= 1),
    ultimo_resultado     TEXT    NOT NULL DEFAULT '',
    comentario           TEXT    NOT NULL DEFAULT '',
    roadmap_completed_at TEXT
);

-- La ficha de la revisión aprobada. La fila vive solo mientras dura así.
-- Es el estado final del flujo por ahora (la expansión futura saldrá de aquí).
CREATE TABLE IF NOT EXISTS idea_revision (
    uid         TEXT    PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    approved_at TEXT    NOT NULL,
    approved_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (approved_by IN ('usuario', 'agente', 'sistema')),
    nota        TEXT    NOT NULL DEFAULT ''
);

-- La ficha del descarte: un ítem descartado tiene un porqué, y ese viene
-- con sus propios campos (`rejected_at`, `rejected_description`), mientras la
-- descripción inicial y `created_at` se quedan en la entrada. La fila vive
-- solo mientras dura el descarte: al salir de descartadas se retira (el
-- historial de movimientos queda en `event`).
CREATE TABLE IF NOT EXISTS idea_rejected (
    uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    -- Cuándo se descartó, al mismo tiempo que la fila del log.
    rejected_at TEXT NOT NULL,
    -- La razón del descarte, en palabras del que descarta.
    rejected_description TEXT NOT NULL DEFAULT '',
    -- Quién: el usuario, un agente o el sistema. Hoy solo `usuario` lo escribe.
    rejected_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (rejected_by IN ('usuario', 'agente', 'sistema')),
    -- Para `superseded`: por qué idea fue reemplazada (la entrada que la releva).
    superseded_by_uid TEXT REFERENCES idea_entry (uid),
    CHECK (superseded_by_uid IS NULL OR superseded_by_uid <> uid)
);

-- Sin fila en ninguna de las tres fichas, la idea está en el cajón: es la
-- recién creada, que aún no entró en ninguna lista. No hay fila de cajón:
-- la ausencia de las demás ya la define.

-- Los protocolos de flujo: qué carriles pueden unirse a cuáles. Una allowlist:
-- solo las parejas listadas están permitidas; el resto se prohíbe. Las
-- descartadas y la revisión aprobada son terminales: no hay fila que salga
-- de ellas. La revisión puede volver a cola una vez más, pero no al cajón.
-- `superseded` comparte grupo con `rejected` para mover (la ficha lo
-- distingue, el carril no), así que no lleva filas propias: el grupo manda.
-- Se siembra aquí para los almacenes nuevos; a los existentes les llega por
-- la migración 0011 y se amplía en la 0013.
CREATE TABLE IF NOT EXISTS protocolo_flujo (
    origen  TEXT NOT NULL CHECK (origen IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')),
    destino TEXT NOT NULL CHECK (destino IN ('draft', 'proposed', 'roadmap', 'verificacion', 'revision_aprobada', 'rejected')),
    PRIMARY KEY (origen, destino)
);

INSERT OR IGNORE INTO protocolo_flujo (origen, destino) VALUES
    ('draft', 'proposed'),
    ('draft', 'rejected'),
    ('proposed', 'roadmap'),
    ('proposed', 'rejected'),
    ('roadmap', 'verificacion'),
    ('verificacion', 'proposed'),
    ('verificacion', 'revision_aprobada');

-- Exclusividad entre fichas y unicidad del roadmap, en SQLite y no solo en el
-- core: así también paran a cualquier otro escritor (una consulta a mano, una
-- importación). Cada trigger mira las otras cuatro fichas, nunca la suya: la
-- clave primaria de `uid` ya impide repetir dentro de una y el upsert de
-- descarte tiene que poder actualizar su propia fila. No reescriben filas
-- existentes: solo rechazan las nuevas que rompan la regla (migración 0016).
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
