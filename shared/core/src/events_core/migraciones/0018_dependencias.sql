-- 0018 — `depende_de`: qué ideas bloquean el avance de esta.
--
-- La dependencia es una arista entre ítems, no la jerarquía del mapa ni las
-- fases (esas tendrán su propio `padre_uid`). Se guarda como lista JSON de
-- uids en la entrada porque SQLite no admite una FK dentro de un JSON: el
-- core valida que existan, rechaza ciclos y limpia el uid al borrar.
--
-- `ADD COLUMN` basta: la columna nace con `[]` en las filas existentes y el
-- CHECK solo se aplica a lo que se escriba después (la 0017 tuvo que
-- reconstruir `idea_entry` porque cambiaba el CHECK de datos ya guardados).

ALTER TABLE idea_entry ADD COLUMN depende_de TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(depende_de) AND json_type(depende_de) = 'array');
