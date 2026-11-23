"""Compuertas del flujo: fases abiertas, fases completas y protocolos."""

from __future__ import annotations

import sqlite3
from typing import Any

from ..base.comun import InvalidInput
from .estados import _grupo


def _validar_fases_en_lane(destino: str, fases: list[dict[str, Any]]) -> None:
    """En la entrada y la cola las fases y sus requisitos están pendientes.

    Hasta roadmap el ítem es un plan: completar, fallar o rechazar una fase —o
    marcar un requisito— es trabajo, y el trabajo se lleva allí, que es donde
    el ítem está activa. Volver a estos carriles lo devuelve todo a pendiente
    (ver `_escribir_estado`).
    """
    if destino not in ("draft", "proposed"):
        return
    no_pendientes = [fase["titulo"] for fase in fases if fase["estado"] != "pendiente"]
    if no_pendientes:
        raise InvalidInput(
            "en la entrada y la cola las fases solo pueden estar pendientes: "
            + ", ".join(no_pendientes)
        )
    marcados = [
        f"{fase['titulo']} · {requisito['titulo']}"
        for fase in fases
        for requisito in fase["requisitos"]
        if requisito["hecho"]
    ]
    if marcados:
        raise InvalidInput(
            "en la entrada y la cola los requisitos están pendientes: " + ", ".join(marcados)
        )


def _validar_fases_completadas(fases: list[dict[str, Any]]) -> None:
    """Una fase completada no puede dejar requisitos sin completar.

    Los requisitos son su criterio de hecho: si la fase se da por hecha con
    uno pendiente, el checklist no significa nada. Las fases sin requisitos no
    llegan aquí: no se aceptan al escribir (ver `_normalizar_fases`).
    """
    for fase in fases:
        if fase["estado"] != "completada":
            continue
        pendientes = [
            requisito["titulo"] for requisito in fase["requisitos"] if not requisito["hecho"]
        ]
        if pendientes:
            raise InvalidInput(
                f"no se puede completar «{fase['titulo']}»: quedan requisitos sin completar: "
                + ", ".join(pendientes)
            )


def _validar_aprobacion_total(fases: list[dict[str, Any]]) -> None:
    """Aprobar es dar el trabajo por hecho: todo cerrado y comprobado.

    El protocolo ya exige todas las fases completadas y una fase completada no
    puede dejar requisitos pendientes, pero la aprobación es el cierre del
    flujo: se mira también la lista que quedará, sin depender de que el cliente
    la reenvíe. Así un ítem con una fase completada a mano y un requisito
    pendiente no se archiva.
    """
    if not fases:
        raise InvalidInput("no se puede aprobar sin fases: el ítem no tiene ninguna")
    for fase in fases:
        if fase["estado"] != "completada":
            raise InvalidInput(
                f"no se puede aprobar: la fase «{fase['titulo']}» no está completada"
            )
        if not fase["requisitos"]:
            raise InvalidInput(
                f"no se puede aprobar: la fase «{fase['titulo']}» no tiene requisitos"
            )
        pendientes = [
            requisito["titulo"] for requisito in fase["requisitos"] if not requisito["hecho"]
        ]
        if pendientes:
            raise InvalidInput(
                f"no se puede aprobar «{fase['titulo']}»: quedan requisitos sin completar: "
                + ", ".join(pendientes)
            )


def _exige_fases(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Pide el protocolo al menos una fase para cruzar esta unión? (0021)."""
    if _grupo(actual) == _grupo(nuevo):
        return False
    fila = conn.execute(
        "SELECT exige_fases FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return bool(fila and fila[0])


def _exige_fases_listas(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Exige el protocolo que no queden fases pendientes ni fallidas? (0022)."""
    if _grupo(actual) == _grupo(nuevo):
        return False
    fila = conn.execute(
        "SELECT exige_fases_listas FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return bool(fila and fila[0])


def _exige_fases_completas(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Exige el protocolo que toda fase esté completada? (0023).

    `rechazada` no vale: aprobar la revisión es dar el trabajo por hecho.
    """
    if _grupo(actual) == _grupo(nuevo):
        return False
    fila = conn.execute(
        "SELECT exige_fases_completas FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return bool(fila and fila[0])


def _protocolo_ok(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Permite el protocolo ir de `actual` a `nuevo`?

    Mismo grupo no es un traslado (la ficha de descartada se afina con
    `superseded`, el carril no cambia): pasa siempre. Entre grupos manda la
    allowlist `protocolo_flujo`: lo que no está listado se prohíbe.
    """
    if _grupo(actual) == _grupo(nuevo):
        return True
    fila = conn.execute(
        "SELECT 1 FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return fila is not None
