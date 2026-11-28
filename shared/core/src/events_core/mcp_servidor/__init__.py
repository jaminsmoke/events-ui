"""Servidor MCP por stdio: el CLI (`eui`) como herramientas para agentes.

Habla JSON-RPC 2.0 por líneas (el transporte stdio de MCP): una petición por
línea y una respuesta por línea, sin nada más en stdout. No reimplementa el
cliente: cada herramienta arma el argv del CLI y ejecuta `cli.main` capturando
su salida, así que las validaciones, los payloads y los códigos de salida son
los mismos que usa un humano.

El paquete está partido para poder leerlo de arriba abajo:

- `catalogo`: qué herramientas hay, sus campos y el esquema que se anuncia.
- `argv`: cómo viaja cada campo al CLI.
- `servidor`: JSON-RPC, puertas y bucle stdio.

Aquí queda la fachada: `events_core.mcp_servidor` sigue siendo el nombre de
siempre y expone lo mismo (incluidos los privados que consultan las pruebas).
"""

from __future__ import annotations

from typing import Any

from .. import __version__, cli, migracion
from .argv import (
    _comunes,
    _orden,
    _sugerencia,
    _temporal,
    _validar_entrada,
    _validar_valor,
)
from .catalogo import (
    _CATALOGO,
    _SALIDAS,
    HERRAMIENTAS,
    HERRAMIENTAS_ESCRITURA,
    Campo,
    Herramienta,
    _anotaciones,
    _esquema,
    _herramienta_publica,
    _lista_herramientas,
)
from .servidor import (
    INSTRUCCIONES,
    PROTOCOLO,
    PROTOCOLOS,
    URI_ESQUEMA,
    URI_MAPA,
    _cli,
    _ejecutar,
    _error,
    _estructura,
    _ok,
    _puertas_cerradas,
    main,
    permite_escritura,
    servir,
)
from .servidor import manejar as _manejar


def manejar(mensaje: Any, *, permitir_escritura: bool = False) -> dict[str, Any] | None:
    """Una petición JSON-RPC; las puertas se leen de aquí, no del servidor.

    Las pruebas sustituyen `mcp_servidor._puertas_cerradas`, así que la llamada
    tiene que resolver el nombre en este módulo.
    """
    return _manejar(mensaje, permitir_escritura=permitir_escritura, puertas=_puertas_cerradas)


__all__ = [
    "HERRAMIENTAS",
    "HERRAMIENTAS_ESCRITURA",
    "INSTRUCCIONES",
    "PROTOCOLO",
    "PROTOCOLOS",
    "Campo",
    "Herramienta",
    "URI_ESQUEMA",
    "URI_MAPA",
    "__version__",
    "cli",
    "migracion",
    "_CATALOGO",
    "_SALIDAS",
    "_anotaciones",
    "_cli",
    "_comunes",
    "_ejecutar",
    "_error",
    "_esquema",
    "_estructura",
    "_herramienta_publica",
    "_lista_herramientas",
    "_ok",
    "_orden",
    "_puertas_cerradas",
    "_sugerencia",
    "_temporal",
    "_validar_entrada",
    "_validar_valor",
    "main",
    "manejar",
    "permite_escritura",
    "servir",
]
