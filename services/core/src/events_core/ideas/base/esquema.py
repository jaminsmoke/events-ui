"""El esquema de cada almacén: cómo se abre, cómo nace y qué versión firma.

Los pasos que suben un almacén viejo hasta este esquema viven en
`migraciones.py`.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from ... import registro
from .rutas import (
    DB_FILENAME,
    EUI_DIR,
    _ignorar_auxiliares,
    db_file_for,
    resolve_repo,
)

# `ideas/base/esquema.py` -> `events_core/schema` (el esquema se edita a mano).
SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schema"

# La versión que firma `schema/`: un almacén que nace hoy se queda en esta y no
# ejecuta ningún paso. Los que suben uno viejo van en `migraciones/`, de uno en
# uno, hasta esta misma cifra.
SCHEMA_VERSION = 29


BUSY_TIMEOUT_MS = 5_000


def connect(db_file: Path, *, create: bool = False) -> sqlite3.Connection:
    """Abre el `EUI_DATABASE` en RW.

    Aquí sí se escribe, al contrario que en el log de eventos: este fichero es
    nuestro. Si `create` es False y no existe, falla en vez de crearlo vacío.
    """
    if create:
        db_file.parent.mkdir(parents=True, exist_ok=True)
    elif not db_file.exists():
        raise FileNotFoundError(f"no existe {DB_FILENAME} en {db_file.parent}")

    conn = sqlite3.connect(db_file, timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_repo(repo: str) -> Path:
    """Crea o pone al día `.EUI/EUI_DATABASE.sqlite`. Idempotente.

    Si el almacén ya existe no basta con aplicar `schema/*.sql`: eso solo
    crea lo que falta (`IF NOT EXISTS`) y deja las filas de una versión vieja
    en la tabla antigua. Un almacén existente se migra por número, igual que
    al abrirlo desde la app. Un nombre mal escrito no crea un repo: exige que
    ya exista, como la app no crea la BD de eventos.
    """
    directory = resolve_repo(repo)
    if not directory.is_dir():
        raise FileNotFoundError(f"no existe el repo {directory} (deja ahí su código primero)")

    db_file = directory / EUI_DIR / DB_FILENAME
    if db_file.is_file():
        # `migraciones` importa este módulo para abrir el almacén y aplicar el
        # esquema, así que se pide aquí y no al cargar el paquete.
        from . import migraciones

        migraciones._migrar_esquema(db_file)
    else:
        with closing(connect(db_file, create=True)) as conn:
            aplicar_esquema(conn)
            conn.commit()

    registro.escribir("info", f"Almacén sembrado en {directory}", origen="seed")
    _ignorar_auxiliares(db_file)
    return db_file


def aplicar_esquema(conn: sqlite3.Connection) -> None:
    """Aplica los `schema/*.sql` de ideas y log, y marca la versión.

    El log entra aquí porque el core emite sus `idea.*` en él: un almacén
    recién sembrado que naciera sin `event` perdería justo los primeros.
    Idempotente: todo es IF NOT EXISTS.
    """
    for script in sorted(SCHEMA_DIR.glob("*.sql")):
        conn.executescript(script.read_text(encoding="utf-8"))
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def ensure_repo(repo: str) -> Path:
    """Devuelve el `EUI_DATABASE` del repo, sembrándolo si aún no está.

    La primera vez que se analiza una carpeta no hay `.EUI`: se crea ahí mismo en
    vez de mandar al usuario a un comando aparte. Si la carpeta no existe no se
    inventa nada: `init_repo` falla y la API responde 404.
    """
    # Mismo motivo que en `init_repo`: el almacén viejo lo pone al día
    # `migraciones`, que importa este módulo.
    from . import migraciones

    db_file = db_file_for(repo)
    migraciones._migrar_nombre_viejo(db_file)
    if not db_file.is_file():
        return init_repo(repo)
    migraciones._migrar_esquema(db_file)
    _ignorar_auxiliares(db_file)
    return db_file
