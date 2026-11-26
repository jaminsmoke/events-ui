"""Las listas que deben coincidir, a un solo sitio y comprobadas.

`check:puerto` protege el número del puerto; las duplicaciones 19 y 20
(ficheros versionados y estados por carril) ya divergieron una vez. Aquí se
comparan las listas que el contrato publica como `Literal` —typing no acepta
una tupla— con el modelo del core y con la que usa el CLI.

El lado de la UI no se lee desde aquí: `schema.ts` se genera del contrato y
`check:contract` lo comprueba, y su tabla estado→carril es un
`Record<Status, …>`, así que `tsc` falla si se queda corta. Leer el `.ts` con
expresiones regulares solo añadía fragilidad al reformatear.
"""

from __future__ import annotations

from typing import get_args

from events_core import cli, contrato
from events_core.items.modelo import estados


def test_el_contrato_publica_los_estados_del_modelo() -> None:
    assert get_args(contrato.Status) == estados.ESTADOS


def test_el_contrato_publica_los_grupos_del_modelo() -> None:
    assert get_args(contrato.Grupo) == estados.GRUPOS


def test_los_estados_de_fase_coinciden() -> None:
    assert get_args(contrato.FaseEstado) == estados.FASE_ESTADOS


def test_el_cli_no_repite_la_lista() -> None:
    """Sale del modelo: si se copiara, la tupla no sería la misma y derivaría."""
    assert cli.ESTADOS is estados.ESTADOS
