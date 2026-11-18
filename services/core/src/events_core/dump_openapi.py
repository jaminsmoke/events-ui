"""Vuelca el OpenAPI de la app por stdout, sin arrancar el servidor.

Lo usa la generación de tipos TS del cliente (`pnpm gen:api` en la raíz):
así el contrato se lee del código, no de un core que tenga que estar vivo.

    uv run --directory services/core python -m events_core.dump_openapi
"""

from __future__ import annotations

import json

from .main import app


def main() -> None:
    print(json.dumps(app.openapi()))


if __name__ == "__main__":
    main()
