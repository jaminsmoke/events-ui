"""Exportar documentos a Markdown y leer las copias absorbidas."""

from __future__ import annotations

import re
from contextlib import closing
from pathlib import Path
from typing import Any

from ..db import open_read_only
from ..items.base.comun import InvalidInput
from ..items.base.eui_fs import es_permitida_en_eui
from ..items.base.rutas import EUI_DIR, db_file_for
from .confirmacion import _ruta_en_repo
from .documentos import EXTENSIONES, _markdowns, _relativa

_MARCADOR_EUI = re.compile(r"\[eui:([0-9a-f]{32})\]")

SECCIONES_EXPORT = (
    ("draft", "Entrada"),
    ("proposed", "Backlog"),
    ("roadmap", "Roadmap"),
    ("verificacion", "Verificación"),
    ("revision_aprobada", "Revisión"),
    ("historial", "Hecho"),
    ("rejected", "Descartado"),
)


def listar_documentos_absorbidos(raiz: Path) -> list[dict[str, Any]]:
    """Los documentos que ya solo viven en Events UI, ordenados por ruta.

    Se leen los manifiestos de `.EUI/migracion/<lote>/absorcion.json`, no el
    filesystem del repo: el origen puede haberse retirado. Si una ruta aparece
    en varios lotes, se queda el manifiesto más reciente.
    """
    from ..items.migracion import leer_absorcion

    raiz = raiz.resolve()
    base = raiz / EUI_DIR / "migracion"
    if not base.is_dir():
        return []

    documentos: dict[str, dict[str, Any]] = {}
    with closing(open_read_only(db_file_for(str(raiz)))) as conn:
        for carpeta in sorted(base.iterdir()):
            if not carpeta.is_dir():
                continue
            try:
                manifiesto = leer_absorcion(str(raiz), carpeta.name)
            except InvalidInput:
                continue
            if not manifiesto or manifiesto.get("estado") != "absorbido":
                continue
            # La parcial deja el Markdown en el repo con marcadores; no es un
            # documento que solo viva en Events UI.
            if manifiesto.get("modo") == "parcial":
                continue
            absorbido_at = str(manifiesto.get("absorbido_at") or "")
            for archivo in manifiesto.get("archivos", []):
                if not isinstance(archivo, dict) or not isinstance(archivo.get("ruta"), str):
                    continue
                if archivo.get("modo") == "parcial":
                    continue
                ruta = archivo["ruta"]
                fila = conn.execute(
                    "SELECT COUNT(DISTINCT work_item_uid) FROM migracion_item WHERE ruta = ?",
                    (ruta,),
                ).fetchone()
                documento = {
                    "ruta": ruta,
                    "lote": str(manifiesto.get("lote") or carpeta.name),
                    "absorbido_at": absorbido_at,
                    "items": int(fila[0]) if fila else 0,
                    "copia": archivo.get("copia"),
                }
                anterior = documentos.get(ruta)
                if anterior is None or documento["absorbido_at"] > anterior["absorbido_at"]:
                    documentos[ruta] = documento

    return sorted(documentos.values(), key=lambda documento: documento["ruta"].casefold())


def documentos_ajenos(raiz: Path) -> list[dict[str, Any]]:
    """Documentos que se hacen pasar por parte del flujo sin haber pasado.

    Un README o una guía escritos a mano no salen aquí: no pretenden ser
    documentos de Events UI. Lo que se busca es la suplantación, en tres
    formas, y solo se informa de ella: no se escribe ni se borra nada.

    - un Markdown suelto dentro de `.EUI` que no es copia de absorción;
    - una ruta que un manifiesto dio por retirada y ha vuelto al repo;
    - un marcador `[eui:<uid>]` cuyo uid no conoce el almacén.
    """
    # Por el paquete, no por el nombre local: la fachada es lo que consultan el
    # CLI y las pruebas, y sustituir ahí tiene que valer.
    from .. import migracion

    raiz = raiz.resolve()
    try:
        absorbidos = {
            documento["ruta"] for documento in migracion.listar_documentos_absorbidos(raiz)
        }
    except FileNotFoundError:
        # Sin almacén no hay nada absorbido que pueda reaparecer.
        absorbidos = set()
    ajenos: dict[str, dict[str, Any]] = {}
    marcados: dict[str, list[str]] = {}

    for archivo in _markdowns_en_eui(raiz):
        relativa = _relativa(archivo, raiz)
        ajenos[relativa] = {
            "ruta": relativa,
            "motivo": f"Markdown dentro de {EUI_DIR}: no es una copia de absorción",
        }

    for archivo in _markdowns(raiz):
        relativa = _relativa(archivo, raiz)
        if relativa in absorbidos:
            ajenos[relativa] = {
                "ruta": relativa,
                "motivo": "reaparece una ruta que la absorción retiró",
            }
            continue
        try:
            texto = archivo.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        uids = sorted(set(_MARCADOR_EUI.findall(texto)))
        if uids:
            marcados[relativa] = uids

    if marcados:
        desconocidos = _uids_desconocidos(raiz, {uid for uids in marcados.values() for uid in uids})
        for relativa, uids in marcados.items():
            faltan = [uid for uid in uids if uid in desconocidos]
            if faltan:
                ajenos[relativa] = {
                    "ruta": relativa,
                    "motivo": (
                        f"marcador [eui:…] que el almacén no conoce ({', '.join(faltan[:3])})"
                    ),
                }

    return sorted(ajenos.values(), key=lambda documento: documento["ruta"].casefold())


def _uids_desconocidos(raiz: Path, uids: set[str]) -> set[str]:
    """De los uids citados en marcadores, los que el almacén no tiene.

    Sin almacén no hay nada que conozca: todos los marcadores son ajenos, que
    es lo que la guarda quiere decir en un repo que aún no ha migrado.
    """
    try:
        conn = open_read_only(db_file_for(str(raiz)))
    except FileNotFoundError:
        return uids
    with closing(conn):
        marcas = ",".join("?" for _ in uids)
        filas = conn.execute(
            f"SELECT uid FROM work_item_data WHERE uid IN ({marcas})", tuple(uids)
        ).fetchall()
    return uids - {str(fila[0]) for fila in filas}


def _markdowns_en_eui(raiz: Path) -> list[Path]:
    """Los Markdown de `.EUI` que el contrato no permite (no son copias)."""
    eui = raiz / EUI_DIR
    if not eui.is_dir():
        return []
    ajenos: list[Path] = []
    for archivo in sorted(eui.rglob("*")):
        if not archivo.is_file() or archivo.suffix.lower() not in EXTENSIONES:
            continue
        if not es_permitida_en_eui(archivo.relative_to(eui).as_posix()):
            ajenos.append(archivo)
    return ajenos


def exportar_documento(raiz: Path, ruta: str) -> str:
    """Genera el Markdown actual de un documento a partir de sus ítems.

    No lee el fichero de origen: usa la procedencia (`migracion_item`) para
    saber qué ítems salieron de él y su orden, y el estado actual de cada uno.
    Así la vista sigue disponible aunque el Markdown ya se haya retirado.
    """
    raiz = raiz.resolve()
    _ruta_en_repo(raiz, ruta)
    with closing(open_read_only(db_file_for(str(raiz)))) as conn:
        filas = conn.execute(
            "SELECT mi.work_item_uid, mi.desde_linea, mi.estado AS estado_origen,"
            " work_item_data.title, work_item_data.description, work_item_data.content,"
            " work_item_node.estado AS estado_actual"
            " FROM migracion_item mi"
            " JOIN work_item_data ON work_item_data.uid = mi.work_item_uid"
            " LEFT JOIN work_item_node ON work_item_node.uid = mi.work_item_uid"
            " WHERE mi.ruta = ?"
            " ORDER BY mi.desde_linea, mi.work_item_uid",
            (ruta,),
        ).fetchall()
        if not filas:
            raise KeyError(ruta)

        items: list[dict[str, Any]] = []
        vistos: set[str] = set()
        for fila in filas:
            uid = str(fila["work_item_uid"])
            if uid in vistos:
                continue
            vistos.add(uid)
            items.append(
                {
                    "uid": uid,
                    "desde": int(fila["desde_linea"]),
                    "title": str(fila["title"]),
                    "description": str(fila["description"] or ""),
                    "content": str(fila["content"] or ""),
                    "estado": str(fila["estado_actual"] or fila["estado_origen"] or "proposed"),
                }
            )

        uids = list(vistos)
        marcas = ",".join("?" for _ in uids)
        fases = conn.execute(
            f"SELECT work_item_uid, orden, titulo, estado FROM work_item_fase"
            f" WHERE work_item_uid IN ({marcas}) ORDER BY work_item_uid, orden",
            tuple(uids),
        ).fetchall()
        requisitos = conn.execute(
            f"SELECT work_item_uid, fase_orden, orden, titulo, hecho FROM work_item_requisito"
            f" WHERE work_item_uid IN ({marcas}) ORDER BY work_item_uid, fase_orden, orden",
            tuple(uids),
        ).fetchall()

    fases_por_uid: dict[str, list[dict[str, Any]]] = {}
    for fila in fases:
        fases_por_uid.setdefault(str(fila["work_item_uid"]), []).append(dict(fila))
    requisitos_por_fase: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for fila in requisitos:
        requisitos_por_fase.setdefault(
            (str(fila["work_item_uid"]), int(fila["fase_orden"])), []
        ).append(dict(fila))

    lineas = [
        f"# {Path(ruta).stem}",
        "",
        f"> Exportado desde Events UI · {len(items)} ítems · documento `{ruta}`",
        "",
    ]
    for estado, titulo in SECCIONES_EXPORT:
        grupo = [
            item
            for item in items
            if item["estado"] == estado or (estado == "rejected" and item["estado"] == "superseded")
        ]
        if not grupo:
            continue
        lineas.extend([f"## {titulo}", ""])
        for item in grupo:
            lineas.append(
                _bloque_export(item, fases_por_uid.get(item["uid"], []), requisitos_por_fase)
            )
            lineas.append("")
    return "\n".join(lineas).rstrip() + "\n"


def _bloque_export(
    item: dict[str, Any],
    fases: list[dict[str, Any]],
    requisitos_por_fase: dict[tuple[str, int], list[dict[str, Any]]],
) -> str:
    """El Markdown de un ítem: su contenido original y, si los hay, sus fases."""
    lineas: list[str] = []
    content = str(item["content"] or "").strip()
    if content:
        lineas.append(content)
    else:
        bullet = f"- **{item['title']}**"
        if item["description"]:
            bullet += f". {item['description']}"
        lineas.append(bullet)

    if fases:
        lineas.append("  - Fases:")
        for fase in fases:
            lineas.append(f"    - {fase['orden']}. {fase['titulo']} ({fase['estado']})")
            for requisito in requisitos_por_fase.get((item["uid"], int(fase["orden"])), []):
                marca = "x" if requisito["hecho"] else " "
                lineas.append(f"      - [{marca}] {requisito['titulo']}")
    return "\n".join(lineas)
