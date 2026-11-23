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
from .modelo.estados import (
    REJECT_FIELDS,
    STATE_FIELDS,
    UPDATABLE,
    _actualizar_ficha_activa,
    _escribir_estado,
    _estado,
    _grupo,
    _validar_campos_ficha,
)
from .modelo.validacion import (
    _exige_fases,
    _exige_fases_completas,
    _exige_fases_listas,
    _protocolo_ok,
    _validar_aprobacion_total,
    _validar_fases_completadas,
    _validar_fases_en_lane,
)
from .trabajo.anotacion import (
    _aplicar_anotacion,
    _foto_guardar,
    _plan_de_eventos,
    _planificar_anotacion,
)
from .trabajo.fases import _escribir_fases, _fases, _normalizar_fases


def create_item(
    repo: str,
    *,
    title: str,
    description: str = "",
    content: str = "",
    kind: str = "idea",
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
        deps = _validar_dependencias(conn, uid, list(depende_de))
        _comprobar_dependencias(conn, uid, status, deps)
        datos = conn.execute(
            "INSERT INTO idea_data"
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
            "INSERT INTO idea_node (uid, estado, posicion, created_at, id, entered_at)"
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
    return get_item(repo, uid)


def update_item(repo: str, uid: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Actualiza solo los campos presentes. Los `None` no se escriben.

    El árbol se lee antes de abrir la transacción: la foto y el `git diff` de
    la anotación (0028) se calculan con la conexión todavía sin escribir, y el
    delta del PATCH se anota en el primer evento que trae (ver `anotacion.py`).
    Si el árbol falla, queda un aviso y la ficha se guarda igual.
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
    assignments = ", ".join(f"{column} = :{column}" for column in clean)
    with closing(connect(ensure_repo(repo))) as conn:
        # La ficha activa (y el destino, si cambia el estado) decide qué
        # campos de ficha tienen sentido; se comprueba antes de escribir.
        if conn.execute("SELECT 1 FROM idea_data WHERE uid = ?", (uid,)).fetchone() is None:
            raise KeyError(uid)
        actual = _estado(conn, uid)
        # Las fases se leen una vez: el mismo dato decide la validación, las
        # compuertas y los archivos que se anotan al cerrar (0028).
        fases_previas = _fases(conn, uid)
        destino = nuevo_estado or actual
        _validar_campos_ficha(detalle_ficha, destino)
        # Las dependencias se validan antes del UPDATE: se deduplican, tienen
        # que existir y no pueden cerrar un ciclo. La lista se guarda en JSON.
        deps_nuevas: list[str] | None = None
        if "depende_de" in clean:
            deps_nuevas = _validar_dependencias(conn, uid, list(clean["depende_de"]))
            clean["depende_de"] = json.dumps(deps_nuevas)
        # Un cambio de estado no es un UPDATE de la entrada: crea o retira la
        # fila de cola, de roadmap, de verificación, de revisión aprobada o
        # de descartada. Sin cambio (o reafirmando el mismo), se edita la
        # ficha activa.
        try:
            cambiado_estado = nuevo_estado is not None and nuevo_estado != actual
            # Los protocolos mandan sobre el flujo: una unión no listada
            # se rechaza (400) y no escribe nada.
            if cambiado_estado and not _protocolo_ok(conn, actual, nuevo_estado):
                raise InvalidInput(
                    f"el protocolo no permite el flujo {actual} → "
                    f"{nuevo_estado}: esa unión no está en `protocolo_flujo`"
                )
            if cambiado_estado:
                _comprobar_dependencias(conn, uid, nuevo_estado, deps_nuevas)
            # Las fases se reemplazan enteras y se validan antes de escribir
            # nada: el gate mira lo que quedará, no lo que había.
            fases_finales = (
                _normalizar_fases(fases_pedidas, fases_previas)
                if fases_pedidas is not None
                else None
            )
            if fases_finales is not None:
                _validar_fases_en_lane(destino, fases_finales)
                _validar_fases_completadas(fases_finales)
            # El gate mira la lista que quedará: la que llega en este PATCH o,
            # si no hay, la que ya tiene el ítem.
            fases_quedan = (
                (fases_finales if fases_finales is not None else fases_previas)
                if cambiado_estado
                else []
            )
            if cambiado_estado and _exige_fases(conn, actual, nuevo_estado) and not fases_quedan:
                raise InvalidInput(
                    f"el protocolo exige al menos una fase para pasar a {nuevo_estado}"
                )
            if cambiado_estado and _exige_fases_listas(conn, actual, nuevo_estado):
                abiertas = [
                    fase["titulo"]
                    for fase in fases_quedan
                    if fase["estado"] in ("pendiente", "fallida")
                ]
                if abiertas:
                    raise InvalidInput(
                        f"no puede pasar a {nuevo_estado}: quedan fases sin cerrar: "
                        + ", ".join(abiertas)
                    )
            if cambiado_estado and _exige_fases_completas(conn, actual, nuevo_estado):
                incompletas = [
                    fase["titulo"] for fase in fases_quedan if fase["estado"] != "completada"
                ]
                if incompletas:
                    raise InvalidInput(
                        f"no puede pasar a {nuevo_estado}: hay fases sin completar: "
                        + ", ".join(incompletas)
                    )
            if cambiado_estado and _grupo(nuevo_estado) in ("revision_aprobada", "historial"):
                _validar_aprobacion_total(fases_quedan)
            # El árbol se lee aquí, con la transacción todavía sin abrir: el
            # lock de escritura no cubre el recorrido ni el `git diff`, y un
            # PATCH con varias fases hace uno de cada.
            plan_archivos = _plan_de_eventos(
                fases_previas,
                fases_finales if fases_finales is not None else fases_previas,
                inicio=cambiado_estado and _grupo(str(nuevo_estado)) == "roadmap",
            )
            anotacion = _planificar_anotacion(conn, repo, uid, plan_archivos)
            cursor = conn.execute(
                f"UPDATE idea_data SET {assignments} WHERE uid = :uid",
                {**clean, "uid": uid},
            )
            if cursor.rowcount == 0:
                raise KeyError(uid)
            if cambiado_estado:
                _escribir_estado(conn, uid, nuevo_estado, detalle_ficha)
                # Aprobar archiva: la firma se queda en `revision_node` y la
                # item pasa a `historial` en la misma transacción. El carril
                # aprobado es la compuerta, no un sitio donde esperar.
                if nuevo_estado == "revision_aprobada":
                    conn.execute(
                        "UPDATE idea_node SET estado = 'historial', posicion = NULL WHERE uid = ?",
                        (uid,),
                    )
            else:
                _actualizar_ficha_activa(conn, uid, actual, detalle_ficha)
            if fases_finales is not None:
                _escribir_fases(conn, uid, fases_finales)
            # Ya con las fases escritas, se aplica lo que se planificó antes
            # del BEGIN: el delta del PATCH se anota en el primer evento.
            _aplicar_anotacion(conn, uid, plan_archivos, anotacion)
            item = _row(
                conn,
                conn.execute(
                    f"SELECT {_COLUMNAS} FROM idea_data"
                    " JOIN idea_node ON idea_node.uid = idea_data.uid"
                    " WHERE idea_data.uid = ?",
                    (uid,),
                ).fetchone(),
            )
            _emitir(
                conn,
                "item.status" if cambiado_estado else "item.updated",
                {"uid": uid, "title": item["title"], "status": item["status"]},
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            # `superseded_by_uid` apunta a un ítem que no existe: es un dato
            # mal puesto (400), no un fallo del servidor (500).
            raise InvalidInput("superseded_by_uid apunta a un ítem que no existe") from exc
    return item


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
            "SELECT idea_data.title, idea_node.estado"
            " FROM idea_data JOIN idea_node ON idea_node.uid = idea_data.uid"
            " WHERE idea_data.uid = ?",
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
            cursor = conn.execute("DELETE FROM idea_data WHERE uid = ?", (uid,))
        except sqlite3.IntegrityError as exc:
            # Otra ficha pudo enlazarla entre la comprobación y el borrado.
            raise InvalidInput(
                f"no se puede borrar {uid}: otra ficha la referencia en `superseded_by_uid`"
            ) from exc
        if cursor.rowcount > 0:
            # `depende_de` es una lista JSON, sin FK que la limpie: se retira
            # el uid de las listas ajenas para que nadie quede bloqueado por
            # un ítem que ya no existe.
            for fila in conn.execute("SELECT uid, depende_de FROM idea_data").fetchall():
                deps = _tags_json(fila[1])
                if uid in deps:
                    conn.execute(
                        "UPDATE idea_data SET depende_de = ? WHERE uid = ?",
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
        n_items = contar(conn, "idea_data")
        n_eventos = contar(conn, "event")
        # Borrar los ítems arrastra nodo y detalle por CASCADE; los eventos no
        # cuelgan de nada, se borran aparte.
        if n_eventos:
            conn.execute("DELETE FROM event")
        conn.execute("DELETE FROM idea_data")
        conn.commit()
    return {
        "repo": repo,
        "ideas_eliminadas": n_items,
        "eventos_eliminados": n_eventos,
    }
