-- Las completadas salen del flujo (0012): no hay diseño aún para ellas y la
-- forma actual no es la definitiva, así que tampoco se ofrece el flujo.
-- No se borra `idea_completada`: queda como cimiento para cuando se diseñe
-- el flujo real. Sin arcadas que lleguen, `accepted` es inalcanzable por API.
DELETE FROM protocolo_flujo WHERE destino = 'accepted';
