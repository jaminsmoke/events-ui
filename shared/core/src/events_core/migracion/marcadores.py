"""Marcadores y bloques Markdown: qué texto del lote se retira y qué queda."""

from __future__ import annotations

import re
from typing import Any

from ..items.base.comun import InvalidInput
from .documentos import _CERCA, _frontmatter


def _marcadores_del_lote(ruta: str, filas_lote: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Un marcador visible por item del lote, con su rango 1-based."""
    marcadores: list[dict[str, Any]] = []

    def _clave_rango(item: dict[str, Any]) -> tuple[int, int, str]:
        return (int(item["desde_linea"]), int(item["hasta_linea"]), str(item["work_item_uid"]))

    for fila in sorted(filas_lote, key=_clave_rango):
        uid = str(fila["work_item_uid"])
        titulo = str(fila["title"]).strip() or uid
        desde = int(fila["desde_linea"])
        hasta = int(fila["hasta_linea"])
        marcadores.append(
            {
                "ruta": ruta,
                "uid": uid,
                "title": titulo,
                "desde": desde,
                "hasta": hasta,
                "marcador": _texto_marcador(uid, titulo),
            }
        )
    return marcadores


def _texto_marcador(uid: str, titulo: str) -> str:
    """Línea visible que queda en el Markdown tras la absorción parcial."""
    limpio = " ".join(titulo.split())
    return f"- [eui:{uid}] {limpio}"


def _aplicar_marcadores(texto: str, marcadores: list[dict[str, Any]]) -> str:
    """Sustituye cada rango por su marcador, de abajo arriba."""
    newline = "\r\n" if "\r\n" in texto else "\n"
    termina = texto.endswith("\n") or texto.endswith("\r")
    lineas = texto.splitlines()
    tramos = sorted(
        (
            int(item["desde"]),
            int(item["hasta"]),
            str(item["marcador"]),
        )
        for item in marcadores
    )
    for desde, hasta, marcador in reversed(tramos):
        if desde < 1 or hasta < desde or hasta > len(lineas):
            raise InvalidInput(
                f"rango de marcador fuera del fichero: {desde}-{hasta} (líneas={len(lineas)})"
            )
        lineas[desde - 1 : hasta] = [marcador]
    cuerpo = newline.join(lineas)
    if termina and (not cuerpo.endswith("\n") and not cuerpo.endswith("\r")):
        cuerpo += newline
    return cuerpo


def _fusionar(intervalos: list[tuple[int, int]]) -> list[tuple[int, int]]:
    fusionados: list[tuple[int, int]] = []
    for desde, hasta in intervalos:
        if fusionados and desde <= fusionados[-1][1] + 1:
            fusionados[-1] = (fusionados[-1][0], max(fusionados[-1][1], hasta))
        else:
            fusionados.append((desde, hasta))
    return fusionados


def _solapamientos(filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    intervalos = sorted(
        (int(fila["desde_linea"]), int(fila["hasta_linea"]), str(fila["work_item_uid"]))
        for fila in filas
    )
    encontrados: list[dict[str, Any]] = []
    for indice, (_desde, hasta, uid) in enumerate(intervalos):
        for otro_desde, otro_hasta, otro_uid in intervalos[indice + 1 :]:
            if otro_desde > hasta:
                break
            encontrados.append(
                {
                    "desde": otro_desde,
                    "hasta": min(hasta, otro_hasta),
                    "items": [uid, otro_uid],
                }
            )
            if len(encontrados) >= 20:
                return encontrados
    return encontrados


def _bloques_markdown(texto: str) -> list[dict[str, Any]]:
    """Viñetas accionables fuera de frontmatter y bloques de código.

    Una viñeta con subitems directos es una cabecera de grupo, no un bloque:
    sus hijos sí cuentan. Así `ROADMAP` no confunde «Migración v2…» con una
    item y siguen contando las cinco tareas que cuelgan de ella.
    """
    viñetas: list[dict[str, Any]] = []
    _, desde = _frontmatter(texto)
    en_codigo = False
    for indice, linea in enumerate(texto.splitlines()):
        if indice < desde:
            continue
        if _CERCA.match(linea):
            en_codigo = not en_codigo
            continue
        if en_codigo:
            continue
        coincidencia = re.match(r"^([ \t]*)[-*+]\s+(\S.*)$", linea)
        if coincidencia is None:
            continue
        resto = coincidencia.group(2).strip()
        if resto in {"---", "***"}:
            continue
        viñetas.append(
            {
                "linea": indice + 1,
                "sangria": len(coincidencia.group(1).replace("\t", "    ")),
                "texto": resto[:160],
            }
        )

    bloques: list[dict[str, Any]] = []
    for posicion, viñeta in enumerate(viñetas):
        siguiente = viñetas[posicion + 1] if posicion + 1 < len(viñetas) else None
        if siguiente is not None and siguiente["sangria"] > viñeta["sangria"]:
            continue
        bloques.append({"linea": viñeta["linea"], "texto": viñeta["texto"]})
    return bloques


# Un marcador de absorción parcial: `- [eui:<uid>] Título`.
