"""Siembra la raíz de un repo con su `.EUI/EUI_DATABASE`.

Uso:
    uv run --directory services/core python -m events_core.seed <carpeta-raíz>
    corepack pnpm core:seed <carpeta-raíz>            # atajo equivalente

La carpeta es la raíz: no recorre subcarpetas ni crea `.EUI` en ellas. Es
idempotente: si el fichero ya existe, solo asegura el esquema.
"""

from __future__ import annotations

import sys

from . import ideas


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("uso: python -m events_core.seed <carpeta-raíz>", file=sys.stderr)
        return 2

    repo = argv[0]
    try:
        db_file = ideas.init_repo(repo)
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"{repo}: {db_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
