-- 0003 — el chequeo de ciclos busca por `connections.child_uid`.
--
-- `_alcanza` sube por el árbol con `WHERE child_uid = ?` cada vez que se crea una
-- arista, y sin índice eso es un barrido completo de la tabla. Con tres filas da
-- igual; con un mapa de verdad, no.
--
-- Sin `BEGIN`/`COMMIT`: el paso lo envuelve `_aplicar_paso`, que además sube
-- `user_version` en la misma transacción.

CREATE INDEX IF NOT EXISTS idx_connections_child_uid ON connections (child_uid);
