"""Escribir items: alta, edición, borrado y reinicio del almacén."""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterable
from contextlib import closing
from typing import Any

from .. import archivos, registro
from .base.comun import _COLUMNAS, InvalidInput, _emitir, _existe, _tags_json, now_iso
from .base.esquema import connect, ensure_repo
from .base.rutas import repos_root, resolve_repo
from .consulta import _row, get_item
from .modelo.dependencias import _comprobar_dependencias, _validar_dependencias
from .modelo.estados import _escribir_estado, _grupo
from .modelo.plan import _aplicar, _comprobar, _planificar
from .modelo.validacion import _validar_fases_completadas, _validar_fases_en_lane
from .trabajo.anotacion import _foto_guardar
from .trabajo.fases import _escribir_fases, _normalizar_fases


def _mensaje_integridad(exc: sqlite3.IntegrityError) -> str:
    """Traduce la restricción que saltó a un 400 que se entiende.

    Los índices parciales de `work_item_node` son la última red: con la
    transacción inmediata no deberían saltar, pero si saltan el mensaje tiene
    que decir qué pasó y no hablar de `superseded_by_uid`.
    """
    texto = str(exc)
    if "work_item_roadmap_unico" in texto:
        return "roadmap solo admite un item activo: ya hay uno en curso"
    if "work_item_cola_orden" in texto:
        return "la cola cambió mientras se guardaba el ítem: reintenta"
    return "superseded_by_uid apunta a un ítem que no existe"


def create_item(
    repo: str,
    *,
    title: str,
    description: str = "",
    content: str = "",
    kind: str = "work_item",
    status: str = "draft",
    tags: Iterable[str] = (),
    depende_de: Iterable[str] = (),
    fases: Iterable[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Las fases del alta se validan antes de tocar el almacén: si la lista no
    # vale, no se siembra el `.EUI` ni queda una ficha sin su desglose.
    fases_finales = _normalizar_fases(list(fases), []) if fases is not None else None
    if fases_finales is not None:
        _validar_fases_en_lane(status, fases_finales)
        _validar_fases_completadas(fases_finales)
    uid = uuid.uuid4().hex
    ts = now_iso()
    # El almacén se siembra antes de la foto: nace con su `.EUI` y su
    # `.gitignore`, y fotografiar antes los colaría como trabajo del primer
    # cierre. La foto se toma aquí, con la conexión de escritura todavía sin
    # abrir: el recorrido del árbol no tiene el lock tomado. Si el árbol falla,
    # se avisa y el ítem nace igual.
    db = ensure_repo(repo)
    foto_inicial: dict[str, tuple[int, int]] | None = None
    if _grupo(status) == "roadmap":
        try:
            foto_inicial = archivos.foto(resolve_repo(repo))
        except OSError as exc:
            # Sin foto, el primer cierre toma la primera y no anota lo que no
            # sabe: mejor eso que perder el alta.
            registro.escribir("aviso", f"No se pudo fotografiar el árbol de {uid}: {exc}")
    with closing(connect(db)) as conn:
        # Alta y comprobación del carril en una transacción inmediata: dos
        # altas a la vez no pueden leer el mismo `max(posicion)` ni el mismo
        # roadmap, ni validar dependencias contra un almacén que cambia.
        conn.execute("BEGIN IMMEDIATE")
        try:
            deps = _validar_dependencias(conn, uid, list(depende_de))
            _comprobar_dependencias(conn, uid, status, deps)
            datos = conn.execute(
                "INSERT INTO work_item_data"
                " (uid, title, description, content, kind, tags, depende_de,"
                " created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    uid,
                    title,
                    description,
                    content,
                    kind,
                    json.dumps(list(tags)),
                    json.dumps(deps),
                    ts,
                    ts,
                ),
            )
            # El nodo nace en la entrada y `_escribir_estado` lo mueve si el ítem
            # se creó ya en otro carril, en la misma transacción.
            # La fecha y el `id` se copian al nodo (0033): son el filtro y el orden
            # del listado, y ninguno cambia nunca, a diferencia de `entered_at`.
            conn.execute(
                "INSERT INTO work_item_node (uid, estado, posicion, created_at, id, entered_at)"
                " VALUES (?, 'draft', NULL, ?, ?, ?)",
                (uid, ts, datos.lastrowid, ts),
            )
            _escribir_estado(conn, uid, status, {})
            # Las fases entran en la misma transacción que el ítem: o nace completa
            # o no nace.
            if fases_finales is not None:
                _escribir_fases(conn, uid, fases_finales)
            # Nacer ya en roadmap también es entrar: sin foto de partida, la primera
            # fase anotaría como suyo todo el árbol que ya estaba. Se guarda aquí,
            # pero se tomó antes del BEGIN (ver `foto_inicial`).
            if foto_inicial is not None:
                _foto_guardar(conn, uid, foto_inicial)
            _emitir(conn, "item.created", {"uid": uid, "title": title})
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise InvalidInput(_mensaje_integridad(exc)) from exc
    return get_item(repo, uid)


def update_item(repo: str, uid: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Actualiza solo los campos presentes. Los `None` no se escriben.

    El árbol se lee antes de abrir la transacción: la foto y el `git diff` de
    la anotación (0028) se calculan con la conexión todavía sin escribir, y el
    delta del PATCH se anota en el primer evento que trae (ver `anotacion.py`).
    Si el árbol falla, queda un aviso y la ficha se guarda igual.

    El trabajo está repartido: `_planificar` decide qué escribir, qué comprobar
    y qué anotar; `_comprobar` pasa las compuertas con el lock tomado; `_aplicar`
    escribe. Aquí solo se abre la transacción y se emite el evento.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        plan = _planificar(conn, repo, uid, changes)
        # Comprobar y escribir, en la misma transacción inmediata: si no, dos
        # PATCH a la vez leen «no hay nadie en roadmap» los dos y el índice
        # único para al segundo con un error que no explica nada.
        conn.execute("BEGIN IMMEDIATE")
        try:
            _comprobar(conn, plan)
            _aplicar(conn, plan)
            item = _leer(conn, uid)
            _emitir(
                conn,
                "item.status" if plan.cambiado_estado else "item.updated",
                {"uid": uid, "title": item["title"], "status": item["status"]},
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            # El dato mal puesto es un 400, no un fallo del servidor (500). Con
            # la transacción inmediata los índices de roadmap y cola no
            # deberían saltar; si saltan, el mensaje dice cuál.
            raise InvalidInput(_mensaje_integridad(exc)) from exc
    return item


def _leer(conn: sqlite3.Connection, uid: str) -> dict[str, Any]:
    """La ficha tal y como queda: lo que devuelve el PATCH y lo que va al evento."""
    return _row(
        conn,
        conn.execute(
            f"SELECT {_COLUMNAS} FROM work_item_data"
            " JOIN work_item_node ON work_item_node.uid = work_item_data.uid"
            " WHERE work_item_data.uid = ?",
            (uid,),
        ).fetchone(),
    )


def delete_item(repo: str, uid: str) -> bool:
    """Borra el ítem; su nodo y el detalle se van con ella (ON DELETE CASCADE).

    Solo se acepta si está en Descartadas (`rejected`/`superseded`): el borrado
    definitivo no salta ese paso. El título se lee antes de borrar para que el
    evento `item.deleted` tenga qué mostrar: después no hay fila de la que
    sacar nada. Si otra ficha la usa como sustituta (`superseded_by_uid`), no
    se borra: el vínculo es información y se avisa del conflicto en vez de
    romperlo en silencio.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        fila = conn.execute(
            "SELECT work_item_data.title, work_item_node.estado"
            " FROM work_item_data JOIN work_item_node ON work_item_node.uid = work_item_data.uid"
            " WHERE work_item_data.uid = ?",
            (uid,),
        ).fetchone()
        if fila is None:
            return False
        estado = str(fila["estado"])
        if estado not in ("rejected", "superseded"):
            raise InvalidInput(
                f"no se puede borrar {uid}: primero descártala"
                f" (está en {estado}, no en Descartadas)"
            )
        titulo = str(fila["title"])
        sustitutas = [
            str(row[0])
            for row in conn.execute(
                "SELECT uid FROM rejected_node WHERE superseded_by_uid = ? ORDER BY uid",
                (uid,),
            )
        ]
        if sustitutas:
            raise InvalidInput(
                f"no se puede borrar {uid}: es la sustituta de {', '.join(sustitutas)};"
                " retira ese vínculo antes"
            )
        # El nodo y el detalle se borran con el ítem (ON DELETE CASCADE).
        try:
            cursor = conn.execute("DELETE FROM work_item_data WHERE uid = ?", (uid,))
        except sqlite3.IntegrityError as exc:
            # Otra ficha pudo enlazarla entre la comprobación y el borrado.
            raise InvalidInput(
                f"no se puede borrar {uid}: otra ficha la referencia en `superseded_by_uid`"
            ) from exc
        if cursor.rowcount > 0:
            # `depende_de` es una lista JSON, sin FK que la limpie: se retira
            # el uid de las listas ajenas para que nadie quede bloqueado por
            # un ítem que ya no existe.
            for fila in conn.execute("SELECT uid, depende_de FROM work_item_data").fetchall():
                deps = _tags_json(fila[1])
                if uid in deps:
                    conn.execute(
                        "UPDATE work_item_data SET depende_de = ? WHERE uid = ?",
                        (json.dumps([otra for otra in deps if otra != uid]), fila[0]),
                    )
            _emitir(conn, "item.deleted", {"uid": uid, "title": titulo})
        conn.commit()
    return cursor.rowcount > 0


def reiniciar(repo: str) -> dict[str, Any]:
    """Vacía el almacén de items, cola, fichas y eventos (LAB).

    Solo lo usa el lanzador de pruebas (`puedeProbar`) para volver a un estado
    de proyecto limpio tras una prueba: no es parte del CRUD de producto. La
    estructura (tablas, `user_version`) no cambia: la misma BD, vacía.
    """
    if resolve_repo(repo).parent != repos_root():
        raise InvalidInput("el reinicio solo está disponible en repositorios del laboratorio")
    db_file = ensure_repo(repo)

    def contar(conn: sqlite3.Connection, tabla: str) -> int:
        if not _existe(conn, tabla):
            return 0
        return conn.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0]

    with closing(connect(db_file)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        n_items = contar(conn, "work_item_data")
        n_eventos = contar(conn, "event")
        # Borrar los ítems arrastra nodo y detalle por CASCADE; los eventos no
        # cuelgan de nada, se borran aparte.
        if n_eventos:
            conn.execute("DELETE FROM event")
        conn.execute("DELETE FROM work_item_data")
        conn.commit()
    return {
        "repo": repo,
        "items_eliminadas": n_items,
        "eventos_eliminados": n_eventos,
    }
