"""Los archivos que toca cada fase o requisito (0028, 0029).

La foto se toma **antes** del `BEGIN`: se decide qué eventos trae el PATCH, se
recorre el árbol una sola vez y solo después se escribe el SQL, así que el lock
de escritura no cubre ni el recorrido ni el `git diff`.

El delta de un PATCH se atribuye al **primer** evento. Un único recorrido no se
puede repartir entre fases, y repartirlo sería inventar: los demás eventos del
mismo PATCH no reescriben su lista.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
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

# Tope blando de la anotación: pasado este tiempo entre pasos, no se paga el
# `git diff` y el evento se queda sin archivos, con aviso. Una fase cerrada sin
# lista es recuperable; un core que no acepta escrituras durante segundos, no.
PRESUPUESTO_MS = 2_000


def _foto_texto(conn: sqlite3.Connection, uid: str) -> str | None:
    """La última foto del árbol de el ítem, si ya se tomó alguna (0028)."""
    fila = conn.execute("SELECT archivos FROM idea_foto WHERE idea_uid = ?", (uid,)).fetchone()
    return str(fila[0]) if fila else None


def _foto_guardar(conn: sqlite3.Connection, uid: str, estado: dict[str, tuple[int, int]]) -> None:
    """Reemplaza la foto de el ítem: es el estado actual, no un historial."""
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


@dataclass(frozen=True)
class _Plan:
    """Qué filas toca el PATCH, decidido sin tocar la base ni el disco."""

    vigentes: tuple[int, ...]
    nuevas: tuple[int, ...]
    reabiertas: tuple[int, ...]
    requisitos_fuera: tuple[tuple[int, int], ...]
    eventos: tuple[tuple[int, int], ...]
    inicio: bool


@dataclass(frozen=True)
class _Anotacion:
    """Lo que se leyó del árbol, todavía sin transacción abierta."""

    cambios: list[dict[str, Any]]
    foto: dict[str, tuple[int, int]]
    saltados: tuple[tuple[int, int], ...] = ()


def _plan_de_eventos(
    antes: list[dict[str, Any]],
    despues: list[dict[str, Any]],
    *,
    inicio: bool,
) -> _Plan:
    """Qué eventos y qué limpiezas pide el PATCH, solo en memoria.

    Un evento es `(fase, requisito)`, con el requisito 0 para «la fase». La
    decisión no mira el disco ni escribe: eso es lo que permite leer el árbol
    antes de abrir la transacción.
    """
    previas = {int(fase["orden"]): fase for fase in antes}
    vigentes = tuple(int(fase["orden"]) for fase in despues)
    nuevas: list[int] = []
    reabiertas: list[int] = []
    requisitos_fuera: list[tuple[int, int]] = []
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
            nuevas.append(orden)
        elif fase["estado"] == "pendiente" and previa["estado"] != "pendiente":
            # Reabrir la fase suelta lo anotado: todavía no ha hecho nada nuevo.
            reabiertas.append(orden)
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
                requisitos_fuera.append((orden, orden_requisito))
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
    return _Plan(
        vigentes=vigentes,
        nuevas=tuple(nuevas),
        reabiertas=tuple(reabiertas),
        requisitos_fuera=tuple(requisitos_fuera),
        eventos=tuple(eventos),
        inicio=inicio,
    )


def _agotado(inicio: float) -> bool:
    """¿La anotación lleva más del presupuesto blando?

    Se mira entre pasos, no dentro: un recorrido del árbol no se puede
    interrumpir a media enumeración. Lo que sí se puede es no empezar el
    siguiente, que es el caro (el `git diff`).
    """
    return (time.monotonic() - inicio) * 1000 >= PRESUPUESTO_MS


def _eventos_texto(eventos: tuple[tuple[int, int], ...]) -> str:
    """«fase 1», «fase 2/requisito 1»: los eventos que se quedaron sin archivos."""
    return ", ".join(
        f"fase {fase}" if requisito == 0 else f"fase {fase}/requisito {requisito}"
        for fase, requisito in eventos
    )


def _planificar_anotacion(
    conn: sqlite3.Connection,
    repo: str,
    uid: str,
    plan: _Plan,
) -> _Anotacion | None:
    """Lee el árbol y calcula el delta, sin escribir y una sola vez por PATCH.

    Se llama **antes** del primer `INSERT`/`UPDATE`: el lock de escritura no
    cubre ni el recorrido del árbol ni el `git diff`. Cerrar tres fases en un
    mismo PATCH hace un recorrido y un diff, no tres.

    Se comparan dos fotos del árbol, no se vigila nada: la de partida es la
    última guardada (o la de la entrada en roadmap, que es donde empieza el
    trabajo). Sin Git la foto da rutas y estado; con Git se añade el parche
    (`archivos.contenidos`).
    """
    if not plan.eventos and not plan.inicio:
        return None
    try:
        carpeta = resolve_repo(repo)
        # `None` es «no hay foto»; `{}` es un árbol vacío, que sí es una foto
        # (un ítem que empieza en una carpeta limpia anota lo que crea).
        texto = _foto_texto(conn, uid)
        base = archivos.deserializar(texto) if texto is not None else None
        if plan.inicio:
            # Entrar en roadmap no anota nada: toma la foto contra la que se
            # medirá el primer cierre.
            return _Anotacion(cambios=[], foto=archivos.foto(carpeta))
        inicio = time.monotonic()
        ahora = archivos.foto(carpeta)
        if base is None:
            # Primera foto: no hay contra qué comparar, así que no se anota un
            # cambio que no se sabe si hubo. El evento siguiente ya mide.
            return _Anotacion(cambios=[], foto=ahora)
        if _agotado(inicio):
            # El recorrido ya se pasó del tope: no se paga el `git diff` y el
            # evento se queda sin archivos. La foto avanza igual, para no
            # atribuir a un evento futuro lo que era de este.
            return _Anotacion(cambios=[], foto=ahora, saltados=plan.eventos)
        cambios = archivos.cambios(base, ahora)
        archivos.contenidos(carpeta, cambios)
        return _Anotacion(cambios=cambios, foto=ahora)
    except OSError as exc:
        # Un fallo del árbol no puede tumbar el PATCH: la fase se cierra igual
        # y el aviso queda en el registro.
        registro.escribir("aviso", f"No se pudieron anotar los archivos de {uid}: {exc}")
        return None


def _aplicar_anotacion(
    conn: sqlite3.Connection,
    uid: str,
    plan: _Plan,
    anotacion: _Anotacion | None,
) -> None:
    """Escribe lo planificado: solo SQL, con el disco ya leído.

    El delta del PATCH entero se atribuye al **primer** evento: un único
    recorrido no se puede repartir entre fases, y repartirlo sería inventar. Los
    demás eventos del mismo PATCH no reescriben su lista.
    """
    if plan.vigentes:
        marcas = ",".join("?" for _ in plan.vigentes)
        conn.execute(
            f"DELETE FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden NOT IN ({marcas})",
            (uid, *plan.vigentes),
        )
    else:
        conn.execute("DELETE FROM idea_fase_archivo WHERE idea_uid = ?", (uid,))
    for orden in (*plan.nuevas, *plan.reabiertas):
        conn.execute(
            "DELETE FROM idea_fase_archivo WHERE idea_uid = ? AND fase_orden = ?",
            (uid, orden),
        )
    for orden, orden_requisito in plan.requisitos_fuera:
        conn.execute(
            "DELETE FROM idea_fase_archivo"
            " WHERE idea_uid = ? AND fase_orden = ? AND requisito_orden = ?",
            (uid, orden, orden_requisito),
        )
    if anotacion is None:
        return
    if plan.eventos:
        _escribir_archivos(conn, uid, *plan.eventos[0], anotacion.cambios)
    _foto_guardar(conn, uid, anotacion.foto)
    if anotacion.saltados:
        registro.escribir(
            "aviso",
            f"Anotación de {uid} parada por el presupuesto de {PRESUPUESTO_MS} ms:"
            f" sin archivos en {_eventos_texto(anotacion.saltados)}",
        )
    podadas = _podar_parches(conn)
    if podadas:
        registro.escribir(
            "aviso",
            f"Parches sueltos de {uid}: {podadas} fases antiguas, tope de "
            f"{LIMITE_PARQUES // (1024 * 1024)} MiB por almacén",
        )
