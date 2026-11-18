"""Punto de entrada del sidecar empaquetado (PyInstaller, F3).

El binario `events-core` que Tauri arranca es esto congelado: reutiliza
`serve.main`, que ya vigila el puerto y escucha en 127.0.0.1:8765. El import
directo de `events_core.main` es a propósito: PyInstaller solo ve lo que se
importa, y el `uvicorn.run("events_core.main:app")` de `serve` llega por
cadena —con esto, el paquete entra sí o sí en el bundle.
"""

from __future__ import annotations

# Import absoluto, no relativo: PyInstaller ejecuta este fichero como módulo
# suelto (`__main__` sin paquete) y `from .import` revienta con
# "attempted relative import with no known parent package".
from events_core import serve
from events_core.main import app  # noqa: F401  (el import es para el análisis de PyInstaller)


def main() -> int:
    return serve.main()


if __name__ == "__main__":
    raise SystemExit(main())
