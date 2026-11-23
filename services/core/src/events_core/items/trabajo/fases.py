"""Fases y requisitos: normalización, escritura y lectura agrupada."""

from __future__ import annotations

import sqlite3
from typing import Any

from ..base.comun import InvalidInput, now_iso
from ..modelo.estados import FASE_ESTADOS


def _requisitos(conn: sqlite3.Connection, uid: str) -> dict[int, list[dict[str, Any]]]:
    """Los requisitos de el ítem, agrupados por el orden de su fase (0025)."""
    por_fase: dict[int, list[dict[str, Any]]] = {}
    for fila in conn.execute(
        "SELECT fase_orden, orden, titulo, hecho, done_at"
        " FROM idea_requisito WHERE idea_uid = ? ORDER BY fase_orden, orden",
        (uid,),
    ):
        por_fase.setdefault(int(fila["fase_orden"]), []).append(
            {
                "orden": fila["orden"],
                "titulo": fila["titulo"],
                "hecho": bool(fila["hecho"]),
                "done_at": fila["done_at"],
            }
        )
    return por_fase


def _archivos(conn: sqlite3.Connection, uid: str) -> dict[int, list[dict[str, Any]]]:
    """Los archivos anotados en cada fase (0028), por orden de fase.

    Cada fila cuelga de un requisito (`requisito_orden`) o de la fase entera
    (`0`). Es la ficha: aquí sí viene el contenido (el parche de Git, si lo
    hubo). El mapa los pide sin contenido con `_fases_en_lote` para no
    arrastrar parches.
    """
    por_fase: dict[int, list[dict[str, Any]]] = {}
    for fila in conn.execute(
        "SELECT fase_orden, requisito_orden, ruta, estado, desde, contenido"
        " FROM idea_fase_archivo WHERE idea_uid = ?"
        " ORDER BY fase_orden, requisito_orden, ruta",
        (uid,),
    ):
        por_fase.setdefault(int(fila["fase_orden"]), []).append(
            {
                "requisito_orden": int(fila["requisito_orden"]),
                "ruta": fila["ruta"],
                "estado": fila["estado"],
                "desde": fila["desde"],
                "contenido": fila["contenido"],
            }
        )
    return por_fase


def _con_archivos(
    fase: dict[str, Any], requisitos: list[dict[str, Any]], archivos: list[dict[str, Any]]
) -> dict[str, Any]:
    """Cuelga cada archivo de su requisito y deja la lista entera en la fase.

    Un archivo con `requisito_orden` 0 no se pudo atar a un requisito (lo cerró
    la fase, se marcaron varios a la vez o quedó suelto): se queda en la fase.
    La fase suma siempre todo, así el cierre sigue enseñando el total.
    """
    por_requisito: dict[int, list[dict[str, Any]]] = {}
    for archivo in archivos:
        limpio = {clave: valor for clave, valor in archivo.items() if clave != "requisito_orden"}
        por_requisito.setdefault(int(archivo["requisito_orden"]), []).append(limpio)
    return {
        **fase,
        "requisitos": [
            {**requisito, "archivos": por_requisito.get(int(requisito["orden"]), [])}
            for requisito in requisitos
        ],
        "archivos": [
            {clave: valor for clave, valor in archivo.items() if clave != "requisito_orden"}
            for archivo in archivos
        ],
    }


def _fases(conn: sqlite3.Connection, uid: str) -> list[dict[str, Any]]:
    """Las fases de un ítem, en orden (`idea_fase`, 0021), con sus requisitos."""
    filas = conn.execute(
        "SELECT orden, titulo, estado, nota, entered_at"
        " FROM idea_fase WHERE idea_uid = ? ORDER BY orden",
        (uid,),
    ).fetchall()
    requisitos = _requisitos(conn, uid)
    anotados = _archivos(conn, uid)
    return [
        _con_archivos(
            dict(fila),
            requisitos.get(int(fila["orden"]), []),
            anotados.get(int(fila["orden"]), []),
        )
        for fila in filas
    ]


def _fases_en_lote(conn: sqlite3.Connection, uids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Las fases de muchas items, en una consulta (listado y mapa)."""
    por_uid: dict[str, list[dict[str, Any]]] = {uid: [] for uid in uids}
    if not uids:
        return por_uid
    marcas = ",".join("?" for _ in uids)
    requisitos: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for fila in conn.execute(
        "SELECT idea_uid, fase_orden, orden, titulo, hecho, done_at"
        f" FROM idea_requisito WHERE idea_uid IN ({marcas}) ORDER BY idea_uid, fase_orden, orden",
        uids,
    ):
        requisitos.setdefault((str(fila["idea_uid"]), int(fila["fase_orden"])), []).append(
            {
                "orden": fila["orden"],
                "titulo": fila["titulo"],
                "hecho": bool(fila["hecho"]),
                "done_at": fila["done_at"],
            }
        )
    # Los archivos viajan sin contenido: el mapa y el listado enseñan el
    # recuento y la ruta, no el parche (eso es la ficha, un ítem a la vez).
    anotados: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for fila in conn.execute(
        "SELECT idea_uid, fase_orden, requisito_orden, ruta, estado, desde"
        " FROM idea_fase_archivo"
        f" WHERE idea_uid IN ({marcas}) ORDER BY idea_uid, fase_orden, requisito_orden, ruta",
        uids,
    ):
        anotados.setdefault((str(fila["idea_uid"]), int(fila["fase_orden"])), []).append(
            {
                "requisito_orden": int(fila["requisito_orden"]),
                "ruta": fila["ruta"],
                "estado": fila["estado"],
                "desde": fila["desde"],
                "contenido": None,
            }
        )
    for fila in conn.execute(
        "SELECT idea_uid, orden, titulo, estado, nota, entered_at"
        f" FROM idea_fase WHERE idea_uid IN ({marcas}) ORDER BY idea_uid, orden",
        uids,
    ):
        uid = str(fila["idea_uid"])
        por_uid[uid].append(
            _con_archivos(
                {
                    "orden": fila["orden"],
                    "titulo": fila["titulo"],
                    "estado": fila["estado"],
                    "nota": fila["nota"],
                    "entered_at": fila["entered_at"],
                },
                requisitos.get((uid, int(fila["orden"])), []),
                anotados.get((uid, int(fila["orden"])), []),
            )
        )
    return por_uid


def _normalizar_requisitos(pedidos: Any, existentes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Valida los requisitos de una fase y conserva `done_at` si no cambian.

    Sin `requisitos` en el PATCH se quedan los que había (una fase editada
    desde un cliente viejo no borra su checklist); con lista, aunque vacía, se
    reemplazan enteros. Sin `orden`, el requisito se añade al final.
    """
    if pedidos is None:
        return [dict(requisito) for requisito in existentes]
    if not isinstance(pedidos, list):
        raise InvalidInput("requisitos tiene que ser una lista")
    previos = {int(requisito["orden"]): requisito for requisito in existentes}
    siguiente = max(previos, default=0)
    normalizados: list[dict[str, Any]] = []
    vistas: set[int] = set()
    for item in pedidos:
        if not isinstance(item, dict):
            raise InvalidInput("cada requisito tiene que ser un objeto")
        titulo = str(item.get("titulo") or "").strip()
        if not titulo:
            raise InvalidInput("un requisito sin título no vale")
        orden = item.get("orden")
        if orden is None:
            siguiente += 1
            orden = siguiente
        try:
            orden = int(orden)
        except (TypeError, ValueError) as exc:
            raise InvalidInput("el orden de un requisito tiene que ser un entero") from exc
        if orden < 1:
            raise InvalidInput("el orden de un requisito empieza en 1")
        if orden in vistas:
            raise InvalidInput(f"el orden de requisito {orden} está repetido")
        vistas.add(orden)
        hecho = bool(item.get("hecho"))
        previo = previos.get(orden)
        done_at = None
        if hecho:
            conserva = previo is not None and previo["hecho"] and previo["done_at"]
            done_at = str(previo["done_at"]) if conserva else now_iso()
        normalizados.append({"orden": orden, "titulo": titulo, "hecho": hecho, "done_at": done_at})
    return sorted(normalizados, key=lambda requisito: requisito["orden"])


def _normalizar_fases(fases: Any, existentes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Valida la lista de fases y decide la fecha de entrada de cada una.

    El PATCH reemplaza la lista entera: lo que llega es lo que queda. Una fase
    que conserva su `orden` y su estado conserva `entered_at`; si cambia de
    estado o es nueva, entra ahora. Sin `orden`, se añade al final.
    """
    if not isinstance(fases, list):
        raise InvalidInput("fases tiene que ser una lista")
    previas = {int(fase["orden"]): fase for fase in existentes}
    siguiente = max(previas, default=0)
    normalizadas: list[dict[str, Any]] = []
    vistas: set[int] = set()
    for item in fases:
        if not isinstance(item, dict):
            raise InvalidInput("cada fase tiene que ser un objeto")
        titulo = str(item.get("titulo") or "").strip()
        if not titulo:
            raise InvalidInput("una fase sin título no vale")
        estado = str(item.get("estado") or "pendiente")
        if estado not in FASE_ESTADOS:
            raise InvalidInput(f"estado de fase desconocido: {estado}")
        orden = item.get("orden")
        if orden is None:
            siguiente += 1
            orden = siguiente
        try:
            orden = int(orden)
        except (TypeError, ValueError) as exc:
            raise InvalidInput("el orden de una fase tiene que ser un entero") from exc
        if orden < 1:
            raise InvalidInput("el orden de una fase empieza en 1")
        if orden in vistas:
            raise InvalidInput(f"el orden de fase {orden} está repetido")
        vistas.add(orden)
        previa = previas.get(orden)
        requisitos = _normalizar_requisitos(
            item.get("requisitos"), (previa or {}).get("requisitos", [])
        )
        # Toda fase necesita al menos un requisito: es su criterio de hecho y
        # una fase sin nada que comprobar no se puede cerrar con sentido.
        if not requisitos:
            raise InvalidInput(f"la fase «{titulo}» necesita al menos un requisito")
        nota = str(item.get("nota") or "")
        # Fallar sin motivo no explica nada: la nota es obligatoria al fallar.
        if estado == "fallida" and not nota.strip():
            raise InvalidInput(f"la fase «{titulo}» está fallida sin motivo")
        normalizadas.append(
            {
                "orden": orden,
                "titulo": titulo,
                "estado": estado,
                "nota": nota,
                "entered_at": (
                    previa["entered_at"]
                    if previa is not None and previa["estado"] == estado
                    else now_iso()
                ),
                "requisitos": requisitos,
            }
        )
    return sorted(normalizadas, key=lambda fase: fase["orden"])


def _escribir_fases(conn: sqlite3.Connection, uid: str, fases: list[dict[str, Any]]) -> None:
    """Reemplaza las fases de el ítem (borra e inserta, en su transacción).

    El borrado se lleva los requisitos por la cascada; después se insertan los
    que traiga cada fase, en el mismo orden. Todo o nada.
    """
    conn.execute("DELETE FROM idea_fase WHERE idea_uid = ?", (uid,))
    conn.executemany(
        "INSERT INTO idea_fase (idea_uid, orden, titulo, estado, nota, entered_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        [
            (uid, fase["orden"], fase["titulo"], fase["estado"], fase["nota"], fase["entered_at"])
            for fase in fases
        ],
    )
    # Los archivos anotados no cuelgan de `idea_fase` (la tabla se reemplaza
    # entera): se poda a mano lo que ya no tiene fase, para no dejar huérfanos.
    ordenes = [int(fase["orden"]) for fase in fases]
    if ordenes:
        marcas = ",".join("?" for _ in ordenes)
        conn.execute(
            f"DELETE FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden NOT IN ({marcas})",
            (uid, *ordenes),
        )
    else:
        conn.execute("DELETE FROM idea_fase_archivo WHERE idea_uid = ?", (uid,))
    conn.executemany(
        "INSERT INTO idea_requisito (idea_uid, fase_orden, orden, titulo, hecho, done_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                uid,
                fase["orden"],
                requisito["orden"],
                requisito["titulo"],
                int(requisito["hecho"]),
                requisito["done_at"],
            )
            for fase in fases
            for requisito in fase["requisitos"]
        ],
    )
