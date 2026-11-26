"""El plan de un PATCH: qué escribir, qué comprobar y qué anotar.

`update_item` hacía los siete trabajos de un PATCH en el mismo sitio: limpiar
los campos, validar la ficha y las dependencias, pasar las compuertas, planificar
la anotación de archivos, escribir el estado, archivar y emitir el evento. Aquí
se decide qué va a pasar —leyendo la ficha y el árbol, sin escribir— y
`update_item` abre la transacción, comprueba y aplica.

Separarlo deja probar una compuerta sobre un plan, sin montar un PATCH entero ni
pasar por HTTP.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from ..base.comun import InvalidInput, now_iso
from ..trabajo.anotacion import (
    _Anotacion,
    _aplicar_anotacion,
    _Plan,
    _plan_de_eventos,
    _planificar_anotacion,
)
from ..trabajo.fases import _escribir_fases, _fases, _normalizar_fases
from .dependencias import _comprobar_dependencias, _validar_dependencias
from .estados import (
    REJECT_FIELDS,
    STATE_FIELDS,
    UPDATABLE,
    _actualizar_ficha_activa,
    _escribir_estado,
    _estado,
    _grupo,
    _validar_campos_ficha,
)
from .validacion import (
    _exige_fases,
    _exige_fases_completas,
    _exige_fases_listas,
    _protocolo_ok,
    _validar_aprobacion_total,
    _validar_fases_completadas,
    _validar_fases_en_lane,
)


def _huella_fases(fases: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    """Lo de las fases que decide el plan, sin los archivos anotados."""
    return [
        (
            fase["orden"],
            fase["titulo"],
            fase["estado"],
            fase["nota"],
            tuple((r["orden"], r["titulo"], bool(r["hecho"])) for r in fase["requisitos"]),
        )
        for fase in fases
    ]


@dataclass(frozen=True)
class _Transicion:
    """Lo que un PATCH va a cambiar, decidido antes del `BEGIN`."""

    uid: str
    actual: str
    nuevo_estado: str | None
    destino: str
    cambiado_estado: bool
    clean: dict[str, Any]
    detalle_ficha: dict[str, Any]
    deps_nuevas: list[str] | None
    fases_previas: list[dict[str, Any]]
    fases_finales: list[dict[str, Any]] | None
    fases_quedan: list[dict[str, Any]]
    archivos: _Plan
    anotacion: _Anotacion | None


def _planificar(
    conn: sqlite3.Connection, repo: str, uid: str, changes: dict[str, Any]
) -> _Transicion:
    """Limpia el PATCH, valida lo que no depende del lock y decide el resto.

    No escribe: lee la ficha, normaliza las fases que llegarán y lee el árbol
    para saber qué se anotará. Lo que necesita la transacción abierta —la
    comprobación de que nada cambió, el protocolo y las compuertas— va en
    `_comprobar`.
    """
    clean = {k: v for k, v in changes.items() if v is not None and k in UPDATABLE}
    rechazo = {k: v for k, v in changes.items() if v is not None and k in REJECT_FIELDS}
    estado_detalle = {k: v for k, v in changes.items() if v is not None and k in STATE_FIELDS}
    fases_pedidas = changes.get("fases")
    if (
        not clean
        and not rechazo
        and not estado_detalle
        and "status" not in changes
        and fases_pedidas is None
    ):
        raise InvalidInput("nada que actualizar")

    if "tags" in clean:
        clean["tags"] = json.dumps(list(clean["tags"]))
    clean["updated_at"] = now_iso()

    nuevo_estado = changes["status"] if changes.get("status") is not None else None
    detalle_ficha = {**rechazo, **estado_detalle}
    # La ficha activa (y el destino, si cambia el estado) decide qué campos de
    # ficha tienen sentido; se comprueba antes de escribir.
    if conn.execute("SELECT 1 FROM work_item_data WHERE uid = ?", (uid,)).fetchone() is None:
        raise KeyError(uid)
    actual = _estado(conn, uid)
    # Las fases se leen una vez: el mismo dato decide la validación, las
    # compuertas y los archivos que se anotan al cerrar (0028).
    fases_previas = _fases(conn, uid)
    destino = nuevo_estado or actual
    _validar_campos_ficha(detalle_ficha, destino)
    # Las dependencias se validan antes del UPDATE: se deduplican, tienen que
    # existir y no pueden cerrar un ciclo. La lista se guarda en JSON.
    deps_nuevas: list[str] | None = None
    if "depende_de" in clean:
        deps_nuevas = _validar_dependencias(conn, uid, list(clean["depende_de"]))
        clean["depende_de"] = json.dumps(deps_nuevas)
    # Un cambio de estado no es un UPDATE de la entrada: crea o retira la fila
    # de cola, de roadmap, de verificación, de revisión aprobada o de
    # descartada. Sin cambio (o reafirmando el mismo), se edita la ficha activa.
    cambiado_estado = nuevo_estado is not None and nuevo_estado != actual
    # Las fases se reemplazan enteras y se validan antes de escribir nada: el
    # gate mira lo que quedará, no lo que había.
    fases_finales = (
        _normalizar_fases(fases_pedidas, fases_previas) if fases_pedidas is not None else None
    )
    if fases_finales is not None:
        _validar_fases_en_lane(destino, fases_finales)
        _validar_fases_completadas(fases_finales)
    # El gate mira la lista que quedará: la que llega en este PATCH o, si no
    # hay, la que ya tiene el ítem.
    fases_quedan = (
        (fases_finales if fases_finales is not None else fases_previas) if cambiado_estado else []
    )
    # El árbol se lee aquí, con la transacción todavía sin abrir: el lock de
    # escritura no cubre el recorrido ni el `git diff`, y un PATCH con varias
    # fases hace uno de cada.
    archivos = _plan_de_eventos(
        fases_previas,
        fases_finales if fases_finales is not None else fases_previas,
        inicio=cambiado_estado and _grupo(str(nuevo_estado)) == "roadmap",
    )
    anotacion = _planificar_anotacion(conn, repo, uid, archivos)
    return _Transicion(
        uid=uid,
        actual=actual,
        nuevo_estado=nuevo_estado,
        destino=destino,
        cambiado_estado=cambiado_estado,
        clean=clean,
        detalle_ficha=detalle_ficha,
        deps_nuevas=deps_nuevas,
        fases_previas=fases_previas,
        fases_finales=fases_finales,
        fases_quedan=fases_quedan,
        archivos=archivos,
        anotacion=anotacion,
    )


def _comprobar(conn: sqlite3.Connection, plan: _Transicion) -> None:
    """Pasa las compuertas del flujo con el lock tomado, antes de escribir nada.

    Primero que el plan siga sirviendo: otra petición pudo escribir entre la
    lectura y el `BEGIN`, y entonces se calculó con datos que ya no valen.
    """
    if _estado(conn, plan.uid) != plan.actual or _huella_fases(
        _fases(conn, plan.uid)
    ) != _huella_fases(plan.fases_previas):
        raise InvalidInput("el ítem cambió mientras se preparaba el PATCH: reintenta")
    if not plan.cambiado_estado or plan.nuevo_estado is None:
        return
    nuevo = plan.nuevo_estado
    # Los protocolos mandan sobre el flujo: una unión no listada se rechaza
    # (400) y no escribe nada.
    if not _protocolo_ok(conn, plan.actual, nuevo):
        raise InvalidInput(
            f"el protocolo no permite el flujo {plan.actual} → {nuevo}:"
            " esa unión no está en `protocolo_flujo`"
        )
    _comprobar_dependencias(conn, plan.uid, nuevo, plan.deps_nuevas)
    if _exige_fases(conn, plan.actual, nuevo) and not plan.fases_quedan:
        raise InvalidInput(f"el protocolo exige al menos una fase para pasar a {nuevo}")
    if _exige_fases_listas(conn, plan.actual, nuevo):
        abiertas = [
            fase["titulo"]
            for fase in plan.fases_quedan
            if fase["estado"] in ("pendiente", "fallida")
        ]
        if abiertas:
            raise InvalidInput(
                f"no puede pasar a {nuevo}: quedan fases sin cerrar: " + ", ".join(abiertas)
            )
    if _exige_fases_completas(conn, plan.actual, nuevo):
        incompletas = [
            fase["titulo"] for fase in plan.fases_quedan if fase["estado"] != "completada"
        ]
        if incompletas:
            raise InvalidInput(
                f"no puede pasar a {nuevo}: hay fases sin completar: " + ", ".join(incompletas)
            )
    if _grupo(nuevo) in ("revision_aprobada", "historial"):
        _validar_aprobacion_total(plan.fases_quedan)


def _aplicar(conn: sqlite3.Connection, plan: _Transicion) -> None:
    """Escribe lo planificado: solo SQL, con el árbol ya leído."""
    assignments = ", ".join(f"{column} = :{column}" for column in plan.clean)
    cursor = conn.execute(
        f"UPDATE work_item_data SET {assignments} WHERE uid = :uid",
        {**plan.clean, "uid": plan.uid},
    )
    if cursor.rowcount == 0:
        raise KeyError(plan.uid)
    if plan.cambiado_estado and plan.nuevo_estado is not None:
        _escribir_estado(conn, plan.uid, plan.nuevo_estado, plan.detalle_ficha)
        # Aprobar archiva: la firma se queda en `revision_node` y la item pasa a
        # `historial` en la misma transacción. El carril aprobado es la
        # compuerta, no un sitio donde esperar.
        if plan.nuevo_estado == "revision_aprobada":
            conn.execute(
                "UPDATE work_item_node SET estado = 'historial', posicion = NULL WHERE uid = ?",
                (plan.uid,),
            )
    else:
        _actualizar_ficha_activa(conn, plan.uid, plan.actual, plan.detalle_ficha)
    if plan.fases_finales is not None:
        _escribir_fases(conn, plan.uid, plan.fases_finales)
    # Ya con las fases escritas, se aplica lo que se planificó antes del
    # `BEGIN`: el delta del PATCH se anota en el primer evento.
    _aplicar_anotacion(conn, plan.uid, plan.archivos, plan.anotacion)
