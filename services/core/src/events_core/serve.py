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

import os
import socket
import sys
import threading
import time

import uvicorn

from . import registro
from .config import PUERTO_POR_DEFECTO

HOST = "127.0.0.1"


def _puerto_de_entorno() -> int:
    """El puerto del core: `EUI_PORT` si trae uno válido, si no el de siempre.

    La app, el dev y los clientes hablan en el puerto de `puerto.json`; el
    override existe para
    arrancar un core de prueba en un puerto libre sin tocar el de verdad (la
    prueba en frío del sidecar lo usa cuando la app abierta tiene ese puerto).
    """
    crudo = os.environ.get("EUI_PORT", "").strip()
    if not crudo:
        return PUERTO_POR_DEFECTO
    try:
        puerto = int(crudo)
    except ValueError:
        return PUERTO_POR_DEFECTO
    return puerto if 1 <= puerto <= 65535 else PUERTO_POR_DEFECTO


PORT = _puerto_de_entorno()


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
    minutos = _minutos_de_inactividad()
    if minutos:
        threading.Thread(target=_vigilar_inactividad, args=(minutos,), daemon=True).start()
    uvicorn.run("events_core.main:app", host=HOST, port=PORT, reload=False)
    return 0


def _minutos_de_inactividad() -> float:
    """`EUI_IDLE_MINUTES` (lo pone `eui web`); 0 si no hay apagado por inactividad."""
    try:
        return max(0.0, float(os.environ.get("EUI_IDLE_MINUTES", "0")))
    except ValueError:
        return 0.0


def _vigilar_inactividad(minutos: float) -> None:
    """Para el core cuando lleva `minutos` sin peticiones de API.

    Sin clientes el proceso no debe quedarse vivo: `eui web` lo vuelve a encender
    en la siguiente llamada. El corte usa `os._exit` porque uvicorn no expone un
    apagado limpio desde un hilo; la base de datos no tiene escrituras pendientes
    en este punto, cada petición confirma las suyas.
    """
    from . import main  # noqa: PLC0415 (import tardío: `main` ya está cargado por uvicorn)

    limite = minutos * 60
    while True:
        time.sleep(15)
        if time.monotonic() - main.ULTIMA_ACTIVIDAD[0] >= limite:
            registro.escribir("info", f"Core apagado por inactividad ({minutos:g} min)")
            os._exit(0)


if __name__ == "__main__":
    raise SystemExit(main())
