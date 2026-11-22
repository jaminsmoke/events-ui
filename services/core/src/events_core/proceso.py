"""Procesos hijos sin abrir consola en Windows.

El sidecar va empaquetado con PyInstaller `--windowed` (subsistema GUI) para
no enseñar terminal al arrancar. En ese modo, cada `subprocess.run` de un
binario de consola (`git.exe`) crea una ventana nueva que parpadea y se
cierra: el sondeo de `/proyecciones/repo` lanza varios `git` cada pocos
segundos y el escritorio se llena de flashes.

`CREATE_NO_WINDOW` evita esa asignación de consola. En Unix no aplica y se
omite. Si el llamador ya pasa `creationflags`, se respeta.
"""

from __future__ import annotations

import subprocess
import sys
from typing import Any

# 0x08000000: no crear consola aunque el hijo sea un binario de consola.
_SIN_VENTANA = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[Any]:
    """Igual que `subprocess.run`, ocultando la consola del hijo en Windows."""
    if _SIN_VENTANA and "creationflags" not in kwargs:
        kwargs["creationflags"] = _SIN_VENTANA
    return subprocess.run(args, **kwargs)
