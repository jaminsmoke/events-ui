"""Instantánea consistente de un almacén de ideas.

`.EUI/EUI_DATABASE.sqlite` se versiona con el repo, pero sus auxiliares de WAL
no (los ignora el `.gitignore` del almacén). Copiar el fichero principal a mano
mientras el WAL tiene páginas confirmadas deja la copia sin esas escrituras.
Aquí se usa el API de backup de SQLite: lee una transacción del origen y vuelca
un fichero completo, con lo confirmado que aún vive en `-wal`.

Uso:
    uv run --directory services/core python -m events_core.instantanea <origen> <destino>
"""

from __future__ import annotations

import sqlite3
import sys
from contextlib import closing
from pathlib import Path

BUSY_TIMEOUT_MS = 5_000


def copia_consistente(origen: Path, destino: Path) -> None:
    """Escribe en `destino` una instantánea completa de `origen`.

    El `backup` de Python recorre el almacén desde una lectura coherente, así
    que incluye el WAL confirmado sin necesidad de checkpoint ni de cerrar la
    app. La copia queda en modo rollback y sin `-wal`/`-shm` al lado: un fichero
    suelto tiene que poder abrirse en cualquier sitio. Se verifica con
    `integrity_check` antes de darla por buena.
    """
    origen = origen.expanduser().resolve()
    destino = destino.expanduser().resolve()
    if not origen.is_file():
        raise FileNotFoundError(f"no existe el almacén: {origen}")
    if origen == destino:
        raise ValueError("el destino no puede ser el propio almacén")

    destino.parent.mkdir(parents=True, exist_ok=True)
    # Restos de una ejecución anterior: SQLite los recuperaría y mezclaría
    # páginas viejas con la instantánea nueva.
    for sufijo in ("-wal", "-shm"):
        Path(f"{destino}{sufijo}").unlink(missing_ok=True)

    with (
        closing(sqlite3.connect(origen, timeout=BUSY_TIMEOUT_MS / 1000)) as src,
        closing(sqlite3.connect(destino)) as dst,
    ):
        src.backup(dst)

    with closing(sqlite3.connect(destino)) as copia:
        copia.execute("PRAGMA journal_mode = DELETE")
        estado = copia.execute("PRAGMA integrity_check").fetchone()[0]
        if estado != "ok":
            raise sqlite3.DatabaseError(f"la copia no es íntegra: {estado}")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        print("uso: python -m events_core.instantanea <origen> <destino>", file=sys.stderr)
        return 2
    try:
        copia_consistente(Path(args[0]), Path(args[1]))
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"instantánea íntegra en {Path(args[1]).expanduser().resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
