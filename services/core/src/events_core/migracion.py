"""Escaneo de Markdown para la migración.

`eui migrate scan` es la mitad que no escribe: dice qué Markdown hay bajo una
carpeta del repo, con su hash y lo que se reconoce de cada uno (frontmatter
simple, títulos y tareas). Con eso el agente propone un plan JSON y un
importador determinista lo valida y aplica (siguiente paso). Aquí no se abre el
almacén ni se modifica ningún fichero: solo lectura.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

from .ideas.base.comun import InvalidInput

EXTENSIONES = {".md", ".markdown"}
# Lo que nunca es documentación del proyecto: metadatos, dependencias y salidas
# de build. Se compara por nombre en cualquier nivel.
DIRECTORIOS_IGNORADOS = {".git", ".EUI", "node_modules", ".venv", "dist", "build"}

# Tope de cortesía: un repo enorme no debe devolver un JSON gigante ni tardar
# minutos en un comando de sondeo. Se avisa con `recortado`.
MAX_ARCHIVOS = 1000

_FRONTMATTER_CLAVE = re.compile(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$")
_TITULO = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_TAREA = re.compile(r"^\s*[-*+]\s+\[([ xX])\]\s+")
_CERCA = re.compile(r"^\s*(```|~~~)")

# El contrato del plan que propone el agente. Se publica con
# `eui schema migrate` y es lo primero que mira `check`: cierra lo que no se
# negocia (todo a `proposed`, fases pendientes, origen obligatorio) para que el
# agente no pueda colar un estado o una idea sin procedencia.
ESQUEMA_PLAN: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:events-ui:plan-migracion:1",
    "title": "Plan de migración de Markdown",
    "description": (
        "Lo que propone el agente antes de tocar el almacén. Cada idea cita el "
        "Markdown del que sale (ruta, líneas y sha256) y todas entran en "
        "`proposed`; `check` añade lo que el esquema no puede comprobar (refs "
        "repetidos, dependencias, hash del fichero) y `apply` lo aplica como un "
        "lote reversible."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": ["version", "ideas"],
    "properties": {
        "version": {
            "const": 1,
            "description": "Versión del formato del plan; si cambia, cambia el número.",
        },
        "ideas": {
            "type": "array",
            "minItems": 1,
            "items": {"$ref": "#/$defs/idea"},
        },
    },
    "$defs": {
        "ref": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
            "description": "Identificador local del plan; no es un uid del almacén.",
        },
        "idea": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ref", "title", "origen"],
            "properties": {
                "ref": {
                    "$ref": "#/$defs/ref",
                    "description": "Único en el plan; `depende_de` apunta aquí.",
                },
                "title": {"type": "string", "minLength": 1},
                "description": {"type": "string", "default": ""},
                "content": {"type": "string", "default": ""},
                "kind": {"const": "idea"},
                "status": {
                    "const": "proposed",
                    "description": "La migración no adivina carriles: todo entra en proposed.",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                    "default": [],
                },
                "depende_de": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/ref"},
                    "uniqueItems": True,
                    "default": [],
                    "description": "Refs de otras ideas de este plan, nunca uids.",
                },
                "fases": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/fase"},
                    "default": [],
                },
                "origen": {"$ref": "#/$defs/origen"},
            },
        },
        "fase": {
            "type": "object",
            "additionalProperties": False,
            "required": ["titulo"],
            "properties": {
                "titulo": {"type": "string", "minLength": 1},
                "nota": {"type": "string", "default": ""},
                "estado": {
                    "enum": ["pendiente"],
                    "default": "pendiente",
                    "description": "Una migración no trae fases hechas ni fallidas.",
                },
                "requisitos": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/requisito"},
                    "default": [],
                },
            },
        },
        "requisito": {
            "type": "object",
            "additionalProperties": False,
            "required": ["titulo"],
            "properties": {
                "titulo": {"type": "string", "minLength": 1},
                "hecho": {
                    "const": False,
                    "default": False,
                    "description": "Marcar un requisito es una decisión del usuario.",
                },
            },
        },
        "origen": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ruta", "desde_linea", "hasta_linea", "sha256"],
            "properties": {
                "ruta": {
                    "type": "string",
                    "minLength": 1,
                    "pattern": "^[^\\\\]+$",
                    "description": "Ruta relativa al repo, con `/` y sin `..`.",
                },
                "desde_linea": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Primera línea del elemento (1-based).",
                },
                "hasta_linea": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Última línea del elemento (1-based, incluida).",
                },
                "sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                    "description": "El sha256 que dio `migrate scan` para ese fichero.",
                },
            },
        },
    },
}


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
    if not destino.exists():
        raise FileNotFoundError(f"no existe: {destino}")
    if destino.is_file() and destino.suffix.lower() not in EXTENSIONES:
        raise InvalidInput(f"no es un Markdown: {destino}")
    return destino


def escanear(raiz: Path, ruta: str | None = None) -> dict[str, Any]:
    """El informe: cada Markdown con su hash y lo reconocido, y un resumen."""
    raiz = raiz.resolve()
    destino = resolver(raiz, ruta)
    archivos = [destino] if destino.is_file() else _markdowns(destino)
    recortado = len(archivos) > MAX_ARCHIVOS
    fichas = [_ficha(archivo, raiz) for archivo in archivos[:MAX_ARCHIVOS]]

    return {
        "repo": str(raiz),
        "ruta": _relativa(destino, raiz),
        "archivos": fichas,
        "resumen": {
            "archivos": len(fichas),
            "secciones": sum(ficha.get("secciones", 0) for ficha in fichas),
            "tareas": sum(ficha.get("tareas", {}).get("total", 0) for ficha in fichas),
        },
        "recortado": recortado,
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
