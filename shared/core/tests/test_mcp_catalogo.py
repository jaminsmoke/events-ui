"""El catálogo MCP es la única declaración de cada herramienta.

Antes había tres: el argparse del CLI, el argv de `_orden` y el JSON Schema de
`_esquema`. Ahora `_CATALOGO` declara los campos una vez y las dos cosas se
derivan de él. Esta prueba recorre el catálogo entero y lo contrasta con el
parser real del CLI, que es el que ejecuta la llamada.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from events_core import cli, mcp_servidor

EJEMPLOS = {"uid": "0123", "plan": "plan.json", "lote": "lote.json", "fichero": "fases.json"}


def _valor(nombre: str, campo: Any) -> Any:  # noqa: ANN401
    """Un valor válido del tipo del campo, para armar una llamada mínima."""
    if campo.pareja is not None:
        return True
    if campo.tipo == "integer":
        return campo.minimo if campo.minimo is not None else 1
    if campo.tipo == "boolean":
        return True
    if campo.tipo == "array":
        if campo.elemento == "object":
            return [{"titulo": "Una", "requisitos": [{"titulo": "Criterio"}]}]
        return ["uno"]
    if campo.opciones:
        return campo.opciones[0]
    return EJEMPLOS.get(nombre, "x")


def _argumentos(herramienta: Any) -> dict[str, Any]:  # noqa: ANN401
    """Una llamada con todos los campos: así se ejerce cada rama del argv."""
    return {nombre: _valor(nombre, campo) for nombre, campo in herramienta.campos.items()}


@pytest.mark.parametrize("herramienta", mcp_servidor._CATALOGO, ids=lambda h: h.nombre)
def test_el_argv_del_catalogo_lo_acepta_el_cli(herramienta: Any) -> None:  # noqa: ANN401
    """Lo que el catálogo genera tiene que parsear el CLI que lo ejecuta."""
    argv, temporal = mcp_servidor._orden(herramienta.nombre, _argumentos(herramienta))
    try:
        cli._parser().parse_args(argv)
    finally:
        if temporal is not None:
            Path(temporal).unlink(missing_ok=True)


@pytest.mark.parametrize("herramienta", mcp_servidor._CATALOGO, ids=lambda h: h.nombre)
def test_el_esquema_sale_de_los_campos(herramienta: Any) -> None:  # noqa: ANN401
    esquema = mcp_servidor._esquema(herramienta)

    assert set(esquema["properties"]) == set(herramienta.campos)
    assert esquema["additionalProperties"] is False
    assert esquema.get("required", []) == [
        nombre for nombre, campo in herramienta.campos.items() if campo.requerido
    ]


def test_lo_anunciado_sale_del_catalogo() -> None:
    """`tools/list` enseña el catálogo, y cada herramienta tiene título y salida."""
    lectura = [h.nombre for h in mcp_servidor._CATALOGO if not h.escritura]
    escritura = [h.nombre for h in mcp_servidor._CATALOGO if h.escritura]

    assert [t["name"] for t in mcp_servidor._lista_herramientas(False, {})] == lectura
    assert [t["name"] for t in mcp_servidor._lista_herramientas(True, {})] == lectura + escritura
    assert set(mcp_servidor._SALIDAS) == set(mcp_servidor.HERRAMIENTAS)
    assert all(
        t["annotations"]["title"] != t["name"] for t in mcp_servidor._lista_herramientas(True)
    )
