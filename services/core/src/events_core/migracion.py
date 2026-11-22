"""Escaneo de Markdown para la migración.

`eui migrate scan` es la mitad que no escribe: dice qué Markdown hay bajo una
carpeta del repo, con su hash y lo que se reconoce de cada uno (frontmatter
simple, títulos y tareas). Con eso el agente propone un plan JSON y un
importador determinista lo valida y aplica (siguiente paso). Aquí no se abre el
almacén ni se modifica ningún fichero: solo lectura.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .db import open_read_only
from .ideas.base.comun import InvalidInput, fecha_iso
from .ideas.base.rutas import EUI_DIR, db_file_for

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


class PlanInvalido(ValueError):
    """El plan no se puede leer o no es un objeto JSON."""


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
            "enum": [1, 2],
            "description": "1: solo proposed; 2: destinos, fechas y motivo.",
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
                    "enum": ["proposed", "draft", "historial", "rejected"],
                    "default": "proposed",
                    "description": (
                        "Carril de destino. `historial` y `rejected` no llevan fases; "
                        "`rejected` exige `motivo`."
                    ),
                },
                "fecha": {
                    "type": "string",
                    "minLength": 1,
                    "description": (
                        "Fecha de archivo o descarte (ISO 8601); solo con historial "
                        "o rejected. Sin ella se usa la de importación."
                    ),
                },
                "motivo": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Por qué se descarta; obligatorio con rejected.",
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
                    "description": "Solo con status proposed.",
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
                    "minItems": 1,
                    "items": {"$ref": "#/$defs/requisito"},
                    "description": "Una fase sin criterio de hecho no se puede cerrar.",
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


def cargar_plan(ruta: Path) -> dict[str, Any]:
    """Lee el plan del disco; separa «no existe» de «no es JSON»."""
    try:
        texto = ruta.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"no existe el plan: {ruta}") from exc
    except OSError as exc:
        raise PlanInvalido(f"no se pudo leer {ruta}: {exc}") from exc
    try:
        plan = json.loads(texto)
    except json.JSONDecodeError as exc:
        raise PlanInvalido(f"{ruta} no es JSON válido: {exc}") from exc
    if not isinstance(plan, dict):
        raise PlanInvalido(f"{ruta} no es un objeto JSON")
    return plan


def huella_plan(plan: dict[str, Any]) -> str:
    """La huella canónica del plan: dos envíos iguales dan el mismo lote.

    Se ordenan las claves para que el orden en que las escribió el agente no
    cambie el resultado; el core normaliza antes con Pydantic, así que las
    claves ausentes con valor por defecto tampoco alteran la huella.
    """
    canonico = json.dumps(plan, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def validar_esquema(datos: Any, esquema: dict[str, Any] | None = None) -> list[str]:
    """Valida contra el esquema publicado, sin dependencias nuevas.

    Cubre las palabras que usa `ESQUEMA_PLAN` (y ninguna más): `$ref` local,
    `type`, `const`, `enum`, `required`, `properties`,
    `additionalProperties: false`, `items`, `minItems`, `uniqueItems`,
    `minLength`, `pattern` y `minimum`. Así el contrato publicado y lo que
    `check` acepta no pueden separarse.
    """
    raiz_esquema = ESQUEMA_PLAN if esquema is None else esquema
    errores: list[str] = []
    _validar(datos, raiz_esquema, raiz_esquema, "plan", errores)
    return errores


def revisar(raiz: Path, plan: dict[str, Any], *, plan_ruta: str = "plan.json") -> dict[str, Any]:
    """Valida el plan y enseña lo que se crearía, sin escribir nada.

    Primero el esquema; solo si pasa se miran los refs, las dependencias, los
    ciclos y cada origen contra el fichero de verdad. Un error de esquema corta
    aquí: seguir con un plan mal formado solo añadiría ruido.
    """
    raiz = raiz.resolve()
    ideas = plan.get("ideas") if isinstance(plan.get("ideas"), list) else []
    resumen = _resumen(ideas)
    errores = validar_esquema(plan)
    if errores:
        return {
            "ok": False,
            "repo": str(raiz),
            "plan": plan_ruta,
            "crear": [],
            "errores": errores,
            "resumen": resumen,
        }

    errores = _errores_de_destino(plan)
    vistos: dict[str, int] = {}
    for indice, idea in enumerate(ideas):
        ref = idea["ref"]
        if ref in vistos:
            errores.append(
                f"ideas[{indice}].ref: repetida ({ref!r}); ya estaba en ideas[{vistos[ref]}]"
            )
        else:
            vistos[ref] = indice

    for indice, idea in enumerate(ideas):
        for posicion, dependencia in enumerate(idea.get("depende_de") or []):
            ruta_dep = f"ideas[{indice}].depende_de[{posicion}]"
            if dependencia == idea["ref"]:
                errores.append(f"{ruta_dep}: se apunta a sí misma ({dependencia!r})")
            elif dependencia not in vistos:
                errores.append(f"{ruta_dep}: no existe la idea {dependencia!r}")

    grafo = {
        idea["ref"]: [dep for dep in idea.get("depende_de") or [] if dep in vistos]
        for idea in ideas
    }
    for ciclo in _ciclos(grafo):
        errores.append(f"dependencia circular: {' → '.join(ciclo)}")

    errores.extend(_errores_de_origen(raiz, ideas))

    titulos: dict[tuple[str, str], int] = {}
    for indice, idea in enumerate(ideas):
        clave = (idea["title"].strip().casefold(), idea["origen"]["ruta"])
        if clave in titulos:
            errores.append(
                f"ideas[{indice}]: «{idea['title']}» ya sale en ideas[{titulos[clave]}] "
                "del mismo fichero"
            )
        else:
            titulos[clave] = indice

    crear = [
        {
            "ref": idea["ref"],
            "title": idea["title"],
            "status": idea.get("status") or "proposed",
            "origen": idea["origen"],
        }
        for idea in ideas
    ]
    return {
        "ok": not errores,
        "repo": str(raiz),
        "plan": plan_ruta,
        "crear": crear,
        "errores": errores,
        "resumen": resumen,
    }


def _errores_de_destino(plan: dict[str, Any]) -> list[str]:
    """Lo que el esquema no puede decir de los carriles y sus datos."""
    errores: list[str] = []
    version = plan.get("version")
    for indice, idea in enumerate(plan.get("ideas") or []):
        if not isinstance(idea, dict):
            continue
        estado = idea.get("status") or "proposed"
        if version == 1 and estado != "proposed":
            errores.append(
                f"ideas[{indice}].status: la versión 1 solo admite proposed; usa version 2"
            )
        if estado != "proposed" and idea.get("fases"):
            errores.append(f"ideas[{indice}].fases: solo valen con status proposed")
        if estado == "rejected" and not str(idea.get("motivo") or "").strip():
            errores.append(f"ideas[{indice}].motivo: rejected exige un motivo")
        fecha = idea.get("fecha")
        if fecha is not None:
            if estado not in ("historial", "rejected"):
                errores.append(f"ideas[{indice}].fecha: solo vale para historial o rejected")
                continue
            try:
                fecha_iso(str(fecha))
            except InvalidInput as exc:
                errores.append(f"ideas[{indice}].fecha: {exc}")
    return errores


def _resumen(ideas: list[Any]) -> dict[str, int]:
    archivos = {
        idea["origen"]["ruta"]
        for idea in ideas
        if isinstance(idea, dict)
        and isinstance(idea.get("origen"), dict)
        and isinstance(idea["origen"].get("ruta"), str)
    }
    return {"ideas": len(ideas), "archivos": len(archivos), "refs": len(ideas)}


def _errores_de_origen(raiz: Path, ideas: list[dict[str, Any]]) -> list[str]:
    """Cada origen tiene que seguir siendo el fichero del scan."""
    errores: list[str] = []
    for indice, idea in enumerate(ideas):
        origen = idea["origen"]
        prefijo = f"ideas[{indice}].origen"
        try:
            archivo = resolver(raiz, origen["ruta"])
        except InvalidInput as exc:
            errores.append(f"{prefijo}: {exc}")
            continue
        except FileNotFoundError:
            errores.append(f"{prefijo}: no existe {origen['ruta']!r}")
            continue
        if archivo.is_dir():
            errores.append(f"{prefijo}: {origen['ruta']!r} es una carpeta")
            continue
        try:
            crudo = archivo.read_bytes()
        except OSError as exc:
            errores.append(f"{prefijo}: no se pudo leer {origen['ruta']!r}: {exc}")
            continue

        if hashlib.sha256(crudo).hexdigest() != origen["sha256"]:
            errores.append(f"{prefijo}: {origen['ruta']!r} cambió desde el scan (sha256 no cuadra)")
        lineas = len(crudo.decode("utf-8", errors="replace").splitlines())
        if origen["desde_linea"] > origen["hasta_linea"]:
            errores.append(
                f"{prefijo}: desde_linea {origen['desde_linea']} va después de "
                f"hasta_linea {origen['hasta_linea']}"
            )
        elif origen["hasta_linea"] > lineas:
            errores.append(
                f"{prefijo}: hasta_linea {origen['hasta_linea']} supera las "
                f"{lineas} líneas del fichero"
            )
    return errores


def _ciclos(grafo: dict[str, list[str]]) -> list[list[str]]:
    """Los ciclos del grafo de dependencias, cada uno con su recorrido."""
    colores: dict[str, int] = {}
    pila: list[str] = []
    encontrados: list[list[str]] = []
    vistos: set[tuple[str, ...]] = set()

    def visitar(nodo: str) -> None:
        colores[nodo] = 1
        pila.append(nodo)
        for vecino in grafo.get(nodo, []):
            if colores.get(vecino, 0) == 0:
                visitar(vecino)
            elif colores.get(vecino) == 1:
                ciclo = pila[pila.index(vecino) :] + [vecino]
                clave = tuple(sorted(ciclo[:-1]))
                if clave not in vistos:
                    vistos.add(clave)
                    encontrados.append(ciclo)
        pila.pop()
        colores[nodo] = 2

    for nodo in grafo:
        if colores.get(nodo, 0) == 0:
            visitar(nodo)
    return encontrados


def _validar(
    valor: Any, nodo: dict[str, Any], raiz: dict[str, Any], ruta: str, errores: list[str]
) -> None:
    if "$ref" in nodo:
        nodo = _resolver_ref(raiz, nodo["$ref"])

    if "const" in nodo and not _igual(valor, nodo["const"]):
        errores.append(f"{ruta}: {_texto(valor)} no es el valor exigido ({_texto(nodo['const'])})")
    if "enum" in nodo and not any(_igual(valor, opcion) for opcion in nodo["enum"]):
        opciones = ", ".join(_texto(opcion) for opcion in nodo["enum"])
        errores.append(f"{ruta}: {_texto(valor)} no está entre {opciones}")

    esperado = nodo.get("type")
    if isinstance(esperado, str) and not _tipo_ok(valor, esperado):
        errores.append(f"{ruta}: se esperaba {esperado} y llegó {_nombre_tipo(valor)}")
        return

    if isinstance(valor, str):
        minimo = nodo.get("minLength", 0)
        if len(valor) < minimo:
            errores.append(f"{ruta}: {len(valor)} caracteres; mínimo {minimo}")
        patron = nodo.get("pattern")
        if isinstance(patron, str) and re.search(patron, valor) is None:
            errores.append(f"{ruta}: no cumple el patrón {patron}")

    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        minimo = nodo.get("minimum")
        if isinstance(minimo, (int, float)) and valor < minimo:
            errores.append(f"{ruta}: {valor}; mínimo {minimo}")

    if isinstance(valor, list):
        min_items = nodo.get("minItems", 0)
        if len(valor) < min_items:
            errores.append(f"{ruta}: {len(valor)} elementos; mínimo {min_items}")
        if nodo.get("uniqueItems"):
            vistos = [
                json.dumps(elemento, sort_keys=True, ensure_ascii=False) for elemento in valor
            ]
            if len(set(vistos)) != len(vistos):
                errores.append(f"{ruta}: hay elementos repetidos")
        items = nodo.get("items")
        if isinstance(items, dict):
            for indice, elemento in enumerate(valor):
                _validar(elemento, items, raiz, f"{ruta}[{indice}]", errores)

    if isinstance(valor, dict):
        propiedades = nodo.get("properties", {})
        for clave in nodo.get("required", []):
            if clave not in valor:
                errores.append(f"{ruta}.{clave}: falta")
        for clave, sub in propiedades.items():
            if clave in valor:
                _validar(valor[clave], sub, raiz, f"{ruta}.{clave}", errores)
        if nodo.get("additionalProperties") is False:
            for clave in valor:
                if clave not in propiedades:
                    errores.append(f"{ruta}.{clave}: no está permitido")


def _resolver_ref(raiz: dict[str, Any], referencia: str) -> dict[str, Any]:
    if not referencia.startswith("#/"):
        return {}
    actual: Any = raiz
    for parte in referencia[2:].split("/"):
        actual = actual[parte]
    return actual


def _tipo_ok(valor: Any, esperado: str) -> bool:
    if esperado == "integer":
        return isinstance(valor, int) and not isinstance(valor, bool)
    if esperado == "number":
        return isinstance(valor, (int, float)) and not isinstance(valor, bool)
    tipos = {
        "object": dict,
        "array": list,
        "string": str,
        "boolean": bool,
        "null": type(None),
    }
    tipo = tipos.get(esperado)
    return tipo is not None and isinstance(valor, tipo)


def _nombre_tipo(valor: Any) -> str:
    for nombre, tipo in (
        ("null", type(None)),
        ("boolean", bool),
        ("integer", int),
        ("number", float),
        ("string", str),
        ("array", list),
        ("object", dict),
    ):
        if isinstance(valor, tipo) and not (nombre != "boolean" and isinstance(valor, bool)):
            return nombre
    return type(valor).__name__


def _igual(a: Any, b: Any) -> bool:
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    return a == b


def _texto(valor: Any) -> str:
    return json.dumps(valor, ensure_ascii=False)


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


def revisar_absorcion(raiz: Path, lote: str) -> dict[str, Any]:
    """Informe seco para absorber un lote: no escribe ni borra nada.

    La cobertura se calcula **por fichero**, no solo por el lote: un ROADMAP
    puede haberse importado en varias tandas y la absorción tiene que contar
    todas. Cada viñeta de nivel superior fuera de bloques de código es un
    bloque; las anidadas van con su padre. Se compara además el hash actual
    con el que guardó la procedencia: si el fichero cambió, el informe no es
    seguro y no se propone retirar nada.
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
            "SELECT mi.idea_uid, mi.ruta, mi.desde_linea, mi.hasta_linea, mi.sha256,"
            " mi.estado, mi.lote_id, idea_data.title"
            " FROM migracion_idea mi"
            " JOIN idea_data ON idea_data.uid = mi.idea_uid"
            " WHERE mi.lote_id = ?"
            " ORDER BY mi.ruta, mi.desde_linea, mi.hasta_linea",
            (lote,),
        ).fetchall()
        if not filas:
            return _informe_absorcion_vacio(
                raiz, lote, str(cabecera["plan_sha256"]), "el lote no tiene ideas"
            )

        por_ruta: dict[str, list[dict[str, Any]]] = {}
        for fila in filas:
            por_ruta.setdefault(str(fila["ruta"]), []).append(dict(fila))

        marcas = ",".join("?" for _ in por_ruta)
        todas = conn.execute(
            "SELECT mi.idea_uid, mi.ruta, mi.desde_linea, mi.hasta_linea, mi.sha256,"
            " mi.estado, mi.lote_id, idea_data.title"
            " FROM migracion_idea mi"
            " JOIN idea_data ON idea_data.uid = mi.idea_uid"
            f" WHERE mi.ruta IN ({marcas})"
            " ORDER BY mi.ruta, mi.desde_linea, mi.hasta_linea",
            tuple(por_ruta),
        ).fetchall()

        todas_por_ruta: dict[str, list[dict[str, Any]]] = {}
        for fila in todas:
            todas_por_ruta.setdefault(str(fila["ruta"]), []).append(dict(fila))

        archivos = [
            _informe_archivo(raiz, lote, ruta, por_ruta[ruta], todas_por_ruta[ruta])
            for ruta in sorted(por_ruta)
        ]

    errores = [error for archivo in archivos for error in archivo["errores"]]
    avisos = [aviso for archivo in archivos for aviso in archivo["avisos"]]
    huecos = [hueco for archivo in archivos for hueco in archivo["sin_migrar"]]
    ok = bool(archivos) and not errores and not huecos
    resumen = {
        "archivos": len(archivos),
        "ideas_lote": len({str(fila["idea_uid"]) for fila in filas}),
        "ideas_fichero": sum(archivo["ideas_fichero"] for archivo in archivos),
        "bloques": sum(archivo["bloques"] for archivo in archivos),
        "cubiertos": sum(archivo["cubiertos"] for archivo in archivos),
        "sin_migrar": len(huecos),
    }
    return {
        "repo": str(raiz),
        "lote": lote,
        "plan_sha256": str(cabecera["plan_sha256"]),
        "dry_run": True,
        "ok": ok,
        "archivos": archivos,
        "retirar": [archivo["ruta"] for archivo in archivos] if ok else [],
        "errores": errores,
        "avisos": avisos,
        "resumen": resumen,
    }


def _informe_absorcion_vacio(raiz: Path, lote: str, plan_sha256: str, error: str) -> dict[str, Any]:
    return {
        "repo": str(raiz),
        "lote": lote,
        "plan_sha256": plan_sha256,
        "dry_run": True,
        "ok": False,
        "archivos": [],
        "retirar": [],
        "errores": [error],
        "avisos": [],
        "resumen": {
            "archivos": 0,
            "ideas_lote": 0,
            "ideas_fichero": 0,
            "bloques": 0,
            "cubiertos": 0,
            "sin_migrar": 0,
        },
    }


def _informe_archivo(
    raiz: Path,
    lote: str,
    ruta: str,
    filas_lote: list[dict[str, Any]],
    filas_todas: list[dict[str, Any]],
) -> dict[str, Any]:
    """Cobertura y plan de copia/stub de un fichero, sin tocar el disco."""
    errores: list[str] = []
    avisos: list[str] = []
    relativa = Path(ruta)
    ideas_lote = len({str(fila["idea_uid"]) for fila in filas_lote})
    ideas_fichero = len({str(fila["idea_uid"]) for fila in filas_todas})
    lotes = sorted({str(fila["lote_id"]) for fila in filas_todas})
    carriles: dict[str, int] = {}
    for fila in filas_lote:
        estado = str(fila["estado"])
        carriles[estado] = carriles.get(estado, 0) + 1

    informe: dict[str, Any] = {
        "ruta": ruta,
        "ideas_lote": ideas_lote,
        "ideas_fichero": ideas_fichero,
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
        "copia": None,
        "stub": None,
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
        avisos.append(f"{ruta}: hay rangos de procedencia solapados")

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

    copia = Path(EUI_DIR) / "migracion" / lote / relativa
    informe["copia"] = {
        "destino": copia.as_posix(),
        "sha256": sha_actual,
        "bytes": len(crudo),
    }
    if _es_roadmap(ruta):
        stub = _stub_roadmap(ruta, ideas_fichero, len(lotes), copia.as_posix())
        informe["stub"] = {
            "ruta": ruta,
            "contenido": stub,
            "bytes": len(stub.encode("utf-8")),
        }
    return informe


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
        (int(fila["desde_linea"]), int(fila["hasta_linea"]), str(fila["idea_uid"]))
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
                    "ideas": [uid, otro_uid],
                }
            )
            if len(encontrados) >= 20:
                return encontrados
    return encontrados


def _bloques_markdown(texto: str) -> list[dict[str, Any]]:
    """Viñetas de nivel superior fuera de frontmatter y bloques de código."""
    bloques: list[dict[str, Any]] = []
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
        sangria = len(coincidencia.group(1).replace("\t", "    "))
        if sangria:
            continue
        resto = coincidencia.group(2).strip()
        if resto in {"---", "***"}:
            continue
        bloques.append({"linea": indice + 1, "texto": resto[:160]})
    return bloques


def _es_roadmap(ruta: str) -> bool:
    return Path(ruta).name.casefold() in {"roadmap.md", "roadmap.markdown"}


def _stub_roadmap(ruta: str, ideas: int, lotes: int, copia: str) -> str:
    return (
        f"# {Path(ruta).stem}\n\n"
        "Este documento se absorbió en Events UI; el mapa es la fuente de verdad.\n\n"
        f"- Ideas: {ideas}\n"
        f"- Lotes: {lotes}\n"
        f"- Copia: `{copia}`\n\n"
        "Abre el mapa en Events UI o con `eui idea list`.\n"
    )
