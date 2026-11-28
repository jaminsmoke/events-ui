"""El argv del CLI para cada herramienta, derivado del catálogo."""

from __future__ import annotations

import json
import tempfile
from typing import Any

from .catalogo import _COMUNES, HERRAMIENTAS

# Campos que no son de una herramienta pero sí de otra: el error dice dónde
# están, en vez de dejar al cliente adivinando qué herramienta los acepta.
_SUGERENCIAS = {
    "fases": "item_fases",
    "fichero": "item_fases",
    "status": "item_move",
    "fase": "item_requisito",
    "requisito": "item_requisito",
    "hecho": "item_requisito",
    "limpiar_tags": "item_edit",
    "limpiar_dependencias": "item_edit",
    "lote": "migrate_undo",
    "plan": "migrate_check",
}

_TIPOS = {"string": str, "integer": int, "boolean": bool, "array": list, "object": dict}


def _sugerencia(nombre: str, campo: str) -> str | None:
    """La herramienta que sí acepta `campo`, si hay una."""
    directa = _SUGERENCIAS.get(campo)
    if directa is not None and directa != nombre:
        return directa
    for otra, herramienta in HERRAMIENTAS.items():
        if otra != nombre and campo in herramienta.campos:
            return otra
    return None


def _validar_valor(campo: str, valor: Any, esquema: dict[str, Any]) -> str | None:
    """Un valor contra su trozo de `inputSchema`; `None` si encaja.

    Solo lo que usan los esquemas de este servidor: tipo, `enum`, `minimum`,
    `maximum` y el tipo de los elementos de un array. Un `bool` no vale como
    entero aunque en Python sea `int`.
    """
    tipo = esquema.get("type")
    if tipo == "integer":
        if isinstance(valor, bool) or not isinstance(valor, int):
            return f"`{campo}` tiene que ser un entero"
    else:
        esperado = _TIPOS.get(tipo)
        if esperado is not None and not isinstance(valor, esperado):
            return f"`{campo}` tiene que ser de tipo {tipo}"
    opciones = esquema.get("enum")
    if opciones is not None and valor not in opciones:
        return f"`{campo}` tiene que ser uno de {', '.join(str(o) for o in opciones)}"
    if tipo == "integer":
        if "minimum" in esquema and valor < esquema["minimum"]:
            return f"`{campo}` no puede ser menor que {esquema['minimum']}"
        if "maximum" in esquema and valor > esquema["maximum"]:
            return f"`{campo}` no puede ser mayor que {esquema['maximum']}"
    if tipo == "array":
        items = esquema.get("items") or {}
        for indice, elemento in enumerate(valor):
            problema = _validar_valor(f"{campo}[{indice}]", elemento, items)
            if problema is not None:
                return problema
    return None


def _validar_entrada(nombre: str, argumentos: dict[str, Any]) -> str | None:
    """La entrada contra el `inputSchema` de la herramienta; `None` si vale.

    `tools/list` anuncia `additionalProperties: false` y `required`: esto es lo
    que cumple el anuncio. Se llama antes de `_orden`, así que una clave
    desconocida no llega a descartarse en silencio.
    """
    herramienta = HERRAMIENTAS[nombre]
    campos = herramienta.campos
    for campo in argumentos:
        if campo not in campos:
            otra = _sugerencia(nombre, campo)
            aviso = f"campo desconocido: {campo}"
            return f"{aviso} (usa {otra})" if otra else aviso
    for campo, definicion in campos.items():
        if definicion.requerido and argumentos.get(campo) is None:
            return f"falta el campo obligatorio: {campo}"
    for campo, valor in argumentos.items():
        problema = _validar_valor(campo, valor, campos[campo].esquema())
        if problema is not None:
            return problema
    return None


def _comunes(argumentos: dict[str, Any], *, con_repo: bool = True) -> list[str]:
    extras: list[str] = []
    if con_repo and argumentos.get("repo"):
        extras += ["--repo", str(argumentos["repo"])]
    if argumentos.get("url"):
        extras += ["--url", str(argumentos["url"])]
    if argumentos.get("port"):
        extras += ["--port", str(int(argumentos["port"]))]
    return extras


def _temporal(datos: Any) -> str:
    """Un JSON en un fichero temporal: es como el CLI recibe listas y objetos."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as fichero:
        json.dump(datos, fichero, ensure_ascii=False)
        return fichero.name


def _orden(nombre: str, a: dict[str, Any]) -> tuple[list[str], str | None]:
    """El argv del CLI para una herramienta; el segundo valor es un temporal.

    Todo sale del catálogo: un posicional ocupa su hueco, una bandera se escribe
    con su valor, un repetible se escribe una vez por elemento, una pareja elige
    su forma según el booleano y lo que no cabe en la línea viaja en un fichero
    que se borra al terminar.
    """
    herramienta = HERRAMIENTAS[nombre]
    argv = [*herramienta.orden]
    temporal: str | None = None

    huecos = sorted(
        {
            campo.posicional
            for clave, campo in herramienta.campos.items()
            if campo.posicional is not None and clave not in _COMUNES
        }
    )
    for hueco in huecos:
        elegido = next(
            (
                (clave, campo)
                for clave, campo in herramienta.campos.items()
                if campo.posicional == hueco and clave not in _COMUNES and a.get(clave) is not None
            ),
            None,
        )
        if elegido is None:
            continue
        clave, campo = elegido
        valor = a[clave]
        if campo.temporal:
            if not isinstance(valor, list):
                raise ValueError(f"`{clave}` tiene que ser una lista")
            argv.append(_temporal(valor))
            temporal = argv[-1]
        else:
            argv.append(str(valor))

    for clave, campo in herramienta.campos.items():
        if clave in _COMUNES or campo.posicional is not None:
            continue
        valor = a.get(clave)
        if campo.omite_si and a.get(campo.omite_si):
            continue
        if campo.pareja is not None:
            if valor:
                argv.append(campo.pareja[0])
            elif campo.pareja[1] is not None:
                argv.append(campo.pareja[1])
            continue
        if valor is None:
            continue
        if campo.bandera is None:
            raise KeyError(f"{nombre}.{clave} no dice cómo viajar al CLI")
        if campo.repetible:
            for elemento in valor:
                argv += [campo.bandera, str(elemento)]
        elif campo.temporal:
            if not isinstance(valor, list):
                raise ValueError(f"`{clave}` tiene que ser una lista")
            argv += [campo.bandera, _temporal(valor)]
            temporal = argv[-1]
        else:
            argv += [campo.bandera, str(valor)]
    if herramienta.nombre == "item_fases" and "fases" not in a and not a.get("fichero"):
        raise ValueError("da `fases` (lista) o `fichero`")

    argv += ["--json"]
    argv += _comunes(a, con_repo=herramienta.con_repo)
    return argv, temporal
