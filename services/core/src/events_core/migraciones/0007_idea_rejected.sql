-- La ficha del descarte: un ítem en `descartadas` tiene un porqué, y ese viene
-- con sus propios campos (`rejected_at`, `rejected_description`), mientras la
-- descripción inicial y `created_at` se quedan en la entrada. La fila vive
-- solo mientras dura el descarte: al volver a cola se retira (el historial
-- de pasos queda en `idea_lane_log`).
--
-- El backfill toma el `entered_at` del último paso de cada idea que aún está
-- en `descartadas` (su último paso es el descarte); el motivo queda vacío
-- porque no se guardó.

CREATE TABLE IF NOT EXISTS idea_rejected (
    uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
    rejected_at TEXT NOT NULL,
    rejected_description TEXT NOT NULL DEFAULT '',
    rejected_by TEXT    NOT NULL DEFAULT 'usuario'
                CHECK (rejected_by IN ('usuario', 'agente', 'sistema')),
    superseded_by_uid TEXT REFERENCES idea_entry (uid),
    CHECK (superseded_by_uid IS NULL OR superseded_by_uid <> uid)
);

INSERT INTO idea_rejected (uid, rejected_at)
SELECT uid, entered_at FROM idea_lane_log
WHERE lane = 'descartadas'
  AND id = (SELECT max(id) FROM idea_lane_log AS ultimo WHERE ultimo.uid = idea_lane_log.uid);
