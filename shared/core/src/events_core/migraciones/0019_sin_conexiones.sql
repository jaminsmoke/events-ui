-- 0019 — se retira `connections`.
--
-- Sus tres tipos se quedaron sin productor: `child` era la jerarquía del mapa
-- (ningún flujo la escribía) y `related`/`supersedes` eran cables laterales.
-- La dependencia que sí bloquea vive en `idea_entry.depende_de` (0018), y la
-- jerarquía que importa —las fases— tendrá su propio `padre_uid`.
--
-- `DROP TABLE` se lleva también sus dos índices.

DROP TABLE IF EXISTS connections;
