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

    errores = []
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
        {"ref": idea["ref"], "title": idea["title"], "origen": idea["origen"]} for idea in ideas
    ]
    return {
        "ok": not errores,
        "repo": str(raiz),
        "plan": plan_ruta,
        "crear": crear,
        "errores": errores,
        "resumen": resumen,
    }


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
