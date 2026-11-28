"""Absorber un lote: qué Markdown cambia y cómo queda el repo."""

from __future__ import annotations

import hashlib
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from ..db import open_read_only
from ..items.base.comun import InvalidInput
from ..items.base.rutas import EUI_DIR, db_file_for
from .documentos import MAX_HUECOS
from .marcadores import _bloques_markdown, _fusionar, _marcadores_del_lote, _solapamientos


def revisar_absorcion(raiz: Path, lote: str, *, parcial: bool = False) -> dict[str, Any]:
    """Informe seco para absorber un lote: no escribe ni borra nada.

    La cobertura se calcula **por fichero**, no solo por el lote: un ROADMAP
    puede haberse importado en varias tandas y la absorción total tiene que
    contar todas. Cada viñeta de nivel superior fuera de bloques de código es
    un bloque; las anidadas van con su padre. Se compara además el hash actual
    con el que guardó la procedencia: si el fichero cambió, el informe no es
    seguro y no se propone retirar nada.

    Con `parcial=True` (nunca el valor por defecto) se permiten huecos: solo
    se planea sustituir los rangos del lote por marcadores visibles con uid,
    y los rangos no pueden solaparse. Si no queda ningún hueco, hay que usar
    la absorción total.
    """
    raiz = raiz.resolve()
    db_file = db_file_for(str(raiz))
    try:
        conn = open_read_only(db_file)
    except FileNotFoundError as exc:
        raise KeyError(lote) from exc

    with closing(conn):
        try:
            cabecera = conn.execute(
                "SELECT plan_sha256 FROM migracion_lote WHERE id = ?", (lote,)
            ).fetchone()
        except sqlite3.OperationalError as exc:
            raise InvalidInput("el almacén no tiene lotes de migración") from exc
        if cabecera is None:
            raise KeyError(lote)

        filas = conn.execute(
            "SELECT mi.work_item_uid, mi.ruta, mi.desde_linea, mi.hasta_linea, mi.sha256,"
            " mi.estado, mi.lote_id, work_item_data.title"
            " FROM migracion_item mi"
            " JOIN work_item_data ON work_item_data.uid = mi.work_item_uid"
            " WHERE mi.lote_id = ?"
            " ORDER BY mi.ruta, mi.desde_linea, mi.hasta_linea",
            (lote,),
        ).fetchall()
        if not filas:
            return _informe_absorcion_vacio(
                raiz,
                lote,
                str(cabecera["plan_sha256"]),
                "el lote no tiene items",
                parcial=parcial,
            )

        por_ruta: dict[str, list[dict[str, Any]]] = {}
        for fila in filas:
            por_ruta.setdefault(str(fila["ruta"]), []).append(dict(fila))

        marcas = ",".join("?" for _ in por_ruta)
        todas = conn.execute(
            "SELECT mi.work_item_uid, mi.ruta, mi.desde_linea, mi.hasta_linea, mi.sha256,"
            " mi.estado, mi.lote_id, work_item_data.title"
            " FROM migracion_item mi"
            " JOIN work_item_data ON work_item_data.uid = mi.work_item_uid"
            f" WHERE mi.ruta IN ({marcas})"
            " ORDER BY mi.ruta, mi.desde_linea, mi.hasta_linea",
            tuple(por_ruta),
        ).fetchall()

        todas_por_ruta: dict[str, list[dict[str, Any]]] = {}
        for fila in todas:
            todas_por_ruta.setdefault(str(fila["ruta"]), []).append(dict(fila))

        archivos = [
            _informe_archivo(
                raiz,
                lote,
                ruta,
                por_ruta[ruta],
                todas_por_ruta[ruta],
                parcial=parcial,
            )
            for ruta in sorted(por_ruta)
        ]

    errores = [error for archivo in archivos for error in archivo["errores"]]
    avisos = [aviso for archivo in archivos for aviso in archivo["avisos"]]
    huecos = [hueco for archivo in archivos for hueco in archivo["sin_migrar"]]
    marcadores = [marcador for archivo in archivos for marcador in archivo.get("marcadores", [])]
    if parcial:
        ok = bool(archivos) and not errores and bool(marcadores)
    else:
        ok = bool(archivos) and not errores and not huecos
    resumen = {
        "archivos": len(archivos),
        "items_lote": len({str(fila["work_item_uid"]) for fila in filas}),
        "items_fichero": sum(archivo["items_fichero"] for archivo in archivos),
        "bloques": sum(archivo["bloques"] for archivo in archivos),
        "cubiertos": sum(archivo["cubiertos"] for archivo in archivos),
        "sin_migrar": len(huecos),
        "marcadores": len(marcadores),
    }
    return {
        "repo": str(raiz),
        "lote": lote,
        "plan_sha256": str(cabecera["plan_sha256"]),
        "dry_run": True,
        "modo": "parcial" if parcial else "total",
        "ok": ok,
        "archivos": archivos,
        "retirar": [archivo["ruta"] for archivo in archivos] if ok and not parcial else [],
        "reescribir": [archivo["ruta"] for archivo in archivos] if ok and parcial else [],
        "marcadores": marcadores if ok and parcial else [],
        "errores": errores,
        "avisos": avisos,
        "resumen": resumen,
    }


def _informe_absorcion_vacio(
    raiz: Path,
    lote: str,
    plan_sha256: str,
    error: str,
    *,
    parcial: bool = False,
) -> dict[str, Any]:
    return {
        "repo": str(raiz),
        "lote": lote,
        "plan_sha256": plan_sha256,
        "dry_run": True,
        "modo": "parcial" if parcial else "total",
        "ok": False,
        "archivos": [],
        "retirar": [],
        "reescribir": [],
        "marcadores": [],
        "errores": [error],
        "avisos": [],
        "resumen": {
            "archivos": 0,
            "items_lote": 0,
            "items_fichero": 0,
            "bloques": 0,
            "cubiertos": 0,
            "sin_migrar": 0,
            "marcadores": 0,
        },
    }


def _informe_archivo(
    raiz: Path,
    lote: str,
    ruta: str,
    filas_lote: list[dict[str, Any]],
    filas_todas: list[dict[str, Any]],
    *,
    parcial: bool = False,
) -> dict[str, Any]:
    """Cobertura y plan de copia y retirada/reescritura de un fichero."""
    errores: list[str] = []
    avisos: list[str] = []
    relativa = Path(ruta)
    items_lote = len({str(fila["work_item_uid"]) for fila in filas_lote})
    items_fichero = len({str(fila["work_item_uid"]) for fila in filas_todas})
    lotes = sorted({str(fila["lote_id"]) for fila in filas_todas})
    carriles: dict[str, int] = {}
    for fila in filas_lote:
        estado = str(fila["estado"])
        carriles[estado] = carriles.get(estado, 0) + 1

    informe: dict[str, Any] = {
        "ruta": ruta,
        "items_lote": items_lote,
        "items_fichero": items_fichero,
        "lotes": lotes,
        "carriles": carriles,
        "sha256": sorted({str(fila["sha256"]) for fila in filas_lote}),
        "hash_actual": "",
        "hash_ok": False,
        "bloques": 0,
        "cubiertos": 0,
        "sin_migrar": [],
        "recortado": False,
        "rangos": [],
        "solapamientos": [],
        "marcadores": [],
        "copia": None,
        "errores": errores,
        "avisos": avisos,
    }

    if relativa.is_absolute() or not relativa.parts or ".." in relativa.parts:
        errores.append(f"{ruta}: ruta de origen fuera del repo")
        return informe

    archivo = (raiz / relativa).resolve()
    if not archivo.is_relative_to(raiz):
        errores.append(f"{ruta}: ruta de origen fuera del repo")
        return informe
    if not archivo.is_file():
        errores.append(f"{ruta}: no existe el fichero de origen")
        return informe

    try:
        crudo = archivo.read_bytes()
    except OSError as exc:
        errores.append(f"{ruta}: no se pudo leer: {exc}")
        return informe

    sha_actual = hashlib.sha256(crudo).hexdigest()
    informe["hash_actual"] = sha_actual
    hashes_lote = {str(fila["sha256"]) for fila in filas_lote}
    informe["hash_ok"] = hashes_lote == {sha_actual}
    if not informe["hash_ok"]:
        errores.append(f"{ruta}: cambió desde el lote (sha256 no cuadra)")
    if any(str(fila["sha256"]) != sha_actual for fila in filas_todas):
        errores.append(f"{ruta}: hay procedencia de otra versión del fichero")

    intervalos = sorted(
        (int(fila["desde_linea"]), int(fila["hasta_linea"])) for fila in filas_todas
    )
    informe["rangos"] = [{"desde": desde, "hasta": hasta} for desde, hasta in _fusionar(intervalos)]
    informe["solapamientos"] = _solapamientos(filas_todas)
    if informe["solapamientos"]:
        mensaje = f"{ruta}: hay rangos de procedencia solapados"
        if parcial:
            errores.append(mensaje)
        else:
            avisos.append(mensaje)

    texto = crudo.decode("utf-8", errors="replace").lstrip("\ufeff")
    bloques = _bloques_markdown(texto)
    informe["bloques"] = len(bloques)
    if not bloques:
        errores.append(f"{ruta}: no hay bloques accionables (viñetas de nivel superior)")

    sin_migrar = [
        bloque
        for bloque in bloques
        if not any(desde <= bloque["linea"] <= hasta for desde, hasta in intervalos)
    ]
    informe["cubiertos"] = len(bloques) - len(sin_migrar)
    informe["sin_migrar"] = sin_migrar[:MAX_HUECOS]
    informe["recortado"] = len(sin_migrar) > MAX_HUECOS

    if parcial:
        if not sin_migrar:
            errores.append(f"{ruta}: cobertura total; usa absorb sin --parcial")
        informe["marcadores"] = _marcadores_del_lote(ruta, filas_lote)
        if not informe["marcadores"] and not errores:
            errores.append(f"{ruta}: el lote no tiene rangos que retirar")

    copia = Path(EUI_DIR) / "migracion" / lote / relativa
    informe["copia"] = {
        "destino": copia.as_posix(),
        "sha256": sha_actual,
        "bytes": len(crudo),
    }
    return informe
