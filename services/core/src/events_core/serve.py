"""Arranque en desarrollo del core, sin reloader y con el puerto vigilado.

Dos fallos reales en Windows, los dos vistos aquí:

- El reloader de uvicorn (`--reload`) usa `multiprocessing` spawn; en esta máquina el
  hijo arranca con otro intérprete, no llega a escuchar y deja el socket heredado: se
  acumulan procesos escuchando en el mismo puerto (asyncio activa `SO_REUSEADDR`) y la
  API sigue respondiendo código viejo tras cada edición.
- Dos cores a la vez reparten peticiones entre procesos distintos, que es peor que un
  error: parece que "no recarga".

Por eso: se comprueba el puerto antes de escuchar y no se recarga solo. Para aplicar
cambios, se para (Ctrl+C) y se vuelve a arrancar; son dos segundos.
"""

from __future__ import annotations

import socket
import sys

import uvicorn

from . import registro

HOST = "127.0.0.1"
PORT = 18765


def puerto_libre(host: str, port: int) -> bool:
    """True si nadie está escuchando ya en `host:port`."""
    with socket.socket() as probe:
        # Sin SO_REUSEADDR: es justo lo que deja a uvicorn duplicar el bind.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def main() -> int:
    if not puerto_libre(HOST, PORT):
        print(
            f"El puerto {PORT} ya está ocupado: hay otro core vivo o un resto.\n"
            f"Mata el viejo antes de arrancar otro (los PIDs, con `netstat -ano | "
            f"findstr :{PORT}`; se matan con `taskkill /PID <pid> /T /F`).",
            file=sys.stderr,
        )
        return 1

    registro.escribir("info", "Core arrancado")
    uvicorn.run("events_core.main:app", host=HOST, port=PORT, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
