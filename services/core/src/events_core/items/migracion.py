"""Aplicar un plan de migración: un lote, una transacción, una procedencia."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from .base.comun import (
    InvalidInput,
    _emitir,
    _tags_json,
    escribir_atomico,
    fecha_iso,
    now_iso,
)
from .base.esquema import connect, ensure_repo
from .base.rutas import db_file_for
from .modelo.dependencias import _validar_dependencias
from .modelo.estados import _escribir_estado
from .trabajo.fases import _escribir_fases, _normalizar_fases


def aplicar_migracion(repo: str, plan: dict[str, Any], *, plan_sha256: str) -> dict[str, Any]:
    """Crea todos los ítems del plan o ninguna.

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
        items = plan["items"] if "items" in plan else plan["ideas"]
        # Los uids se reparten antes de insertar: las dependencias entre items
        # del mismo lote se resuelven sin depender del orden de escritura.
        uids = {item["ref"]: uuid.uuid4().hex for item in items}

        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "INSERT INTO migracion_lote (id, plan_sha256, creado_at, ideas)"
                " VALUES (?, ?, ?, ?)",
                (lote, plan_sha256, ts, len(items)),
            )
            for item in items:
                uid = uids[item["ref"]]
                _insertar_item(conn, item, uid, ts)
                _anotar_origen(conn, lote, item, uid, ts)
                _emitir(conn, "item.created", {"uid": uid, "title": item["title"]})

            # Segunda pasada: todos los ítems ya existen, así que `depende_de`
            # se puede resolver y validar (existencia y ciclos) como siempre.
            for item in items:
                enlaces = [uids[ref] for ref in item.get("depende_de") or []]
                if not enlaces:
                    continue
                uid = uids[item["ref"]]
                enlaces = _validar_dependencias(conn, uid, enlaces)
                conn.execute(
                    "UPDATE work_item_data SET depende_de = ? WHERE uid = ?",
                    (json.dumps(enlaces), uid),
                )

            _emitir(
                conn,
                "migracion.aplicada",
                {"lote": lote, "plan_sha256": plan_sha256, "items": len(items)},
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


def _insertar_item(conn: sqlite3.Connection, item: dict[str, Any], uid: str, ts: str) -> None:
    """La item nace en su carril, con sus fases pendientes y sin dependencias.

    `historial` y `rejected` no llevan fases; `rejected` guarda el motivo y la
    autoría del sistema. La fecha del plan se convierte en la entrada del nodo:
    así `revision_approved_at`/`rejected_at` conservan la fecha histórica y no
    la de importación. La firma del historial también es del sistema, para no
    confundir un archivo con una aprobación humana.
    """
    estado = str(item.get("status") or "proposed")
    datos = conn.execute(
        "INSERT INTO work_item_data"
        " (uid, title, description, content, kind, tags, depende_de, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, 'work_item', ?, '[]', ?, ?)",
        (
            uid,
            item["title"],
            item.get("description") or "",
            item.get("content") or "",
            json.dumps(list(item.get("tags") or [])),
            ts,
            ts,
        ),
    )
    # Igual que `create_item`: el nodo nace en la entrada y `_escribir_estado`
    # lo lleva al carril pedido en la misma transacción. La fecha y el `id` van
    # copiados al nodo (0033), que es lo que ordena el listado.
    conn.execute(
        "INSERT INTO work_item_node (uid, estado, posicion, created_at, id, entered_at)"
        " VALUES (?, 'draft', NULL, ?, ?, ?)",
        (uid, ts, datos.lastrowid, ts),
    )
    detalle: dict[str, Any] = {}
    if estado == "rejected":
        detalle = {
            "rejected_description": item.get("motivo") or "",
            "rejected_by": "sistema",
        }
    _escribir_estado(conn, uid, estado, detalle)
    if estado in ("historial", "rejected"):
        fecha = fecha_iso(item.get("fecha"), ts)
        conn.execute("UPDATE work_item_node SET entered_at = ? WHERE uid = ?", (fecha, uid))
        if estado == "historial":
            conn.execute(
                "INSERT INTO revision_node (uid, approved_by, nota) VALUES (?, 'sistema', ?)",
                (uid, f"Importado de {item['origen']['ruta']}"),
            )
    fases = item.get("fases") or []
    if fases:
        _escribir_fases(conn, uid, _normalizar_fases(fases, []))


def _anotar_origen(
    conn: sqlite3.Connection, lote: str, item: dict[str, Any], uid: str, ts: str
) -> None:
    """La procedencia: de qué fichero, líneas y hash salió este ítem."""
    origen = item["origen"]
    conn.execute(
        "INSERT INTO migracion_item"
        " (lote_id, work_item_uid, ref, ruta, desde_linea, hasta_linea, sha256, creada_at, estado)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            lote,
            uid,
            item["ref"],
            origen["ruta"],
            origen["desde_linea"],
            origen["hasta_linea"],
            origen["sha256"],
            ts,
            item.get("status") or "proposed",
        ),
    )


class MigracionEnConflicto(Exception):
    """El lote ya no está como lo dejó el apply: no se deshace nada."""

    def __init__(self, lote: str, conflictos: list[str]) -> None:
        self.lote = lote
        self.conflictos = conflictos
        super().__init__(f"no se puede deshacer el lote {lote}: " + "; ".join(conflictos))


MANIFIESTO_ABSORCION = "absorcion.json"


def _directorio_absorcion(repo: str, lote: str) -> Path:
    return db_file_for(repo).parent / "migracion" / lote


def leer_absorcion(repo: str, lote: str) -> dict[str, Any] | None:
    """El manifiesto de un lote absorbido, o `None` si no se absorbió.

    El manifiesto vive junto a la copia, dentro de `.EUI/migracion/<lote>/`,
    y no en SQLite: la copia tiene que poder restaurarse aunque el almacén se
    haya perdido. Es el contrato entre `absorb --confirmar` y `undo`.
    """
    ruta = _directorio_absorcion(repo, lote) / MANIFIESTO_ABSORCION
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise InvalidInput(f"no se pudo leer el manifiesto de absorción {ruta}: {exc}") from exc
    if not isinstance(datos, dict) or not isinstance(datos.get("archivos"), list):
        raise InvalidInput(f"manifiesto de absorción inválido: {ruta}")
    return datos


def escribir_absorcion(repo: str, lote: str, datos: dict[str, Any]) -> Path:
    """Guarda el manifiesto de forma atómica junto a la copia."""
    ruta = _directorio_absorcion(repo, lote) / MANIFIESTO_ABSORCION
    escribir_atomico(
        ruta,
        (json.dumps(datos, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    return ruta


def _ruta_en_repo(raiz: Path, ruta: str) -> Path:
    destino = (raiz / ruta).resolve()
    if not destino.is_relative_to(raiz):
        raise InvalidInput(f"ruta fuera del repo: {ruta!r}")
    return destino


def _sha256(archivo: Path) -> str:
    return hashlib.sha256(archivo.read_bytes()).hexdigest()


def restaurar_absorcion(repo: str, lote: str) -> dict[str, Any] | None:
    """Devuelve los documentos a su sitio desde la copia del lote.

    Se valida todo antes de escribir: si un original cambió, falta una copia o
    el documento ya no está como lo dejó la absorción, no se restaura ninguno y
    `undo` devuelve el conflicto. Repetir la restauración es seguro: un
    documento que ya coincide con su copia se salta.
    """
    manifiesto = leer_absorcion(repo, lote)
    if manifiesto is None:
        return None
    raiz = Path(repo).resolve()
    pendientes: list[tuple[Path, bytes]] = []
    conflictos: list[str] = []
    for archivo in manifiesto["archivos"]:
        ruta = str(archivo.get("ruta") or "")
        copia_rel = str(archivo.get("copia") or "")
        try:
            fuente = _ruta_en_repo(raiz, ruta)
            copia = _ruta_en_repo(raiz, copia_rel)
        except InvalidInput as exc:
            conflictos.append(str(exc))
            continue
        if not copia.is_file():
            conflictos.append(f"{ruta}: falta la copia {copia_rel}")
            continue
        sha_copia = str(archivo.get("sha256_copia") or "")
        if _sha256(copia) != sha_copia:
            conflictos.append(f"{ruta}: la copia cambió (sha256 no cuadra)")
            continue
        crudo = copia.read_bytes()
        if fuente.is_file():
            actual = _sha256(fuente)
            if actual == sha_copia:
                continue
            # Compatibilidad con manifiestos antiguos que dejaron un stub:
            # si el origen sigue teniendo exactamente ese stub, se restaura.
            sha_stub = archivo.get("sha256_stub")
            if not sha_stub or actual != str(sha_stub):
                conflictos.append(f"{ruta}: el documento cambió después de absorberlo")
                continue
        pendientes.append((fuente, crudo))

    if conflictos:
        raise MigracionEnConflicto(lote, conflictos)

    for fuente, crudo in pendientes:
        escribir_atomico(fuente, crudo)
    manifiesto["estado"] = "restaurado"
    escribir_absorcion(repo, lote, manifiesto)
    return {"documentos": [str(archivo["ruta"]) for archivo in manifiesto["archivos"]]}


def _limpiar_absorcion(repo: str, lote: str) -> None:
    """Retira copia y manifiesto una vez que la base ya no tiene el lote."""
    shutil.rmtree(_directorio_absorcion(repo, lote), ignore_errors=True)


def deshacer_migracion(repo: str, lote: str) -> dict[str, Any]:
    """Borra solo los ítems que creó el lote, si nadie las tocó después.

    Se niega entero (409) si algun ítem cambió de carril, se editó después de
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
            "SELECT ref, work_item_uid, creada_at, estado FROM migracion_item"
            " WHERE lote_id = ? ORDER BY rowid",
            (lote,),
        ).fetchall()
        uids = [str(fila["work_item_uid"]) for fila in filas]

        conn.execute("BEGIN IMMEDIATE")
        try:
            titulos: dict[str, str] = {}
            conflictos: list[str] = []
            for fila in filas:
                uid = str(fila["work_item_uid"])
                item = conn.execute(
                    "SELECT work_item_data.title, work_item_data.updated_at,"
                    " work_item_node.estado"
                    " FROM work_item_data"
                    " JOIN work_item_node ON work_item_node.uid = work_item_data.uid"
                    " WHERE work_item_data.uid = ?",
                    (uid,),
                ).fetchone()
                if item is None:
                    continue
                titulos[uid] = str(item["title"])
                estado = str(item["estado"])
                esperado = str(fila["estado"] or "proposed")
                if estado != esperado:
                    conflictos.append(
                        f"{fila['ref']} ({item['title']}): está en {estado}, no en {esperado}"
                    )
                elif str(item["updated_at"]) != str(fila["creada_at"]):
                    conflictos.append(
                        f"{fila['ref']} ({item['title']}): se editó después de crearse"
                    )

            if uids:
                marcas = ",".join("?" for _ in uids)
                ajenas = conn.execute(
                    "SELECT rejected_node.uid, work_item_data.title FROM rejected_node"
                    " JOIN work_item_data ON work_item_data.uid = rejected_node.uid"
                    f" WHERE rejected_node.superseded_by_uid IN ({marcas})"
                    f" AND rejected_node.uid NOT IN ({marcas})",
                    (*uids, *uids),
                ).fetchall()
                conflictos.extend(
                    f"{fila[0]} ({fila[1]}): usa como sustituta un ítem del lote" for fila in ajenas
                )
            if conflictos:
                raise MigracionEnConflicto(lote, conflictos)

            # El documento vuelve antes de borrar los ítems: si el borrado
            # falla, el usuario conserva el Markdown y puede reintentar. El
            # manifiesto queda en `restaurado` para que el reintento no vuelva
            # a chocar con el estado del origen.
            restaurar_absorcion(repo, lote)

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
                conn.execute("DELETE FROM work_item_data WHERE uid = ?", (uid,))
                _emitir(conn, "item.deleted", {"uid": uid, "title": titulo})

            # Las listas `depende_de` de las supervivientes no pueden seguir
            # apuntando a uids que ya no existen (igual que `delete_item`).
            for superviviente in conn.execute(
                "SELECT uid, depende_de FROM work_item_data"
            ).fetchall():
                deps = _tags_json(superviviente["depende_de"])
                quedan = [dep for dep in deps if dep not in titulos]
                if quedan != deps:
                    conn.execute(
                        "UPDATE work_item_data SET depende_de = ? WHERE uid = ?",
                        (json.dumps(quedan), superviviente["uid"]),
                    )

            conn.execute("DELETE FROM migracion_lote WHERE id = ?", (lote,))
            _emitir(
                conn,
                "migracion.deshacer",
                {"lote": lote, "plan_sha256": plan_sha256, "items": len(titulos)},
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        _limpiar_absorcion(repo, lote)
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
        "SELECT ref, work_item_uid FROM migracion_item WHERE lote_id = ? ORDER BY rowid", (lote,)
    ).fetchall()
    return {
        "repo": repo,
        "lote": lote,
        "plan_sha256": plan_sha256,
        "repetido": repetido,
        "items": len(filas),
        "creadas": [{"ref": str(fila[0]), "uid": str(fila[1])} for fila in filas],
    }
