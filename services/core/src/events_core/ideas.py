"""Ideas y ADRs: la primera tabla del sistema, y no la de eventos.

Cada repositorio investigado es su propio almacén: lleva dentro una carpeta
`.EUI` con un SQLite llamado `EUI_DATABASE`. El fichero viaja con el repo.

El esquema no se escribe aquí: vive en `schema/ideas.sql`, que es el fichero que
se edita a mano. Este módulo solo lo aplica y hace CRUD sobre él.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

EUI_DIR = ".EUI"
DB_FILENAME = "EUI_DATABASE"
SCHEMA_PATH = Path(__file__).with_name("schema") / "ideas.sql"

REPOS_ROOT_ENV_VAR = "EVENTSUI_REPOS_ROOT"
BUSY_TIMEOUT_MS = 5_000

# El `EUI_DATABASE` se versiona con el repo; los auxiliares de WAL, nunca.
EUI_GITIGNORE = "EUI_DATABASE-wal\nEUI_DATABASE-shm\n"

# Columnas que la API puede modificar. Lista blanca: los nombres de columna de un
# UPDATE no pueden venir del cliente.
UPDATABLE = ("title", "description", "content", "kind", "status", "tags")


def repos_root() -> Path:
    """Raíz de los repos investigados: `EVENTSUI_REPOS_ROOT` o `repoprobe/repos`."""
    env = os.environ.get(REPOS_ROOT_ENV_VAR)
    if env:
        return Path(env).expanduser().resolve()
    # src/events_core/ideas.py -> raíz del proyecto
    return Path(__file__).resolve().parents[4] / "repoprobe" / "repos"


def repo_dir(repo: str) -> Path:
    """Resuelve el nombre de un repo. Es un solo segmento: sin `..` ni separadores."""
    name = repo.strip()
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ValueError(f"nombre de repo inválido: {repo!r}")
    return repos_root() / name


def db_file_for(repo: str) -> Path:
    return repo_dir(repo) / EUI_DIR / DB_FILENAME


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
    """Crea `.EUI/EUI_DATABASE` con el esquema aplicado. Idempotente.

    No crea el repo: exige que ya exista. Un nombre mal escrito no debe dejar un
    almacén vacío suelto, igual que la app no crea la BD de eventos.
    """
    directory = repo_dir(repo)
    if not directory.is_dir():
        raise FileNotFoundError(
            f"no existe el repo {directory} (deja ahí su código primero)"
        )

    db_file = directory / EUI_DIR / DB_FILENAME
    with closing(connect(db_file, create=True)) as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()

    (db_file.parent / ".gitignore").write_text(EUI_GITIGNORE, encoding="utf-8")
    return db_file


def list_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen un `EUI_DATABASE`."""
    root = repos_root()
    if not root.is_dir():
        return []

    found = []
    for entry in sorted(root.iterdir()):
        db_file = entry / EUI_DIR / DB_FILENAME
        if db_file.is_file():
            found.append({"repo": entry.name, "db_path": str(db_file)})
    return found


def _row(row: sqlite3.Row) -> dict[str, Any]:
    idea = dict(row)
    idea["tags"] = json.loads(idea["tags"] or "[]")
    return idea


def list_ideas(
    repo: str,
    *,
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    with closing(connect(db_file_for(repo))) as conn:
        rows = conn.execute(
            "SELECT * FROM ideas"
            " WHERE (:status IS NULL OR status = :status)"
            "   AND (:kind IS NULL OR kind = :kind)"
            " ORDER BY created_at DESC, id DESC"
            " LIMIT :limit OFFSET :offset",
            {"status": status, "kind": kind, "limit": limit, "offset": offset},
        ).fetchall()
    return [_row(r) for r in rows]


def get_idea(repo: str, uid: str) -> dict[str, Any]:
    with closing(connect(db_file_for(repo))) as conn:
        row = conn.execute("SELECT * FROM ideas WHERE uid = ?", (uid,)).fetchone()
    if row is None:
        raise KeyError(uid)
    return _row(row)


def create_idea(
    repo: str,
    *,
    title: str,
    description: str = "",
    content: str = "",
    kind: str = "idea",
    status: str = "draft",
    tags: Iterable[str] = (),
) -> dict[str, Any]:
    uid = uuid.uuid4().hex
    ts = now_iso()
    with closing(connect(db_file_for(repo))) as conn:
        conn.execute(
            "INSERT INTO ideas"
            " (uid, title, description, content, kind, status, tags, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, title, description, content, kind, status, json.dumps(list(tags)), ts, ts),
        )
        conn.commit()
    return get_idea(repo, uid)


def update_idea(repo: str, uid: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Actualiza solo los campos presentes. Los `None` no se escriben."""
    clean = {k: v for k, v in changes.items() if v is not None and k in UPDATABLE}
    if not clean:
        raise ValueError("nada que actualizar")

    if "tags" in clean:
        clean["tags"] = json.dumps(list(clean["tags"]))
    clean["updated_at"] = now_iso()

    assignments = ", ".join(f"{column} = :{column}" for column in clean)
    with closing(connect(db_file_for(repo))) as conn:
        cursor = conn.execute(
            f"UPDATE ideas SET {assignments} WHERE uid = :uid",
            {**clean, "uid": uid},
        )
        conn.commit()
        if cursor.rowcount == 0:
            raise KeyError(uid)
    return get_idea(repo, uid)


def delete_idea(repo: str, uid: str) -> bool:
    with closing(connect(db_file_for(repo))) as conn:
        cursor = conn.execute("DELETE FROM ideas WHERE uid = ?", (uid,))
        conn.commit()
    return cursor.rowcount > 0
