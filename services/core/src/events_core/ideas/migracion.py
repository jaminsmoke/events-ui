"""Aplicar un plan de migración: un lote, una transacción, una procedencia."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing
from typing import Any

from .base.comun import _emitir, _tags_json, now_iso
from .base.esquema import connect, ensure_repo
from .modelo.dependencias import _validar_dependencias
from .modelo.estados import _escribir_estado
from .trabajo.fases import _escribir_fases, _normalizar_fases


def aplicar_migracion(repo: str, plan: dict[str, Any], *, plan_sha256: str) -> dict[str, Any]:
    """Crea todas las ideas del plan o ninguna.

    El plan ya viene validado por `events_core.migracion.revisar` (esquema,
    refs, ciclos y orígenes), pero aquí se vuelve a comprobar lo que toca a la
    base: las dependencias se resuelven de `ref` a `uid` dentro del lote y se
    validan como cualquier otra. La huella del plan identifica el lote, así que
    repetir el mismo `apply` devuelve el mismo lote y no duplica nada.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        existente = _lote_por_huella(conn, plan_sha256)
        if existente is not None:
            return _respuesta(conn, repo, existente, plan_sha256, repetido=True)

        lote = uuid.uuid4().hex
        ts = now_iso()
        ideas = plan["ideas"]
        # Los uids se reparten antes de insertar: las dependencias entre ideas
        # del mismo lote se resuelven sin depender del orden de escritura.
        uids = {idea["ref"]: uuid.uuid4().hex for idea in ideas}

        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "INSERT INTO migracion_lote (id, plan_sha256, creado_at, ideas)"
                " VALUES (?, ?, ?, ?)",
                (lote, plan_sha256, ts, len(ideas)),
            )
            for idea in ideas:
                uid = uids[idea["ref"]]
                _insertar_idea(conn, idea, uid, ts)
                _anotar_origen(conn, lote, idea, uid, ts)
                _emitir(conn, "idea.created", {"uid": uid, "title": idea["title"]})

            # Segunda pasada: todas las ideas ya existen, así que `depende_de`
            # se puede resolver y validar (existencia y ciclos) como siempre.
            for idea in ideas:
                enlaces = [uids[ref] for ref in idea.get("depende_de") or []]
                if not enlaces:
                    continue
                uid = uids[idea["ref"]]
                enlaces = _validar_dependencias(conn, uid, enlaces)
                conn.execute(
                    "UPDATE idea_data SET depende_de = ? WHERE uid = ?",
                    (json.dumps(enlaces), uid),
                )

            _emitir(
                conn,
                "migracion.aplicada",
                {"lote": lote, "plan_sha256": plan_sha256, "ideas": len(ideas)},
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Otra petición aplicó la misma huella entre la comprobación y el
            # INSERT: no es un error, el lote ya está hecho.
            conn.rollback()
            existente = _lote_por_huella(conn, plan_sha256)
            if existente is None:
                raise
            return _respuesta(conn, repo, existente, plan_sha256, repetido=True)
        except Exception:
            conn.rollback()
            raise

        return _respuesta(conn, repo, lote, plan_sha256, repetido=False)


def _insertar_idea(conn: sqlite3.Connection, idea: dict[str, Any], uid: str, ts: str) -> None:
    """La idea nace en la cola, con sus fases pendientes y sin dependencias aún."""
    conn.execute(
        "INSERT INTO idea_data"
        " (uid, title, description, content, kind, tags, depende_de, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, 'idea', ?, '[]', ?, ?)",
        (
            uid,
            idea["title"],
            idea.get("description") or "",
            idea.get("content") or "",
            json.dumps(list(idea.get("tags") or [])),
            ts,
            ts,
        ),
    )
    # Igual que `create_idea`: el nodo nace en la entrada y `_escribir_estado`
    # lo lleva a la cola en la misma transacción, con su posición al final.
    conn.execute(
        "INSERT INTO idea_node (uid, estado, posicion, entered_at) VALUES (?, 'draft', NULL, ?)",
        (uid, ts),
    )
    _escribir_estado(conn, uid, "proposed", {})
    fases = idea.get("fases") or []
    if fases:
        _escribir_fases(conn, uid, _normalizar_fases(fases, []))


def _anotar_origen(
    conn: sqlite3.Connection, lote: str, idea: dict[str, Any], uid: str, ts: str
) -> None:
    """La procedencia: de qué fichero, líneas y hash salió esta idea."""
    origen = idea["origen"]
    conn.execute(
        "INSERT INTO migracion_idea"
        " (lote_id, idea_uid, ref, ruta, desde_linea, hasta_linea, sha256, creada_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            lote,
            uid,
            idea["ref"],
            origen["ruta"],
            origen["desde_linea"],
            origen["hasta_linea"],
            origen["sha256"],
            ts,
        ),
    )


class MigracionEnConflicto(Exception):
    """El lote ya no está como lo dejó el apply: no se deshace nada."""

    def __init__(self, lote: str, conflictos: list[str]) -> None:
        self.lote = lote
        self.conflictos = conflictos
        super().__init__(f"no se puede deshacer el lote {lote}: " + "; ".join(conflictos))


def deshacer_migracion(repo: str, lote: str) -> dict[str, Any]:
    """Borra solo las ideas que creó el lote, si nadie las tocó después.

    Se niega entero (409) si alguna idea cambió de carril, se editó después de
    crearse o una ficha ajena la usa como sustituta: borrar media migración deja
    el repo peor que no deshacerla. Las que el usuario ya borró a mano no son un
    conflicto: se cuentan como ausentes y el resto se deshace igual.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        fila = conn.execute(
            "SELECT plan_sha256, ideas FROM migracion_lote WHERE id = ?", (lote,)
        ).fetchone()
        if fila is None:
            raise KeyError(lote)
        plan_sha256 = str(fila["plan_sha256"])
        total = int(fila["ideas"])
        filas = conn.execute(
            "SELECT ref, idea_uid, creada_at FROM migracion_idea WHERE lote_id = ? ORDER BY rowid",
            (lote,),
        ).fetchall()
        uids = [str(fila["idea_uid"]) for fila in filas]

        conn.execute("BEGIN IMMEDIATE")
        try:
            titulos: dict[str, str] = {}
            conflictos: list[str] = []
            for fila in filas:
                uid = str(fila["idea_uid"])
                idea = conn.execute(
                    "SELECT idea_data.title, idea_data.updated_at, idea_node.estado"
                    " FROM idea_data JOIN idea_node ON idea_node.uid = idea_data.uid"
                    " WHERE idea_data.uid = ?",
                    (uid,),
                ).fetchone()
                if idea is None:
                    continue
                titulos[uid] = str(idea["title"])
                estado = str(idea["estado"])
                if estado != "proposed":
                    conflictos.append(
                        f"{fila['ref']} ({idea['title']}): está en {estado}, no en proposed"
                    )
                elif str(idea["updated_at"]) != str(fila["creada_at"]):
                    conflictos.append(
                        f"{fila['ref']} ({idea['title']}): se editó después de crearse"
                    )

            if uids:
                marcas = ",".join("?" for _ in uids)
                ajenas = conn.execute(
                    "SELECT rejected_node.uid, idea_data.title FROM rejected_node"
                    " JOIN idea_data ON idea_data.uid = rejected_node.uid"
                    f" WHERE rejected_node.superseded_by_uid IN ({marcas})"
                    f" AND rejected_node.uid NOT IN ({marcas})",
                    (*uids, *uids),
                ).fetchall()
                conflictos.extend(
                    f"{fila[0]} ({fila[1]}): usa como sustituta una idea del lote"
                    for fila in ajenas
                )
            if conflictos:
                raise MigracionEnConflicto(lote, conflictos)

            if uids:
                marcas = ",".join("?" for _ in uids)
                # Las sustitutas dentro del lote se van juntas: soltar el
                # vínculo antes evita que la FK pare el primer DELETE.
                conn.execute(
                    "UPDATE rejected_node SET superseded_by_uid = NULL"
                    f" WHERE uid IN ({marcas}) AND superseded_by_uid IN ({marcas})",
                    (*uids, *uids),
                )
            for uid, titulo in titulos.items():
                conn.execute("DELETE FROM idea_data WHERE uid = ?", (uid,))
                _emitir(conn, "idea.deleted", {"uid": uid, "title": titulo})

            # Las listas `depende_de` de las supervivientes no pueden seguir
            # apuntando a uids que ya no existen (igual que `delete_idea`).
            for superviviente in conn.execute("SELECT uid, depende_de FROM idea_data").fetchall():
                deps = _tags_json(superviviente["depende_de"])
                quedan = [dep for dep in deps if dep not in titulos]
                if quedan != deps:
                    conn.execute(
                        "UPDATE idea_data SET depende_de = ? WHERE uid = ?",
                        (json.dumps(quedan), superviviente["uid"]),
                    )

            conn.execute("DELETE FROM migracion_lote WHERE id = ?", (lote,))
            _emitir(
                conn,
                "migracion.deshacer",
                {"lote": lote, "plan_sha256": plan_sha256, "ideas": len(titulos)},
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        return {
            "repo": repo,
            "lote": lote,
            "plan_sha256": plan_sha256,
            "borradas": len(titulos),
            "ausentes": total - len(titulos),
        }


def _lote_por_huella(conn: sqlite3.Connection, plan_sha256: str) -> str | None:
    fila = conn.execute(
        "SELECT id FROM migracion_lote WHERE plan_sha256 = ?", (plan_sha256,)
    ).fetchone()
    return str(fila[0]) if fila else None


def _respuesta(
    conn: sqlite3.Connection, repo: str, lote: str, plan_sha256: str, *, repetido: bool
) -> dict[str, Any]:
    filas = conn.execute(
        "SELECT ref, idea_uid FROM migracion_idea WHERE lote_id = ? ORDER BY rowid", (lote,)
    ).fetchall()
    return {
        "repo": repo,
        "lote": lote,
        "plan_sha256": plan_sha256,
        "repetido": repetido,
        "ideas": len(filas),
        "creadas": [{"ref": str(fila[0]), "uid": str(fila[1])} for fila in filas],
    }
