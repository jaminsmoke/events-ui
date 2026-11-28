-- 0027 — revisión rechazada: retornos desde verificación.
--
-- Una revisión puede rechazarse sin crear un estado nuevo: la idea vuelve a
-- roadmap para rehacer el trabajo, vuelve a la cola para replanificarlo o se
-- descarta con su motivo. La vuelta a la cola ya existía desde la 0013; aquí
-- solo se añaden las dos uniones que faltaban.
--
-- `INSERT OR IGNORE` respeta a los repos que hayan retirado a propósito una
-- unión: solo se añaden las nuevas, no se reabren las viejas.

INSERT OR IGNORE INTO protocolo_flujo (origen, destino) VALUES
    ('verificacion', 'roadmap'),
    ('verificacion', 'rejected');
