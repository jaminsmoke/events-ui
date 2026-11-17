"""Siembra un repo investigado con su `.EUI/EUI_DATABASE`.

Uso:
    uv run --directory services/core python -m events_core.seed gonzalezreal-markdownui
    corepack pnpm core:seed gonzalezreal-markdownui   # atajo equivalente

Es idempotente: si el fichero ya existe, solo asegura el esquema.
"""

from __future__ import annotations

import sys

from . import ideas


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("uso: python -m events_core.seed <nombre-del-repo>", file=sys.stderr)
        return 2

    repo = argv[0]
    try:
        db_file = ideas.init_repo(repo)
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"{repo}: {db_file}")
    return 0


raise SystemExit(main(sys.argv[1:]))
