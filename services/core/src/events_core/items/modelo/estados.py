"""Los carriles y su ficha: constantes, estancia y escritura del nodo."""

from __future__ import annotations

import sqlite3
from typing import Any

from ..base.comun import InvalidInput, now_iso

# Los estados del flujo, en orden. `superseded` cierra junto a `rejected`,
# pero la ficha los distingue. `contrato.Status` los repite como `Literal`
# (typing no acepta una tupla) y `test_listas.py` comprueba que no se separen.
ESTADOS = (
    "draft",
    "proposed",
    "roadmap",
    "verificacion",
    "revision_aprobada",
    "historial",
    "rejected",
    "superseded",
)

# Los grupos que se mueven: `superseded` comparte el de `rejected`. Es lo que
# publica `GET /protocolos` y lo que valida el esquema de la UI.
GRUPOS = (
    "draft",
    "proposed",
    "roadmap",
    "verificacion",
    "revision_aprobada",
    "historial",
    "rejected",
)

UPDATABLE = ("title", "description", "content", "kind", "tags", "depende_de")

# Campos del descarte que el PATCH acepta junto al `status` (ver `update_item`).

REJECT_FIELDS = ("rejected_description", "rejected_by", "superseded_by_uid")

# Campos propios de cada estado nuevo que el PATCH acepta junto al `status`:
# el resultado de roadmap, los datos de la verificación y la firma final.

STATE_FIELDS = (
    "roadmap_resultado",
    "roadmap_referencia",
    "verificacion_resultado",
    "verificacion_comentario",
    "approved_by",
    "revision_nota",
)

# Qué campos de ficha valen en cada estado (sin `status`, se aplican a la
# ficha activa; con `status`, a la ficha destino). Fuera de ahí, un campo de
# ficha es incompatible y se rechaza en vez de perderse en silencio.

CAMPOS_FICHA = {
    "roadmap": {"roadmap_resultado", "roadmap_referencia"},
    "verificacion": {"verificacion_resultado", "verificacion_comentario"},
    "revision_aprobada": {"approved_by", "revision_nota"},
}

# Estados de una fase (0021). La fase pertenece a el ítem, no a la estancia:
# sobrevive al paso por verificación y a la vuelta a la cola.
# Estados que cierran una fase: es cuando se anotan sus archivos (0028).

FASE_CIERRE = ("completada", "fallida", "rechazada")

FASE_ESTADOS = ("pendiente", "completada", "fallida", "rechazada")


def _roadmap(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle de la estancia en roadmap, si el ítem está ahí."""
    return conn.execute(
        "SELECT resultado, referencia FROM roadmap_node WHERE uid = ?", (uid,)
    ).fetchone()


def _verificacion(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle de la estancia en verificación, si el ítem está ahí."""
    return conn.execute(
        "SELECT intentos, ultimo_resultado, comentario, roadmap_completed_at"
        " FROM verificacion_node WHERE uid = ?",
        (uid,),
    ).fetchone()


def _revision(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle de la revisión aprobada, si el ítem está ahí."""
    return conn.execute(
        "SELECT approved_by, nota FROM revision_node WHERE uid = ?", (uid,)
    ).fetchone()


def _rechazo(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle del descarte, si el ítem está ahí."""
    return conn.execute(
        "SELECT rejected_description, rejected_by, superseded_by_uid"
        " FROM rejected_node WHERE uid = ?",
        (uid,),
    ).fetchone()


def _estado(conn: sqlite3.Connection, uid: str) -> str:
    """El estado que manda: el de la fila de nodo de el ítem."""
    fila = conn.execute("SELECT estado FROM work_item_node WHERE uid = ?", (uid,)).fetchone()
    return str(fila[0]) if fila else "draft"


def _grupo(estado: str) -> str:
    """A qué grupo pertenece un estado: `superseded` y `rejected` son el mismo
    para mover (la diferencia vive en la ficha, no en el destino)."""
    return "rejected" if estado == "superseded" else estado


def _escribir_estado(
    conn: sqlite3.Connection, uid: str, estado: str, detalle: dict[str, Any]
) -> None:
    """Mueve el nodo de un ítem y escribe el detalle de la estancia.

    Un cambio de estado es un UPDATE de `work_item_node` (estado, posición y
    `entered_at`) más la fila de detalle que toque. La entrada (`draft`) es un
    nodo más: llegar a ella también deja fila, no es una ausencia. Mover a
    donde ya está no escribe nada; re-descartar con detalle nuevo sí actualiza
    el descarte (upsert de `_escribir_rechazo`).

    El detalle de roadmap y el de verificación se conservan al avanzar: la ficha
    cuenta con qué resultado y referencia se cerró el trabajo y cómo se verificó.
    Se retiran al volver a la cola (`draft`/`proposed`), que reinicia el plan. El
    contador `verificacion_intentos` no es de ese detalle: vive en `work_item_data`.
    """
    anterior = _estado(conn, uid)
    if _grupo(estado) == _grupo(anterior) and not (
        estado in ("rejected", "superseded") and detalle
    ):
        return
    if estado == "roadmap":
        activo = conn.execute(
            "SELECT count(*) FROM work_item_node WHERE estado = 'roadmap' AND uid <> ?", (uid,)
        ).fetchone()[0]
        if activo:
            raise InvalidInput("roadmap solo admite un item activo: ya hay uno en curso")
    viene_de_roadmap = anterior == "roadmap"
    ts = now_iso()
    posicion = None
    if estado == "proposed":
        posicion = conn.execute(
            "SELECT coalesce(max(posicion), 0) + 1 FROM work_item_node WHERE estado = 'proposed'"
        ).fetchone()[0]
    conn.execute(
        "UPDATE work_item_node SET estado = ?, posicion = ?, entered_at = ? WHERE uid = ?",
        (_grupo(estado), posicion, ts, uid),
    )
    if estado in ("draft", "proposed"):
        # En la entrada y la cola las fases y los requisitos están pendientes
        # (ver `_validar_fases_en_lane`): volver allí reinicia lo cerrado,
        # porque el trabajo ya no está activo. Los títulos y las notas se
        # quedan; solo se sueltan el estado y las fechas.
        conn.execute(
            "UPDATE work_item_fase SET estado = 'pendiente', entered_at = ?"
            " WHERE work_item_uid = ? AND estado <> 'pendiente'",
            (ts, uid),
        )
        conn.execute(
            "UPDATE work_item_requisito SET hecho = 0, done_at = NULL"
            " WHERE work_item_uid = ? AND hecho = 1",
            (uid,),
        )
        # El trabajo se rehace desde cero: lo que anotaron los cierres ya no
        # describe estas fases (el próximo cierre vuelve a medir).
        conn.execute("DELETE FROM work_item_fase_archivo WHERE work_item_uid = ?", (uid,))
    # El detalle de roadmap se conserva al avanzar: la ficha archivada cuenta con
    # qué resultado y referencia se cerró el trabajo (ficha 6dda6382). Se retira
    # al volver a la entrada o la cola, que reinicia el plan; al reentrar en
    # roadmap la estancia se reescribe (upsert) para no chocar con la PK.
    if estado in ("draft", "proposed"):
        conn.execute("DELETE FROM roadmap_node WHERE uid = ?", (uid,))
    # El detalle de verificación se conserva al aprobar: la ficha archivada
    # cuenta cómo se verificó (ficha 7188737b). En cualquier otro movimiento se
    # retira, como antes, y al entrar en verificación se borra la estancia
    # anterior para que la nueva no choque con la PK.
    if estado not in ("revision_aprobada", "historial"):
        conn.execute("DELETE FROM verificacion_node WHERE uid = ?", (uid,))
    conn.execute("DELETE FROM revision_node WHERE uid = ?", (uid,))
    if estado not in ("rejected", "superseded"):
        conn.execute("DELETE FROM rejected_node WHERE uid = ?", (uid,))
    if estado == "roadmap":
        conn.execute(
            "INSERT INTO roadmap_node (uid, resultado, referencia) VALUES (?, ?, ?)"
            " ON CONFLICT(uid) DO UPDATE SET"
            "   resultado = excluded.resultado,"
            "   referencia = excluded.referencia",
            (
                uid,
                detalle.get("roadmap_resultado") or "",
                detalle.get("roadmap_referencia") or "",
            ),
        )
    elif estado == "verificacion":
        # Los intentos son del ítem, no de la estancia: el detalle se retira al
        # volver a la cola, así que el contador vive en `work_item_data` (0014) y
        # cada entrada en verificación suma una vuelta.
        intentos = (
            int(
                conn.execute(
                    "SELECT verificacion_intentos FROM work_item_data WHERE uid = ?", (uid,)
                ).fetchone()[0]
            )
            + 1
        )
        conn.execute(
            "UPDATE work_item_data SET verificacion_intentos = ? WHERE uid = ?", (intentos, uid)
        )
        conn.execute(
            "INSERT INTO verificacion_node"
            " (uid, intentos, ultimo_resultado, comentario, roadmap_completed_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                uid,
                intentos,
                detalle.get("verificacion_resultado") or "",
                detalle.get("verificacion_comentario") or "",
                ts if viene_de_roadmap else None,
            ),
        )
    elif estado == "revision_aprobada":
        conn.execute(
            "INSERT INTO revision_node (uid, approved_by, nota) VALUES (?, ?, ?)",
            (uid, detalle.get("approved_by") or "usuario", detalle.get("revision_nota") or ""),
        )
    elif estado in ("rejected", "superseded"):
        _escribir_rechazo(conn, uid, detalle)


def _escribir_rechazo(conn: sqlite3.Connection, uid: str, detalle: dict[str, Any]) -> None:
    """El detalle del descarte, con upsert: re-descartar la misma item no duplica."""
    conn.execute(
        "INSERT INTO rejected_node"
        " (uid, rejected_description, rejected_by, superseded_by_uid)"
        " VALUES (?, ?, ?, ?)"
        " ON CONFLICT(uid) DO UPDATE SET"
        "   rejected_description = excluded.rejected_description,"
        "   rejected_by = excluded.rejected_by,"
        "   superseded_by_uid = excluded.superseded_by_uid",
        (
            uid,
            detalle.get("rejected_description") or "",
            detalle.get("rejected_by") or "usuario",
            detalle.get("superseded_by_uid"),
        ),
    )


def _validar_campos_ficha(detalle: dict[str, Any], estado: str) -> None:
    """Un campo de ficha solo vale en su estado.

    Sin esta comprobación, enviar `verificacion_resultado` estando en
    roadmap dejaba el PATCH en 200 sin tocar nada: el caller creía editar
    y no pasaba nada. Mejor un 400 que diga qué campo y en qué ficha vale.
    """
    for campo in detalle:
        if campo in REJECT_FIELDS:
            if estado not in ("rejected", "superseded"):
                raise InvalidInput(
                    f"El campo {campo} solo vale para la ficha de descartadas, no para {estado}."
                )
        elif campo not in CAMPOS_FICHA.get(estado, set()):
            raise InvalidInput(f"El campo {campo} no pertenece a la ficha de {estado}.")


def _actualizar_ficha_activa(
    conn: sqlite3.Connection, uid: str, estado: str, detalle: dict[str, Any]
) -> None:
    """Edita solo los campos dados de la ficha en la que ya vive el ítem.

    Es el PATCH sin `status` (o reafirmándolo): antes esos campos se
    descartaban y el 200 devolvía el valor viejo.
    """
    if not detalle:
        return
    if estado == "roadmap":
        asignaciones = []
        params: dict[str, Any] = {"uid": uid}
        if "roadmap_resultado" in detalle:
            asignaciones.append("resultado = :roadmap_resultado")
            params["roadmap_resultado"] = detalle["roadmap_resultado"]
        if "roadmap_referencia" in detalle:
            asignaciones.append("referencia = :roadmap_referencia")
            params["roadmap_referencia"] = detalle["roadmap_referencia"]
        if asignaciones:
            conn.execute(
                f"UPDATE roadmap_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
    elif estado == "verificacion":
        asignaciones = []
        params = {"uid": uid}
        if "verificacion_resultado" in detalle:
            asignaciones.append("ultimo_resultado = :verificacion_resultado")
            params["verificacion_resultado"] = detalle["verificacion_resultado"]
        if "verificacion_comentario" in detalle:
            asignaciones.append("comentario = :verificacion_comentario")
            params["verificacion_comentario"] = detalle["verificacion_comentario"]
        if asignaciones:
            conn.execute(
                f"UPDATE verificacion_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
    elif estado == "revision_aprobada":
        asignaciones = []
        params = {"uid": uid}
        if "approved_by" in detalle:
            asignaciones.append("approved_by = :approved_by")
            params["approved_by"] = detalle["approved_by"]
        if "revision_nota" in detalle:
            asignaciones.append("nota = :revision_nota")
            params["revision_nota"] = detalle["revision_nota"]
        if asignaciones:
            conn.execute(
                f"UPDATE revision_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
    elif estado in ("rejected", "superseded"):
        asignaciones = []
        params = {"uid": uid}
        if "rejected_description" in detalle:
            asignaciones.append("rejected_description = :rejected_description")
            params["rejected_description"] = detalle["rejected_description"]
        if "rejected_by" in detalle:
            asignaciones.append("rejected_by = :rejected_by")
            params["rejected_by"] = detalle["rejected_by"]
        if "superseded_by_uid" in detalle:
            asignaciones.append("superseded_by_uid = :superseded_by_uid")
            params["superseded_by_uid"] = detalle["superseded_by_uid"]
        if asignaciones:
            conn.execute(
                f"UPDATE rejected_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
