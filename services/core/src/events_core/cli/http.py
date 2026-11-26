"""El cliente HTTP del CLI, resuelto por la fachada.

Las pruebas sustituyen `cli._get`, `cli._post`… en la fachada, y los comandos
están repartidos por módulos. Estos envoltorios leen el atributo del paquete en
el momento de la llamada: así un parche en `events_core.cli` vale para todos
los comandos, que es lo que hacía antes un solo módulo.
"""

from __future__ import annotations

from typing import Any


def _get(url: str) -> tuple[Any | None, str | None, int]:
    from . import _get as real

    return real(url)


def _post(url: str, datos: Any) -> tuple[Any | None, str | None, int]:
    from . import _post as real

    return real(url, datos)


def _patch(url: str, datos: Any) -> tuple[Any | None, str | None, int]:
    from . import _patch as real

    return real(url, datos)


def _delete(url: str) -> tuple[Any | None, str | None, int]:
    from . import _delete as real

    return real(url)


def _health(url: str) -> tuple[dict[str, Any] | None, str | None]:
    from . import _health as real

    return real(url)
