"""Dependencias entre items: grafo, compuertas y avance bloqueado."""

from __future__ import annotations

import sqlite3

from ..base.comun import InvalidInput, _tags_json
from .estados import _estado

# Estados a los que un ítem no puede entrar con una dependencia sin aprobar.
# Volver a cola, quedarse en la entrada o descartarse sí se permite: si no,
# un ítem bloqueada no tendría salida. El historial también es avance, pero
# un ítem solo llega archivada desde la aprobación, que ya lo comprobó.
AVANCE = ("roadmap", "verificacion", "revision_aprobada", "historial")


def _depende_de(conn: sqlite3.Connection, uid: str) -> list[str]:
    """Los uids que bloquean a este ítem (`depende_de`, 0018)."""
    fila = conn.execute("SELECT depende_de FROM idea_data WHERE uid = ?", (uid,)).fetchone()
    return _tags_json(fila[0]) if fila else []


def _validar_dependencias(conn: sqlite3.Connection, uid: str, deps: list[str]) -> list[str]:
    """Comprueba que las dependencias existen y que el grafo no tiene ciclos.

    SQLite no puede poner una FK dentro de una lista JSON, así que la regla
    vive aquí: se deduplica, se rechaza la auto-dependencia, se comprueba que
    cada uid esté en el repo y se sigue el grafo para que A→B→A no cuele.
    """
    limpias: list[str] = []
    for dep in deps:
        if dep not in limpias:
            limpias.append(dep)
    if uid in limpias:
        raise InvalidInput("un ítem no puede depender de sí misma")
    if limpias:
        marcas = ",".join("?" for _ in limpias)
        existentes = {
            str(fila[0])
            for fila in conn.execute(f"SELECT uid FROM idea_data WHERE uid IN ({marcas})", limpias)
        }
        faltan = [dep for dep in limpias if dep not in existentes]
        if faltan:
            raise InvalidInput(f"depende_de apunta a items que no existen: {', '.join(faltan)}")

    pila = list(limpias)
    visto: set[str] = set()
    while pila:
        actual = pila.pop()
        if actual == uid:
            raise InvalidInput("depende_de forma un ciclo: un ítem no puede bloquearse a sí misma")
        if actual in visto:
            continue
        visto.add(actual)
        pila.extend(_depende_de(conn, actual))
    return limpias


def _sin_aprobar(conn: sqlite3.Connection, deps: list[str]) -> list[str]:
    """Títulos de las dependencias que aún no están aprobadas.

    El historial cuenta como aprobado: archivar un ítem no puede desbloquear
    ni volver a bloquear a las que dependen de ella.
    """
    pendientes: list[str] = []
    for dep in deps:
        fila = conn.execute("SELECT title FROM idea_data WHERE uid = ?", (dep,)).fetchone()
        if _estado(conn, dep) not in ("revision_aprobada", "historial"):
            pendientes.append(str(fila[0]) if fila else dep)
    return pendientes


def _comprobar_dependencias(
    conn: sqlite3.Connection, uid: str, destino: str, deps: list[str] | None = None
) -> None:
    """Frena el avance mientras alguna dependencia no esté aprobada.

    Una dependencia descartada no libera: el ítem queda bloqueado y el
    mensaje lo dice, en vez de dejar el movimiento a medias.
    """
    if destino not in AVANCE:
        return
    pendientes = _sin_aprobar(conn, _depende_de(conn, uid) if deps is None else deps)
    if pendientes:
        raise InvalidInput(
            f"no puede pasar a {destino}: depende de {', '.join(pendientes)}, sin revisión aprobada"
        )
