"""Los archivos que toca cada fase o requisito (0028, 0029), por evento."""

from __future__ import annotations

import sqlite3
from typing import Any

from ... import archivos, registro
from ..base.comun import now_iso
from ..base.rutas import resolve_repo
from ..modelo.estados import FASE_CIERRE

# El tope por fase (`LIMITE_TOTAL` de `archivos.py`) no acota el almacén: hay una
# fila por archivo y fase, y un repo con muchas fases lo engorda sin límite.
# Este tope es global por base. Al pasarse se sueltan los parches de las fases
# más viejas —la ruta y el estado se quedan—, que es el trabajo que ya no se
# consulta; el reciente se conserva entero.
LIMITE_PARQUES = 8 * 1024 * 1024


def _foto_texto(conn: sqlite3.Connection, uid: str) -> str | None:
    """La última foto del árbol de la idea, si ya se tomó alguna (0028)."""
    fila = conn.execute("SELECT archivos FROM idea_foto WHERE idea_uid = ?", (uid,)).fetchone()
    return str(fila[0]) if fila else None


def _foto_guardar(conn: sqlite3.Connection, uid: str, estado: dict[str, tuple[int, int]]) -> None:
    """Reemplaza la foto de la idea: es el estado actual, no un historial."""
    conn.execute(
        "INSERT INTO idea_foto (idea_uid, ts, archivos) VALUES (?, ?, ?)"
        " ON CONFLICT (idea_uid) DO UPDATE SET ts = excluded.ts, archivos = excluded.archivos",
        (uid, now_iso(), archivos.serializar(estado)),
    )


def _escribir_archivos(
    conn: sqlite3.Connection,
    uid: str,
    orden: int,
    requisito: int,
    cambios: list[dict[str, Any]],
) -> None:
    """Escribe los archivos de una fase o de uno de sus requisitos (0029).

    La fase se reescribe: su lista es el cambio del último evento. El requisito
    se suma: deshacer la marca no borra lo anotado y volver a marcarlo no lo
    pisa, así que un clic de más no se lleva el registro. El `COALESCE` conserva
    el parche bueno si el evento nuevo no trae contenido.
    """
    if requisito == 0:
        conn.execute(
            "DELETE FROM idea_fase_archivo"
            " WHERE idea_uid = ? AND fase_orden = ? AND requisito_orden = 0",
            (uid, orden),
        )
    conn.executemany(
        "INSERT INTO idea_fase_archivo"
        " (idea_uid, fase_orden, requisito_orden, ruta, estado, desde, contenido)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (idea_uid, fase_orden, requisito_orden, ruta) DO UPDATE SET"
        "   estado = excluded.estado,"
        "   desde = excluded.desde,"
        "   contenido = COALESCE(excluded.contenido, idea_fase_archivo.contenido)",
        [
            (
                uid,
                orden,
                requisito,
                cambio["ruta"],
                cambio["estado"],
                cambio.get("desde"),
                cambio.get("contenido"),
            )
            for cambio in cambios
        ],
    )


def _podar_parches(conn: sqlite3.Connection) -> int:
    """Suelta el contenido de las fases más viejas si la base pasa del tope.

    Se cuentan bytes, no caracteres (`CAST … AS BLOB`), que es lo que ocupa el
    fichero. El orden es el de entrada de la fase en su estado: lo que se cerró
    antes es lo que antes deja de mirarse. Se poda una fase entera de golpe para
    no dejar medio registro con parche y medio sin él. Devuelve cuántas fases se
    quedaron sin contenido.
    """
    total = int(
        conn.execute(
            "SELECT COALESCE(SUM(LENGTH(CAST(contenido AS BLOB))), 0) FROM idea_fase_archivo"
        ).fetchone()[0]
    )
    if total <= LIMITE_PARQUES:
        return 0
    grupos = conn.execute(
        "SELECT a.idea_uid, a.fase_orden FROM idea_fase_archivo a"
        " LEFT JOIN idea_fase f ON f.idea_uid = a.idea_uid AND f.orden = a.fase_orden"
        " WHERE a.contenido IS NOT NULL"
        " GROUP BY a.idea_uid, a.fase_orden"
        " ORDER BY COALESCE(f.entered_at, '') ASC, a.idea_uid, a.fase_orden"
    ).fetchall()
    podadas = 0
    for idea_uid, fase_orden in grupos:
        if total <= LIMITE_PARQUES:
            break
        pesa = int(
            conn.execute(
                "SELECT COALESCE(SUM(LENGTH(CAST(contenido AS BLOB))), 0)"
                " FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden = ?",
                (idea_uid, fase_orden),
            ).fetchone()[0]
        )
        conn.execute(
            "UPDATE idea_fase_archivo SET contenido = NULL"
            " WHERE idea_uid = ? AND fase_orden = ? AND contenido IS NOT NULL",
            (idea_uid, fase_orden),
        )
        total -= pesa
        podadas += 1
    return podadas


def _anotar_archivos(
    conn: sqlite3.Connection,
    repo: str,
    uid: str,
    antes: list[dict[str, Any]],
    despues: list[dict[str, Any]],
    *,
    inicio: bool,
) -> None:
    """Anota los archivos que cambiaron, por fase y por requisito (0029).

    Se comparan dos fotos del árbol, no se vigila nada: la de partida es la
    última guardada (o la de la entrada en roadmap, que es donde empieza el
    trabajo). Cada evento —cerrar una fase o marcar un requisito— se lleva lo
    que cambió desde la foto anterior. Sin foto previa no se inventa un cambio:
    se toma la primera y el evento siguiente ya mide de verdad. Sin Git la foto
    da rutas y estado; con Git se añade el parche (`archivos.contenidos`).

    Un fallo del árbol no puede tumbar el PATCH: la fase se cierra igual y el
    aviso queda en el registro.
    """
    previas = {int(fase["orden"]): fase for fase in antes}
    vigentes = [int(fase["orden"]) for fase in despues]
    if vigentes:
        marcas = ",".join("?" for _ in vigentes)
        conn.execute(
            f"DELETE FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden NOT IN ({marcas})",
            (uid, *vigentes),
        )
    else:
        conn.execute("DELETE FROM idea_fase_archivo WHERE idea_uid = ?", (uid,))

    # Cada evento pendiente es (fase, requisito); el requisito 0 es «la fase».
    eventos: list[tuple[int, int]] = []
    for fase in despues:
        orden = int(fase["orden"])
        previa = previas.get(orden)
        hechos_antes = {
            int(requisito["orden"]): bool(requisito["hecho"])
            for requisito in (previa or {}).get("requisitos", [])
        }
        if previa is None:
            # Una fase nueva con un número que fue de otra no hereda sus archivos.
            conn.execute(
                "DELETE FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden = ?",
                (uid, orden),
            )
        elif fase["estado"] == "pendiente" and previa["estado"] != "pendiente":
            # Reabrir la fase suelta lo anotado: todavía no ha hecho nada nuevo.
            conn.execute(
                "DELETE FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden = ?",
                (uid, orden),
            )
        elif fase["estado"] in FASE_CIERRE and previa["estado"] != fase["estado"]:
            eventos.append((orden, 0))
        else:
            hechos_ahora = {
                int(requisito["orden"]) for requisito in fase["requisitos"] if requisito["hecho"]
            }
            # Un requisito que ya no existe suelta su carril: sus archivos no
            # pueden colgar de algo que se borró. Deshacer la marca, en cambio,
            # no borra nada: lo anotado es lo que cambió mientras se hizo, y un
            # clic de más no puede llevarse el registro (se puede volver a
            # marcar y sigue ahí).
            vigentes_requisitos = {int(requisito["orden"]) for requisito in fase["requisitos"]}
            for orden_requisito in sorted(set(hechos_antes) - vigentes_requisitos):
                conn.execute(
                    "DELETE FROM idea_fase_archivo"
                    " WHERE idea_uid = ? AND fase_orden = ? AND requisito_orden = ?",
                    (uid, orden, orden_requisito),
                )
            nuevos = sorted(
                orden_requisito
                for orden_requisito in hechos_ahora
                if not hechos_antes.get(orden_requisito)
            )
            if len(nuevos) == 1:
                eventos.append((orden, nuevos[0]))
            elif nuevos:
                # Varios a la vez: no hay forma de repartir el trabajo entre
                # ellos, así que se anota en la fase y cada uno se queda sin
                # lista propia.
                eventos.append((orden, 0))

    if not eventos and not inicio:
        return

    try:
        carpeta = resolve_repo(repo)
        # `None` es «no hay foto»; `{}` es un árbol vacío, que sí es una foto
        # (una idea que empieza en una carpeta limpia anota lo que crea).
        texto = _foto_texto(conn, uid)
        base: dict[str, tuple[int, int]] | None = (
            archivos.deserializar(texto) if texto is not None else None
        )
        if inicio:
            base = archivos.foto(carpeta)
        for orden, requisito in eventos:
            ahora = archivos.foto(carpeta)
            if base is None:
                # Primera foto: no hay contra qué comparar, así que no se anota
                # un cambio que no se sabe si hubo.
                base = ahora
                break
            cambios = archivos.cambios(base, ahora)
            archivos.contenidos(carpeta, cambios)
            _escribir_archivos(conn, uid, orden, requisito, cambios)
            base = ahora
        if base is not None:
            _foto_guardar(conn, uid, base)
        podadas = _podar_parches(conn)
        if podadas:
            registro.escribir(
                "aviso",
                f"Parches sueltos de {uid}: {podadas} fases antiguas, tope de "
                f"{LIMITE_PARQUES // (1024 * 1024)} MiB por almacén",
            )
    except OSError as exc:
        registro.escribir("aviso", f"No se pudieron anotar los archivos de {uid}: {exc}")
