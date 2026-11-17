"""Arranque en desarrollo del core, con el puerto vigilado.

Existe por un fallo real: en Windows, dos `uvicorn --reload` del mismo puerto pueden
quedarse escuchando a la vez (asyncio activa `SO_REUSEADDR`), y el sistema reparte las
peticiones entre procesos con código distinto. El síntoma desconcierta: se edita el
core, "recarga", y la API sigue respondiendo lo viejo. Aquí se comprueba el puerto
antes de escuchar y se aborta con un mensaje claro en vez de arrancar el enésimo core.
"""

from __future__ import annotations

import socket
import sys

import uvicorn

HOST = "127.0.0.1"
PORT = 8765


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

    uvicorn.run("events_core.main:app", host=HOST, port=PORT, reload=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
