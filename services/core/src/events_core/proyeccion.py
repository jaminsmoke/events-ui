"""F2: la primera proyección (`repo_state`) con identidad de repo.

No es SQL libre desde la UI: es una vista fija y
versionada sobre el almacén. Todo lo que se lee aquí es un `SELECT` con los
parámetros de la propia query, nada que venga del cliente.

La identidad de repo se resuelve así, en orden:
1. **ruta** — la carpeta que la UI eligió (ya viene en el `repo`);
2. **rama y commit** — de git, si la carpeta es un repo git.

Sin git no hay rama ni commit (`None`): el resto de la proyección no depende
de ellos.
"""

from __future__ import annotations

import sqlite3
import subprocess
from contextlib import closing
from pathlib import Path
from typing import Any

from .db import open_read_only
from .ideas import _existe, ensure_repo, resolve_repo


def _git(carpeta: Path, *args: str) -> str | None:
    """Un dato de git en la carpeta, o `None` si no hay repo git o falla."""
    try:
        salida = subprocess.run(
            ["git", "-C", str(carpeta), *args],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if salida.returncode != 0:
        return None
    valor = salida.stdout.strip()
    return valor or None


def repo_estado_actual(repo: str) -> dict[str, Any]:
    """La proyección completa del repo en una lectura de solo lectura."""
    carpeta = resolve_repo(repo)
    db_file = ensure_repo(repo)

    def conteo(conn: sqlite3.Connection, sql: str, *params: Any) -> int:
        try:
            return int(conn.execute(sql, params).fetchone()[0])
        except (sqlite3.Error, TypeError):  # tabla que aún no existe en este almacén
            return 0

    with closing(open_read_only(db_file)) as conn:
        # La tabla vive como `idea_entry` desde la 0006; antes, `ideas`.
        tabla_idea = "idea_entry" if _existe(conn, "idea_entry") else "ideas"
        ideas = conteo(conn, f"SELECT count(*) FROM {tabla_idea}")
        conexiones = conteo(conn, "SELECT count(*) FROM connections")
        eventos = conteo(conn, "SELECT count(*) FROM event")
        por_estado: dict[str, int] = {}
        try:
            # La cola y las fichas son filas reales (0009): el conteo por
            # estado es una CASE sobre ellas. Una idea sin fila en ninguna es
            # el cajón y no cuenta (antes salía la clave literal "None").
            for estado, n in conn.execute(
                "SELECT CASE"
                " WHEN EXISTS (SELECT 1 FROM idea_rejected r WHERE r.uid = idea_entry.uid)"
                " THEN 'descartadas'"
                " WHEN EXISTS (SELECT 1 FROM idea_completada c WHERE c.uid = idea_entry.uid)"
                " THEN 'completada'"
                " WHEN EXISTS (SELECT 1 FROM idea_cola q WHERE q.uid = idea_entry.uid)"
                " THEN 'cola' END, count(*) FROM idea_entry GROUP BY 1"
            ):
                if estado is not None:
                    por_estado[str(estado)] = int(n)
        except sqlite3.Error:
            pass
        try:
            fila = conn.execute("SELECT max(ts) FROM event").fetchone()
            ultima = fila[0] if fila else None
        except sqlite3.Error:
            ultima = None

    return {
        "repo": str(carpeta),
        "branch": _git(carpeta, "rev-parse", "--abbrev-ref", "HEAD"),
        "commit": _git(carpeta, "rev-parse", "--short", "HEAD"),
        "ideas": ideas,
        "connections": conexiones,
        "events": eventos,
        "por_estado": por_estado,
        "ultima_actividad": ultima,
    }
