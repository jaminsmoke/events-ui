"""Punto de entrada del binario `eui` (PyInstaller).

`cli.py` usa imports relativos porque vive dentro del paquete. PyInstaller
ejecuta el fichero de entrada como `__main__`, sin paquete, así que este
envoltorio importa el paquete por su nombre absoluto y delega en el CLI.
"""

from __future__ import annotations

from events_core import cli


def main() -> int:
    return cli.main()


if __name__ == "__main__":
    raise SystemExit(main())
