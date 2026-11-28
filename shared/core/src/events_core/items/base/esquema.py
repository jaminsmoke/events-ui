"""El esquema de cada almacén: cómo se abre, cómo nace y qué versión firma.

Los pasos que suben un almacén viejo hasta este esquema viven en
`migraciones.py`.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path

from ... import registro
from .eui_fs import purgar_eui
from .rutas import (
    DB_FILENAME,
    EUI_DIR,
    _ignorar_auxiliares,
    db_file_for,
    resolve_repo,
)

# `items/base/esquema.py` -> `events_core/schema` (el esquema se edita a mano).
SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schema"

# La versión que firma `schema/`: un almacén que nace hoy se queda en esta y no
# ejecuta ningún paso. Los que suben uno viejo van en `migraciones/`, de uno en
# uno, hasta esta misma cifra.
SCHEMA_VERSION = 37


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
    _ordenar_eui(db_file)
    return db_file


def aplicar_esquema(conn: sqlite3.Connection) -> None:
    """Aplica los `schema/*.sql` de items y log, y marca la versión.

    El log entra aquí porque el core emite sus `item.*` en él: un almacén
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
    _ordenar_eui(db_file)
    return db_file


# `.EUI` que este proceso ya ordenó: `Ruta -> huella`. Poner al día el
# `.gitignore` y purgar lo ajeno corre en cada lectura, y la purga recorre el
# árbol: sin que nada haya cambiado es trabajo de escritorio repetido (el
# sondeo de `/revision` pasa por aquí cada 2 s por cliente).
_ORDENADOS: dict[Path, tuple[object, ...]] = {}

# Auxiliares que SQLite crea y borra al abrir y cerrar conexiones: no cuentan
# como cambio de la carpeta, o la huella no pararía de moverse.
_VOLATILES = frozenset({f"{DB_FILENAME}-wal", f"{DB_FILENAME}-shm", f"{DB_FILENAME}-journal"})


def _entradas(carpeta: Path) -> tuple[str, ...] | None:
    """Los nombres de una carpeta, sin los auxiliares del almacén."""
    try:
        return tuple(sorted(nombre for nombre in os.listdir(carpeta) if nombre not in _VOLATILES))
    except OSError:
        return None


def _huella_eui(eui: Path) -> tuple[object, ...] | None:
    """Lo que decide si hay algo que ordenar, sin recorrer el árbol.

    Los nombres de `.EUI` y de su `migracion/` —lo único que la purga puede
    ver— y la firma del `.gitignore`, que se reescribe si cambió su contenido.
    """
    raiz = _entradas(eui)
    if raiz is None:
        return None
    try:
        info = (eui / ".gitignore").stat()
        firma: tuple[int, int] | None = (info.st_mtime_ns, info.st_size)
    except OSError:
        firma = None
    return raiz, _entradas(eui / "migracion"), firma


def _ordenar_eui(db_file: Path) -> None:
    """Pone al día el `.gitignore` de `.EUI` y purga lo ajeno, una vez.

    Solo trabaja si la carpeta cambió desde la última vez que este proceso la
    ordenó: nada puede aparecer en `.EUI` sin que cambien sus nombres, y un
    `.EUI` recreado trae otros. La huella se guarda después de ordenar, que es
    cuando la purga ya borró lo suyo. Idempotente: dos hilos a la vez hacen lo
    mismo y dejan la misma carpeta.
    """
    eui = db_file.parent
    huella = _huella_eui(eui)
    if huella is not None and _ORDENADOS.get(eui) == huella:
        return
    _ignorar_auxiliares(db_file)
    _purgar_ajenos(eui)
    if (nueva := _huella_eui(eui)) is not None:
        _ORDENADOS[eui] = nueva


def _purgar_ajenos(eui_dir: Path) -> None:
    """Quita de `.EUI` lo que no es almacén, gitignore ni lote de migración."""
    eliminados = purgar_eui(eui_dir)
    if eliminados:
        muestra = ", ".join(eliminados[:5])
        resto = f" (+{len(eliminados) - 5} más)" if len(eliminados) > 5 else ""
        registro.escribir(
            "aviso",
            f"Purgados {len(eliminados)} elementos ajenos en {EUI_DIR}: {muestra}{resto}",
            origen="eui",
        )
