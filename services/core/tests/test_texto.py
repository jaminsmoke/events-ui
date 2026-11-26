"""El código del core se guarda en UTF-8: la prosa no lleva acentos rotos.

Un guardado en cp1252 deja `Ã³` donde había `ó`. La prueba recorre las fuentes
de producción y solo admite el mojibake entre comillas o backticks, donde es un
ejemplo a propósito: `proceso.py` documenta justo ese fallo.
"""

from __future__ import annotations

import re
from pathlib import Path

import events_core

FUENTES = Path(str(events_core.__file__)).parent
_EJEMPLO = re.compile(r"`[^`]*`|\"[^\"]*\"|'[^']*'")


def test_la_prosa_del_core_no_tiene_mojibake() -> None:
    rotas: list[str] = []
    for ruta in sorted(FUENTES.rglob("*.py")):
        for numero, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
            if "Ã" not in linea and "Â" not in linea:
                continue
            prosa = _EJEMPLO.sub("", linea)
            if "Ã" in prosa or "Â" in prosa:
                rotas.append(f"{ruta.relative_to(FUENTES)}:{numero}")

    assert rotas == []
