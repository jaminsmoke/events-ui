"""El plan de migración: leerlo, hashearlo y validarlo contra el esquema."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .esquema import ESQUEMA_PLAN


class PlanInvalido(ValueError):
    """El plan no se puede leer o no es un objeto JSON."""


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
    `minLength`, `pattern`, `minimum` y `anyOf` (basta una rama). Así el
    contrato publicado y lo que `check` acepta no pueden separarse.
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


def _validar(
    valor: Any, nodo: dict[str, Any], raiz: dict[str, Any], ruta: str, errores: list[str]
) -> None:
    if "$ref" in nodo:
        nodo = _resolver_ref(raiz, nodo["$ref"])

    opciones = nodo.get("anyOf")
    if isinstance(opciones, list) and not any(
        not _errores_de_rama(valor, opcion, raiz, ruta) for opcion in opciones
    ):
        errores.append(f"{ruta}: no encaja en ninguna de las {len(opciones)} formas posibles")

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


def _errores_de_rama(
    valor: Any, nodo: dict[str, Any], raiz: dict[str, Any], ruta: str
) -> list[str]:
    """Los errores de una rama de `anyOf`, aparte: si una pasa, la unión pasa."""
    errores: list[str] = []
    _validar(valor, nodo, raiz, ruta, errores)
    return errores


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
