"""Los Markdown del repo: recorrerlos, leerlos y clasificarlos."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

from ..contrato import (
    FichaError,
    FichaLegible,
    InformeClasificacion,
    InformeScan,
    ResumenClasificacion,
    ResumenScan,
)
from ..items.base.comun import InvalidInput
from ..items.base.eui_fs import relativa_bajo_eui
from ..items.base.rutas import EUI_DIR

EXTENSIONES = {".md", ".markdown"}
# Lo que nunca es documentación del proyecto: metadatos, dependencias y salidas
# de build. Se compara por nombre en cualquier nivel.
DIRECTORIOS_IGNORADOS = {".git", ".EUI", "node_modules", ".venv", "dist", "build"}

# Tope de cortesía: un repo enorme no debe devolver un JSON gigante ni tardar
# minutos en un comando de sondeo. Se avisa con `recortado`.
MAX_ARCHIVOS = 1000
# Un informe seco no debe crecer sin límite si el documento tiene miles de
# viñetas; se avisa con `recortado`.
MAX_HUECOS = 200

_FRONTMATTER_CLAVE = re.compile(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$")
_TITULO = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_TAREA = re.compile(r"^\s*[-*+]\s+\[([ xX])\]\s+")
_CERCA = re.compile(r"^\s*(```|~~~)")


# Nombres (stem) que `classify` trata como fuente del mapa por defecto.
_NOMBRES_MAPA = {
    "roadmap",
    "backlog",
    "todo",
    "todos",
    "ideas",
    "cola",
    "changelog",
    "pendientes",
}
# Nombres que `classify` deja como referencia (no alimentan el mapa).
_NOMBRES_REFERENCIA = {
    "readme",
    "license",
    "licence",
    "copying",
    "contributing",
    "code_of_conduct",
    "security",
    "authors",
}


# El contrato del plan que propone el agente. Se publica con
# `eui schema migrate` y es lo primero que mira `check`: cierra lo que no se
# negocia (todo a `proposed`, fases pendientes, origen obligatorio) para que el
# agente no pueda colar un estado o un ítem sin procedencia.
def resolver(raiz: Path, ruta: str | None) -> Path:
    """La ruta a escanear, siempre dentro de la raíz del repo.

    `ruta` se interpreta desde la raíz y no desde el cwd, que cambia según cómo
    se lance el CLI; puede ser una carpeta o un Markdown suelto. Sin `ruta`, se
    escanea la raíz entera.
    """
    raiz = raiz.resolve()
    candidata = Path(ruta).expanduser() if ruta else raiz
    if not candidata.is_absolute():
        candidata = raiz / candidata
    destino = candidata.resolve()
    if not destino.is_relative_to(raiz):
        raise InvalidInput(f"la ruta tiene que estar dentro del repo: {destino}")
    # `.EUI` guarda copias de absorción, no documentos que se puedan escanear
    # o importar: un Markdown suelto ahí no viene del flujo.
    if relativa_bajo_eui(destino) is not None:
        raise InvalidInput(f"{EUI_DIR} no admite documentos: {destino}; solo copias de absorción")
    if not destino.exists():
        raise FileNotFoundError(f"no existe: {destino}")
    if destino.is_file() and destino.suffix.lower() not in EXTENSIONES:
        raise InvalidInput(f"no es un Markdown: {destino}")
    return destino


def escanear(raiz: Path, ruta: str | None = None) -> InformeScan:
    """El informe: cada Markdown con su hash y lo reconocido, y un resumen."""
    raiz = raiz.resolve()
    destino = resolver(raiz, ruta)
    archivos = [destino] if destino.is_file() else _markdowns(destino)
    recortado = len(archivos) > MAX_ARCHIVOS
    fichas = [_ficha(archivo, raiz) for archivo in archivos[:MAX_ARCHIVOS]]

    return InformeScan(
        repo=str(raiz),
        ruta=_relativa(destino, raiz),
        archivos=fichas,
        resumen=ResumenScan(
            archivos=len(fichas),
            secciones=sum(ficha.get("secciones", 0) for ficha in fichas),
            tareas=sum(ficha.get("tareas", {}).get("total", 0) for ficha in fichas),
        ),
        recortado=recortado,
    )


def clasificar(raiz: Path, ruta: str | None = None) -> InformeClasificacion:
    """Propone el manifiesto `documentos` a partir del scan.

    No escribe nada: es la mitad legible de la allowlist. El agente revisa
    clase/motivo/destino, añade `parcial` con rangos si hace falta y lo mete
    en el plan v3. Los nombres típicos de backlog van a `mapa`; README y
    licencias a `referencia`; el resto, a `mapa` si tiene tareas o a
    `referencia` si solo parece documentación.
    """
    informe = escanear(raiz, ruta)
    documentos: list[dict[str, Any]] = []
    for ficha in informe.archivos:
        if isinstance(ficha, FichaError):
            continue
        documento = _proponer_documento(ficha)
        if documento is not None:
            documentos.append(documento)
    return InformeClasificacion(
        repo=informe.repo,
        ruta=informe.ruta,
        documentos=documentos,
        resumen=ResumenClasificacion(
            documentos=len(documentos),
            mapa=sum(1 for doc in documentos if doc["clase"] == "mapa"),
            referencia=sum(1 for doc in documentos if doc["clase"] == "referencia"),
        ),
        recortado=informe.recortado,
    )


def _proponer_documento(ficha: FichaLegible) -> dict[str, Any] | None:
    """Una entrada del manifiesto a partir de la ficha del scan."""
    ruta = ficha.ruta
    if not ruta:
        return None
    stem = Path(ruta).stem.casefold()
    tareas = ficha.tareas.total
    if stem in _NOMBRES_MAPA or any(stem.startswith(f"{nombre}-") for nombre in _NOMBRES_MAPA):
        return {
            "ruta": ruta,
            "clase": "mapa",
            "motivo": f"nombre {stem!r}: fuente habitual del mapa",
            "destino": "mapa",
        }
    if stem in _NOMBRES_REFERENCIA:
        return {
            "ruta": ruta,
            "clase": "referencia",
            "motivo": f"nombre {stem!r}: documentación de referencia",
            "destino": "referencia",
        }
    if tareas > 0:
        return {
            "ruta": ruta,
            "clase": "mapa",
            "motivo": f"{tareas} tareas reconocidas en el scan",
            "destino": "mapa",
        }
    return {
        "ruta": ruta,
        "clase": "referencia",
        "motivo": "sin tareas reconocidas: se deja como referencia",
        "destino": "referencia",
    }


def _relativa(archivo: Path, raiz: Path) -> str:
    return archivo.relative_to(raiz).as_posix() or "."


def _markdowns(carpeta: Path) -> list[Path]:
    """Los Markdown de la carpeta, en orden estable y sin entrar en ruido."""
    encontrados: list[Path] = []
    for actual, dirs, ficheros in os.walk(carpeta):
        # En sitio: `os.walk` respeta este orden al bajar.
        dirs[:] = sorted(nombre for nombre in dirs if nombre not in DIRECTORIOS_IGNORADOS)
        for nombre in ficheros:
            archivo = Path(actual) / nombre
            if archivo.suffix.lower() in EXTENSIONES:
                encontrados.append(archivo)
    return sorted(encontrados)


def _ficha(archivo: Path, raiz: Path) -> dict[str, Any]:
    """Lo que se reconoce de un Markdown; un fichero ilegible se anota, no rompe."""
    ruta = _relativa(archivo, raiz)
    try:
        crudo = archivo.read_bytes()
    except OSError as exc:
        return {"ruta": ruta, "error": str(exc)}

    texto = crudo.decode("utf-8", errors="replace").lstrip("\ufeff")
    frontmatter, desde = _frontmatter(texto)
    titulos = _titulos(texto, desde)
    total, hechas = _tareas(texto, desde)
    return {
        "ruta": ruta,
        "bytes": len(crudo),
        # El plan lo guardará como origen: es lo que hace idempotente el apply.
        "sha256": hashlib.sha256(crudo).hexdigest(),
        "lineas": len(texto.splitlines()),
        "frontmatter": frontmatter,
        "titulos": titulos,
        "secciones": sum(1 for titulo in titulos if titulo["nivel"] == 2),
        "tareas": {"total": total, "hechas": hechas},
    }


def _frontmatter(texto: str) -> tuple[dict[str, str] | None, int]:
    """Las claves simples del bloque `---` inicial, y la línea donde acaba.

    Sin parser YAML: solo `clave: valor`, que es lo que hace falta para leer un
    backlog. Un bloque sin cerrar no es frontmatter y se lee como texto normal.
    """
    lineas = texto.splitlines()
    if not lineas or lineas[0].strip() != "---":
        return None, 0
    for cierre in range(1, len(lineas)):
        if lineas[cierre].strip() != "---":
            continue
        claves: dict[str, str] = {}
        for linea in lineas[1:cierre]:
            coincidencia = _FRONTMATTER_CLAVE.match(linea)
            if coincidencia:
                claves[coincidencia.group(1)] = coincidencia.group(2).strip().strip("'\"")
        return claves, cierre + 1
    return None, 0


def _titulos(texto: str, desde: int) -> list[dict[str, Any]]:
    """Los títulos ATX fuera de bloques de código, con su línea (1-based)."""
    titulos: list[dict[str, Any]] = []
    en_codigo = False
    for indice, linea in enumerate(texto.splitlines()):
        if indice < desde:
            continue
        if _CERCA.match(linea):
            en_codigo = not en_codigo
            continue
        if en_codigo:
            continue
        coincidencia = _TITULO.match(linea)
        if coincidencia:
            titulos.append(
                {
                    "nivel": len(coincidencia.group(1)),
                    "texto": coincidencia.group(2).strip(),
                    "linea": indice + 1,
                }
            )
    return titulos


def _tareas(texto: str, desde: int) -> tuple[int, int]:
    """Cuántas casillas `[ ]`/`[x]` hay fuera de bloques de código y cuántas hechas."""
    total = hechas = 0
    en_codigo = False
    for indice, linea in enumerate(texto.splitlines()):
        if indice < desde:
            continue
        if _CERCA.match(linea):
            en_codigo = not en_codigo
            continue
        if en_codigo:
            continue
        coincidencia = _TAREA.match(linea)
        if coincidencia:
            total += 1
            if coincidencia.group(1).lower() == "x":
                hechas += 1
    return total, hechas
