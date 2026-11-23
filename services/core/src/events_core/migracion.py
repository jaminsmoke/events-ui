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
from contextlib import closing, suppress
from pathlib import Path
from typing import Any

from .db import open_read_only
from .items.base.comun import InvalidInput, escribir_atomico, fecha_iso, now_iso
from .items.base.rutas import EUI_DIR, db_file_for

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
ESQUEMA_PLAN: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:events-ui:plan-migracion:1",
    "title": "Plan de migración de Markdown",
    "description": (
        "Lo que propone el agente antes de tocar el almacén. Cada item cita el "
        "Markdown del que sale (ruta, líneas y sha256). La v3 añade el "
        "manifiesto `documentos` (mapa / referencia / parcial). `check` añade "
        "lo que el esquema no puede comprobar (refs, dependencias, hash, "
        "clasificación y cobertura de bloques) y `apply` lo aplica como un "
        "lote reversible."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": ["version"],
    # `items` es el nombre nuevo; `ideas` el de los planes v1-v3 guardados.
    "anyOf": [{"required": ["items"]}, {"required": ["ideas"]}],
    "properties": {
        "version": {
            "enum": [1, 2, 3],
            "description": (
                "1: solo proposed; 2: destinos, fechas y motivo; "
                "3: manifiesto de documentos (allowlist del mapa)."
            ),
        },
        "items": {
            "type": "array",
            "minItems": 1,
            "items": {"$ref": "#/$defs/work_item"},
        },
        "ideas": {
            "type": "array",
            "minItems": 1,
            "description": "Nombre antiguo de `items`; se acepta al leer planes v1-v3.",
            "items": {"$ref": "#/$defs/work_item"},
        },
        "documentos": {
            "type": "array",
            "minItems": 1,
            "items": {"$ref": "#/$defs/documento"},
            "description": (
                "Obligatorio en version 3. Clasificación de cada Markdown del "
                "plan: allowlist (`mapa`/`parcial`) o `referencia`."
            ),
        },
    },
    "$defs": {
        "ref": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
            "description": "Identificador local del plan; no es un uid del almacén.",
        },
        "documento": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ruta", "clase", "motivo", "destino"],
            "properties": {
                "ruta": {
                    "type": "string",
                    "minLength": 1,
                    "pattern": "^[^\\\\]+$",
                    "description": "Ruta relativa al repo, con `/` y sin `..`.",
                },
                "clase": {
                    "enum": ["mapa", "referencia", "parcial"],
                    "description": (
                        "`mapa` alimenta el mapa entero; `referencia` no crea "
                        "ideas; `parcial` solo los rangos declarados."
                    ),
                },
                "motivo": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Por qué esta clasificación.",
                },
                "destino": {
                    "enum": ["mapa", "referencia"],
                    "description": (
                        "Dónde va el contenido: `mapa` (allowlist) o "
                        "`referencia`. Debe cuadrar con `clase`."
                    ),
                },
                "rangos": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"$ref": "#/$defs/rango"},
                    "description": "Obligatorio con clase `parcial`; 1-based inclusive.",
                },
            },
        },
        "rango": {
            "type": "object",
            "additionalProperties": False,
            "required": ["desde", "hasta"],
            "properties": {
                "desde": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Primera línea del rango (1-based).",
                },
                "hasta": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Última línea del rango (1-based, incluida).",
                },
            },
        },
        "work_item": {
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
                "kind": {"enum": ["work_item", "idea"], "default": "work_item"},
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
                    "description": "Refs de otras items de este plan, nunca uids.",
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


def clasificar(raiz: Path, ruta: str | None = None) -> dict[str, Any]:
    """Propone el manifiesto `documentos` a partir del scan.

    No escribe nada: es la mitad legible de la allowlist. El agente revisa
    clase/motivo/destino, añade `parcial` con rangos si hace falta y lo mete
    en el plan v3. Los nombres típicos de backlog van a `mapa`; README y
    licencias a `referencia`; el resto, a `mapa` si tiene tareas o a
    `referencia` si solo parece documentación.
    """
    informe = escanear(raiz, ruta)
    documentos: list[dict[str, Any]] = []
    for ficha in informe["archivos"]:
        if "error" in ficha:
            continue
        documento = _proponer_documento(ficha)
        if documento is not None:
            documentos.append(documento)
    return {
        "repo": informe["repo"],
        "ruta": informe["ruta"],
        "documentos": documentos,
        "resumen": {
            "documentos": len(documentos),
            "mapa": sum(1 for doc in documentos if doc["clase"] == "mapa"),
            "referencia": sum(1 for doc in documentos if doc["clase"] == "referencia"),
        },
        "recortado": informe["recortado"],
    }


def _proponer_documento(ficha: dict[str, Any]) -> dict[str, Any] | None:
    """Una entrada del manifiesto a partir de la ficha del scan."""
    ruta = str(ficha.get("ruta") or "")
    if not ruta:
        return None
    stem = Path(ruta).stem.casefold()
    tareas = int((ficha.get("tareas") or {}).get("total") or 0)
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


def _items_del_plan(plan: dict[str, Any]) -> list[Any]:
    """Los ítems del plan: `items` manda y `ideas` es el nombre v1-v3."""
    for clave in ("items", "ideas"):
        valor = plan.get(clave)
        if isinstance(valor, list):
            return valor
    return []


def revisar(raiz: Path, plan: dict[str, Any], *, plan_ruta: str = "plan.json") -> dict[str, Any]:
    """Valida el plan y enseña lo que se crearía, sin escribir nada.

    Primero el esquema; solo si pasa se miran los refs, las dependencias, los
    ciclos y cada origen contra el fichero de verdad. Un error de esquema corta
    aquí: seguir con un plan mal formado solo añadiría ruido.
    """
    raiz = raiz.resolve()
    items = _items_del_plan(plan)
    resumen = _resumen(items)
    errores = validar_esquema(plan)
    if errores:
        return {
            "ok": False,
            "repo": str(raiz),
            "plan": plan_ruta,
            "crear": [],
            "documentos": [],
            "errores": errores,
            "resumen": resumen,
        }

    errores = _errores_de_destino(plan)
    vistos: dict[str, int] = {}
    for indice, item in enumerate(items):
        ref = item["ref"]
        if ref in vistos:
            errores.append(
                f"ideas[{indice}].ref: repetida ({ref!r}); ya estaba en items[{vistos[ref]}]"
            )
        else:
            vistos[ref] = indice

    for indice, item in enumerate(items):
        for posicion, dependencia in enumerate(item.get("depende_de") or []):
            ruta_dep = f"ideas[{indice}].depende_de[{posicion}]"
            if dependencia == item["ref"]:
                errores.append(f"{ruta_dep}: se apunta a sí misma ({dependencia!r})")
            elif dependencia not in vistos:
                errores.append(f"{ruta_dep}: no existe el ítem {dependencia!r}")

    grafo = {
        item["ref"]: [dep for dep in item.get("depende_de") or [] if dep in vistos]
        for item in items
    }
    for ciclo in _ciclos(grafo):
        errores.append(f"dependencia circular: {' → '.join(ciclo)}")

    errores.extend(_errores_de_origen(raiz, items))
    errores.extend(_errores_de_documentos(raiz, plan, items))

    titulos: dict[tuple[str, str], int] = {}
    for indice, item in enumerate(items):
        clave = (item["title"].strip().casefold(), item["origen"]["ruta"])
        if clave in titulos:
            errores.append(
                f"ideas[{indice}]: «{item['title']}» ya sale en items[{titulos[clave]}] "
                "del mismo fichero"
            )
        else:
            titulos[clave] = indice

    crear = [
        {
            "ref": item["ref"],
            "title": item["title"],
            "status": item.get("status") or "proposed",
            "origen": item["origen"],
        }
        for item in items
    ]
    return {
        "ok": not errores,
        "repo": str(raiz),
        "plan": plan_ruta,
        "crear": crear,
        "documentos": [
            {
                "ruta": doc["ruta"],
                "clase": doc["clase"],
                "destino": doc["destino"],
            }
            for doc in (plan.get("documentos") or [])
            if isinstance(doc, dict) and "ruta" in doc and "clase" in doc
        ],
        "errores": errores,
        "resumen": resumen,
    }


def _errores_de_destino(plan: dict[str, Any]) -> list[str]:
    """Lo que el esquema no puede decir de los carriles y sus datos."""
    errores: list[str] = []
    version = plan.get("version")
    documentos = plan.get("documentos")
    if version == 3:
        if not isinstance(documentos, list) or not documentos:
            errores.append("documentos: la versión 3 exige el manifiesto de documentos")
    elif documentos is not None:
        errores.append("documentos: solo vale con version 3")
    for indice, item in enumerate(_items_del_plan(plan)):
        if not isinstance(item, dict):
            continue
        estado = item.get("status") or "proposed"
        if version == 1 and estado != "proposed":
            errores.append(
                f"ideas[{indice}].status: la versión 1 solo admite proposed; usa version 2"
            )
        if estado != "proposed" and item.get("fases"):
            errores.append(f"ideas[{indice}].fases: solo valen con status proposed")
        if estado == "rejected" and not str(item.get("motivo") or "").strip():
            errores.append(f"ideas[{indice}].motivo: rejected exige un motivo")
        fecha = item.get("fecha")
        if fecha is not None:
            if estado not in ("historial", "rejected"):
                errores.append(f"ideas[{indice}].fecha: solo vale para historial o rejected")
                continue
            try:
                fecha_iso(str(fecha))
            except InvalidInput as exc:
                errores.append(f"ideas[{indice}].fecha: {exc}")
    return errores


def _errores_de_documentos(
    raiz: Path, plan: dict[str, Any], items: list[dict[str, Any]]
) -> list[str]:
    """Allowlist del mapa, cobertura de bloques y rangos de los parciales.

    Solo corre con version 3 (el manifiesto ya pasó el esquema). Las items solo
    pueden salir de `mapa`/`parcial`; en `mapa` todos los bloques accionables
    tienen que estar cubiertos; en `parcial` hace falta `rangos` y los ítems
    (y los bloques dentro de esos rangos) tienen que caer dentro.
    """
    if plan.get("version") != 3:
        return []
    documentos = plan.get("documentos")
    if not isinstance(documentos, list):
        return []

    errores: list[str] = []
    por_ruta: dict[str, dict[str, Any]] = {}
    for indice, documento in enumerate(documentos):
        if not isinstance(documento, dict):
            continue
        prefijo = f"documentos[{indice}]"
        ruta = str(documento.get("ruta") or "")
        clase = documento.get("clase")
        destino = documento.get("destino")
        if ruta in por_ruta:
            errores.append(f"{prefijo}.ruta: repetida ({ruta!r})")
            continue
        por_ruta[ruta] = documento

        if clase == "referencia" and destino != "referencia":
            errores.append(f"{prefijo}.destino: clase referencia exige destino referencia")
        if clase in ("mapa", "parcial") and destino != "mapa":
            errores.append(f"{prefijo}.destino: clase {clase} exige destino mapa")

        rangos = documento.get("rangos")
        if clase == "parcial":
            if not isinstance(rangos, list) or not rangos:
                errores.append(f"{prefijo}.rangos: parcial exige al menos un rango")
            else:
                for posicion, rango in enumerate(rangos):
                    if not isinstance(rango, dict):
                        continue
                    desde = rango.get("desde")
                    hasta = rango.get("hasta")
                    if isinstance(desde, int) and isinstance(hasta, int) and desde > hasta:
                        errores.append(
                            f"{prefijo}.rangos[{posicion}]: desde {desde} va después "
                            f"de hasta {hasta}"
                        )
        elif rangos is not None:
            errores.append(f"{prefijo}.rangos: solo vale con clase parcial")

        try:
            archivo = resolver(raiz, ruta)
        except (InvalidInput, FileNotFoundError) as exc:
            errores.append(f"{prefijo}.ruta: {exc}")
            continue
        if archivo.is_dir():
            errores.append(f"{prefijo}.ruta: {ruta!r} es una carpeta")

    allowlist = {
        ruta
        for ruta, documento in por_ruta.items()
        if documento.get("clase") in ("mapa", "parcial")
    }
    ideas_por_ruta: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for indice, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("origen"), dict):
            continue
        ruta = str(item["origen"].get("ruta") or "")
        ideas_por_ruta.setdefault(ruta, []).append((indice, item))
        if ruta not in por_ruta:
            errores.append(
                f"ideas[{indice}].origen.ruta: {ruta!r} no está en documentos "
                "(hay que clasificarla)"
            )
        elif ruta not in allowlist:
            errores.append(
                f"ideas[{indice}].origen.ruta: {ruta!r} es referencia; no puede alimentar el mapa"
            )

    for ruta, documento in por_ruta.items():
        clase = documento.get("clase")
        if clase not in ("mapa", "parcial"):
            continue
        try:
            archivo = resolver(raiz, ruta)
        except (InvalidInput, FileNotFoundError):
            continue
        if not archivo.is_file():
            continue
        try:
            texto = archivo.read_text(encoding="utf-8")
        except OSError as exc:
            errores.append(f"documentos ({ruta!r}): no se pudo leer: {exc}")
            continue
        bloques = _bloques_markdown(texto)
        origenes = [
            (
                int(item["origen"]["desde_linea"]),
                int(item["origen"]["hasta_linea"]),
            )
            for _indice, item in ideas_por_ruta.get(ruta, [])
            if isinstance(item.get("origen"), dict)
        ]
        if clase == "parcial":
            rangos = [
                (int(rango["desde"]), int(rango["hasta"]))
                for rango in (documento.get("rangos") or [])
                if isinstance(rango, dict)
                and isinstance(rango.get("desde"), int)
                and isinstance(rango.get("hasta"), int)
            ]
            fusion = _fusionar(sorted(rangos))
            for indice, item in ideas_por_ruta.get(ruta, []):
                desde = int(item["origen"]["desde_linea"])
                hasta = int(item["origen"]["hasta_linea"])
                if not any(r_desde <= desde and hasta <= r_hasta for r_desde, r_hasta in fusion):
                    errores.append(
                        f"ideas[{indice}].origen: fuera de los rangos parciales de {ruta!r}"
                    )
            bloques = [
                bloque
                for bloque in bloques
                if any(desde <= bloque["linea"] <= hasta for desde, hasta in fusion)
            ]

        sin_clasificar = [
            bloque
            for bloque in bloques
            if not any(desde <= bloque["linea"] <= hasta for desde, hasta in origenes)
        ]
        if sin_clasificar:
            muestra = ", ".join(
                f"L{bloque['linea']} «{bloque['texto']}»" for bloque in sin_clasificar[:5]
            )
            errores.append(
                f"documentos ({ruta!r}): quedan {len(sin_clasificar)} bloques sin "
                f"clasificar: {muestra}"
            )
    return errores


def _resumen(items: list[Any]) -> dict[str, int]:
    archivos = {
        item["origen"]["ruta"]
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("origen"), dict)
        and isinstance(item["origen"].get("ruta"), str)
    }
    return {"items": len(items), "archivos": len(archivos), "refs": len(items)}


def _errores_de_origen(raiz: Path, items: list[dict[str, Any]]) -> list[str]:
    """Cada origen tiene que seguir siendo el fichero del scan."""
    errores: list[str] = []
    for indice, item in enumerate(items):
        origen = item["origen"]
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


SECCIONES_EXPORT = (
    ("draft", "Entrada"),
    ("proposed", "Backlog"),
    ("roadmap", "Roadmap"),
    ("verificacion", "Verificación"),
    ("revision_aprobada", "Revisión"),
    ("historial", "Hecho"),
    ("rejected", "Descartado"),
)


def _ruta_en_repo(raiz: Path, ruta: str) -> Path:
    destino = (raiz / ruta).resolve()
    if not destino.is_relative_to(raiz):
        raise InvalidInput(f"ruta fuera del repo: {ruta!r}")
    return destino


def confirmar_absorcion(raiz: Path, lote: str, *, parcial: bool = False) -> dict[str, Any]:
    """Copia los documentos y retira (total) o reescribe con marcadores (parcial).

    La validación es la misma que la del dry-run. Primero copia y verifica
    todos los ficheros, después escribe el manifiesto y solo entonces toca los
    originales. Si algo falla, deja los documentos como estaban. En modo total
    la vista posterior se genera con `migrate export`; en parcial el origen
    sigue en el repo con marcadores visibles `[eui:<uid>]`.
    """
    from .items.migracion import escribir_absorcion, leer_absorcion

    raiz = raiz.resolve()
    informe = revisar_absorcion(raiz, lote, parcial=parcial)
    if not informe["ok"]:
        raise InvalidInput("; ".join(informe["errores"]) or "la absorción no está completa")
    if parcial:
        if not informe["reescribir"]:
            raise InvalidInput("no hay documentos que reescribir")
    elif not informe["retirar"]:
        raise InvalidInput("no hay documentos que absorber")
    if leer_absorcion(str(raiz), lote) is not None:
        raise InvalidInput(f"el lote {lote} ya está absorbido")

    originales: dict[str, bytes] = {}
    reescritos: dict[str, bytes] = {}
    copias: list[Path] = []
    archivos: list[dict[str, Any]] = []
    manifiesto_ruta = raiz / ".EUI" / "migracion" / lote / "absorcion.json"
    try:
        for archivo in informe["archivos"]:
            ruta = str(archivo["ruta"])
            origen = _ruta_en_repo(raiz, ruta)
            crudo = origen.read_bytes()
            sha = hashlib.sha256(crudo).hexdigest()
            if sha != archivo["hash_actual"]:
                raise InvalidInput(f"{ruta}: cambió entre la revisión y la copia")

            copia_rel = str(archivo["copia"]["destino"])
            copia = _ruta_en_repo(raiz, copia_rel)
            escribir_atomico(copia, crudo)
            if hashlib.sha256(copia.read_bytes()).hexdigest() != sha:
                raise InvalidInput(f"{ruta}: la copia no coincide con el original")

            originales[ruta] = crudo
            copias.append(copia)
            entrada: dict[str, Any] = {
                "ruta": ruta,
                "copia": copia_rel,
                "sha256_origen": sha,
                "sha256_copia": sha,
            }
            if parcial:
                texto = crudo.decode("utf-8-sig")
                reescrito = _aplicar_marcadores(texto, archivo["marcadores"])
                reescrito_bytes = reescrito.encode("utf-8")
                reescritos[ruta] = reescrito_bytes
                entrada["sha256_stub"] = hashlib.sha256(reescrito_bytes).hexdigest()
                entrada["marcadores"] = archivo["marcadores"]
                entrada["modo"] = "parcial"
            archivos.append(entrada)

        manifiesto = {
            "version": 1,
            "lote": lote,
            "modo": "parcial" if parcial else "total",
            "absorbido_at": now_iso(),
            "estado": "copiado",
            "archivos": archivos,
        }
        escribir_absorcion(str(raiz), lote, manifiesto)
        manifiesto_ruta = raiz / ".EUI" / "migracion" / lote / "absorcion.json"

        if parcial:
            for ruta, contenido in reescritos.items():
                escribir_atomico(_ruta_en_repo(raiz, ruta), contenido)
        else:
            for archivo in informe["archivos"]:
                _ruta_en_repo(raiz, str(archivo["ruta"])).unlink()

        manifiesto["estado"] = "absorbido"
        escribir_absorcion(str(raiz), lote, manifiesto)
    except Exception:
        for ruta, crudo in originales.items():
            with suppress(OSError):
                escribir_atomico(_ruta_en_repo(raiz, ruta), crudo)
        for copia in copias:
            copia.unlink(missing_ok=True)
        manifiesto_ruta.unlink(missing_ok=True)
        raise

    return {
        **informe,
        "dry_run": False,
        "absorbido": True,
        "ok": True,
        "manifest": f".EUI/migracion/{lote}/absorcion.json",
        "archivos": [
            {
                **archivo,
                "absorbido": True,
            }
            for archivo in informe["archivos"]
        ],
    }


def listar_documentos_absorbidos(raiz: Path) -> list[dict[str, Any]]:
    """Los documentos que ya solo viven en Events UI, ordenados por ruta.

    Se leen los manifiestos de `.EUI/migracion/<lote>/absorcion.json`, no el
    filesystem del repo: el origen puede haberse retirado. Si una ruta aparece
    en varios lotes, se queda el manifiesto más reciente.
    """
    from .items.migracion import leer_absorcion

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
