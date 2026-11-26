"""Las listas que deben coincidir, a un solo sitio y comprobadas.

`check:puerto` protege el número del puerto; las duplicaciones 19 y 20
(ficheros versionados y estados por carril) ya divergieron una vez. Aquí se
comparan las listas que el contrato publica como `Literal` —typing no acepta
una tupla— con el modelo, y las que la UI declara para pintar el mapa. Si una
se queda atrás, `check` falla antes de que lo haga un PATCH o un release.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from events_core import cli, contrato
from events_core.items.modelo import estados

RAIZ = Path(__file__).resolve().parents[3]
CARRILES = RAIZ / "packages/ui/src/mapa/carriles.ts"


def _carriles() -> str:
    return CARRILES.read_text(encoding="utf-8")


def test_el_contrato_publica_los_estados_del_modelo() -> None:
    assert get_args(contrato.Status) == estados.ESTADOS


def test_el_contrato_publica_los_grupos_del_modelo() -> None:
    assert get_args(contrato.Grupo) == estados.GRUPOS


def test_los_estados_de_fase_coinciden() -> None:
    assert get_args(contrato.FaseEstado) == estados.FASE_ESTADOS


def test_la_ui_pinta_los_mismos_estados() -> None:
    tabla = re.search(r"CARRIL_DE_ESTADO[^=]*= \{(.*?)\n\};", _carriles(), re.S)
    assert tabla is not None, "carriles.ts ya no declara CARRIL_DE_ESTADO"
    assert tuple(re.findall(r"^  ([a-z_]+):", tabla.group(1), re.M)) == estados.ESTADOS


def test_la_ui_valida_los_mismos_grupos() -> None:
    bloque = re.search(r"export const GRUPOS = \[(.*?)\] as const;", _carriles(), re.S)
    assert bloque is not None, "carriles.ts ya no declara GRUPOS"
    assert tuple(re.findall(r'"([a-z_]+)"', bloque.group(1))) == estados.GRUPOS


def test_el_cli_no_repite_la_lista() -> None:
    """Sale del modelo: una copia volvería a derivar como la de 19 y 20."""
    assert cli.ESTADOS is estados.ESTADOS
    fuente = Path(str(cli.__file__)).read_text(encoding="utf-8")
    assert "\nESTADOS = (\n" not in fuente
