-- 0032 — el índice del filtro más usado del mapa: `idea_node.estado`.
--
-- `list_ideas` filtra por estado y el esquema solo traía los índices únicos de
-- la cola y del roadmap, así que el filtro recorría la tabla entera. El índice
-- es compuesto porque la cola ordena por `posicion`: el prefijo `estado` sirve
-- para el filtro y el par para el orden, sin un segundo índice que mantener.

CREATE INDEX IF NOT EXISTS idea_node_estado ON idea_node (estado, posicion);
