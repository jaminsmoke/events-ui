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
    """Igual que `subprocess.run`, ocultando la consola del hijo en Windows.

    En modo texto fija UTF-8: los hijos que se leen como texto son Git, que
    emite UTF-8 también en Windows. Sin `encoding`, `subprocess` decodifica con
    la del sistema (cp1252) y los acentos llegan rotos (`Ã¡` por `á`, o una ruta
    que no existe en disco). El `replace` evita que un byte suelto tumbe la
    lectura. Un llamador puede pedir otra cosa y se respeta.
    """
    if _SIN_VENTANA and "creationflags" not in kwargs:
        kwargs["creationflags"] = _SIN_VENTANA
    if (kwargs.get("text") or kwargs.get("universal_newlines")) and "encoding" not in kwargs:
        kwargs["encoding"] = "utf-8"
        kwargs.setdefault("errors", "replace")
    return subprocess.run(args, **kwargs)
