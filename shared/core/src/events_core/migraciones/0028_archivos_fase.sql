-- 0028 — los archivos que toca cada fase, anotados por evento.
--
-- No hay watcher: se toma una foto del árbol al entrar en roadmap (donde
-- empieza el trabajo) y cada vez que una fase se cierra. Lo que cambió entre
-- dos fotos es lo que tocó esa fase. Sin Git solo se guardan ruta y estado; con
-- Git, además, el parche del archivo (`contenido`), acotado por tamaño.
--
-- `idea_foto` guarda la última foto por idea —una fila, la huella del árbol—;
-- `idea_fase_archivo` los cambios ya resueltos de cada fase. Esta última no
-- cuelga de `idea_fase` a propósito: un PATCH reemplaza las fases enteras (borra
-- e inserta) y una FK con cascada se llevaría los archivos en cada edición. La
-- jerarquía se mantiene por `fase_orden`, y el core poda los huérfanos.

CREATE TABLE IF NOT EXISTS idea_foto (
    idea_uid TEXT PRIMARY KEY REFERENCES idea_data (uid) ON DELETE CASCADE,
    ts       TEXT NOT NULL,
    -- Una ruta por línea: `ruta<TAB>tamaño<TAB>mtime_ns`.
    archivos TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idea_fase_archivo (
    idea_uid   TEXT    NOT NULL REFERENCES idea_data (uid) ON DELETE CASCADE,
    fase_orden INTEGER NOT NULL CHECK (fase_orden > 0),
    ruta       TEXT    NOT NULL,
    estado     TEXT    NOT NULL CHECK (estado IN ('nuevo', 'modificado', 'borrado')),
    -- El parche de Git (o el texto del archivo nuevo). `NULL` sin Git, sin
    -- commits o cuando el contenido no cabe: la ruta y el estado ya informan.
    contenido  TEXT,
    PRIMARY KEY (idea_uid, fase_orden, ruta)
);
