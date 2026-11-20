"""F2: la primera proyección (`repo_state`) con identidad de repo.

No es SQL libre desde la UI: es una vista fija y
versionada sobre el almacén. Todo lo que se lee aquí es un `SELECT` con los
parámetros de la propia query, nada que venga del cliente.

La identidad de repo se resuelve así, en orden:
1. **ruta** — la carpeta que la UI eligió (ya viene en el `repo`);
2. **work tree** — de `git rev-parse --show-toplevel`, que también responde
   para una subcarpeta de otro repo; una carpeta ignorada por el repo
   contenedor se queda fuera (el laboratorio dentro del repo de la app);
3. **rama y commit** — de git, si hay work tree. La rama se lee con
   `symbolic-ref` para que un repo recién inicializado, sin commits, también
   la tenga; el commit puede faltar (`None`).

Sin git no hay rama ni commit (`None`): el resto de la proyección no depende
de ellos.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
from contextlib import closing
from pathlib import Path
from typing import Any

from .db import open_read_only
from .ideas import InvalidInput, _existe, ensure_repo, repos_root, resolve_repo
from .ideas.base.rutas import EUI_DIR


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


def _git_cambios(carpeta: Path) -> list[dict[str, str]]:
    """Los cambios sin commit, tal como los resume `git status --porcelain`.

    Se incluyen staged, unstaged y sin seguimiento. Se pide `-z` porque en ese
    formato Git no entrecomilla ni escapa las rutas: un nombre con espacios,
    acentos o comillas llega tal cual. En un renombrado o una copia, el campo
    siguiente es el origen, que se devuelve aparte (`origen`) para no perder de
    dónde vino. No se usa `_git` porque `strip()` se comería el espacio del
    primer estado (` M archivo`) y el recorte de la primera línea dejaría el
    código de dos letras mal alineado.
    """
    try:
        salida = subprocess.run(
            [
                "git",
                "-C",
                str(carpeta),
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ],
            capture_output=True,
            encoding="utf-8",
            errors="surrogateescape",
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if salida.returncode != 0:
        return []
    campos = salida.stdout.split(chr(0))
    cambios: list[dict[str, str]] = []
    i = 0
    while i < len(campos):
        linea = campos[i]
        i += 1
        if len(linea) < 4:
            continue
        estado = linea[:2].strip() or "?"
        ruta = linea[3:]
        if not ruta:
            continue
        cambio = {"estado": estado, "ruta": ruta}
        # Renombrado o copia: el origen viene en el campo siguiente.
        if "R" in estado or "C" in estado:
            if i < len(campos) and campos[i]:
                cambio["origen"] = campos[i]
            i += 1
        # El almacén de la app no es trabajo del repo: se escribe solo con cada
        # idea, así que enseñarlo dejaría la lista de cambios siempre con algo
        # y «nada sin commit» no llegaría nunca. Mismo criterio que
        # `archivos._nombres`.
        if ruta == EUI_DIR or ruta.startswith(f"{EUI_DIR}/"):
            continue
        cambios.append(cambio)
    return cambios


def historial(carpeta: Path, limite: int = 20) -> list[dict[str, str]]:
    """Los últimos commits de HEAD, del más nuevo al más viejo.

    Sin work tree o sin commits se devuelve una lista vacía: un repo recién
    inicializado no es un error, el mapa ya enseña que no hay historial. Se
    separa con el carácter de unidad (0x1f) y no con el tabulador porque el
    asunto puede llevar cualquier cosa sin partir la línea; `%h` da el hash
    abreviado, que es el que cabe en la fila, y `%aI` la fecha de autoría en
    ISO 8601.
    """
    es_git, git_root = _git_repo(carpeta)
    if not es_git or git_root is None:
        return []
    try:
        salida = subprocess.run(
            [
                "git",
                "-C",
                str(git_root),
                "log",
                f"-n{limite}",
                "--no-show-signature",
                "--format=%h%x1f%s%x1f%an%x1f%aI",
            ],
            capture_output=True,
            encoding="utf-8",
            errors="surrogateescape",
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if salida.returncode != 0:  # sin commits: `git log` sale con error
        return []
    commits: list[dict[str, str]] = []
    for linea in salida.stdout.splitlines():
        campos = linea.split(chr(31))
        if len(campos) != 4:
            continue
        hash_corto, asunto, autor, fecha = campos
        commits.append({"hash": hash_corto, "asunto": asunto, "autor": autor, "fecha": fecha})
    return commits


def _git_repo(carpeta: Path) -> tuple[bool, Path | None]:
    """La carpeta y el work tree Git que la contiene, si de verdad lo hay.

    `rev-parse --show-toplevel` responde tanto para un repo propio como para
    una subcarpeta de otro repo. Una carpeta ignorada por el repo contenedor
    no cuenta: el laboratorio vive dentro del repo del proyecto, pero su
    contenido no forma parte de él. Un `git init` propio siempre gana, porque
    el toplevel pasa a ser la propia carpeta.
    """
    salida = _git(carpeta, "rev-parse", "--show-toplevel")
    if not salida:
        return False, None
    try:
        raiz = Path(salida).resolve()
        resuelta = carpeta.resolve()
    except (OSError, RuntimeError):
        return False, None
    if raiz == resuelta:
        return True, raiz
    try:
        relativa = resuelta.relative_to(raiz).as_posix()
    except ValueError:
        return False, None
    if not relativa:
        return True, raiz
    if _git(raiz, "check-ignore", "--", relativa):
        return False, None
    return True, raiz


def inicializar_repo(carpeta: Path) -> None:
    """`git init` en la carpeta del repo, con las protecciones del laboratorio.

    Se rechaza si ya es un repo propio o si pertenece a un repo contenedor
    que no lo ignora: anidar otro dentro escondería el de fuera. Si la
    carpeta está ignorada por el contenedor, el `init` propio gana.
    """
    if not carpeta.exists():
        raise FileNotFoundError(f"no existe la carpeta {carpeta}")
    es_git, git_root = _git_repo(carpeta)
    if es_git and git_root is not None and git_root.resolve() == carpeta.resolve():
        raise InvalidInput("Ya es un repositorio local")
    if es_git:
        raise InvalidInput(f"Ya pertenece al repositorio {git_root}; no se anida otro")
    try:
        salida = subprocess.run(
            ["git", "-C", str(carpeta), "init", "-b", "main"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise InvalidInput("No se pudo ejecutar git init") from exc
    if salida.returncode != 0:
        detalle = salida.stderr.strip() or "git init falló"
        raise InvalidInput(detalle)


def eliminar_repo(carpeta: Path) -> None:
    """Borra solo el `.git` propio; si no lo hay o no es carpeta, se rechaza.

    Un repo heredado de una carpeta superior no se toca: el `.git` ajeno
    queda intacto. Un `.git` que no sea carpeta (enlace de work tree o de
    submódulo) tampoco: eliminarlo rompería el repo del que cuelga.
    """
    es_git, git_root = _git_repo(carpeta)
    if not es_git:
        raise InvalidInput("No hay repositorio local que eliminar")
    if git_root is None or git_root.resolve() != carpeta.resolve():
        raise InvalidInput(f"El repo pertenece a {git_root}; se borra desde su raíz")
    punto_git = carpeta / ".git"
    if not punto_git.is_dir():
        raise InvalidInput("El .git no es una carpeta; no se elimina")
    shutil.rmtree(punto_git)


def commit(carpeta: Path, mensaje: str) -> None:
    """`git add -A` + `git commit`: un commit local, sin remoto.

    Solo en el repo propio de la carpeta: una subcarpeta de otro repo se
    commitea desde su raíz, igual que se inicializa. Se exige algo que
    commitear: un commit vacío ensucia el historial y el mapa no lo puede
    distinguir de un cambio real. El autor lo pone Git (`user.name` y
    `user.email`); si faltan, su error se devuelve tal cual, que dice
    exactamente qué configurar.
    """
    es_git, git_root = _git_repo(carpeta)
    if not es_git or git_root is None:
        raise InvalidInput("No hay repositorio Git en esta carpeta")
    if git_root.resolve() != carpeta.resolve():
        raise InvalidInput(f"El repo pertenece a {git_root}; se commitea desde su raíz")
    texto = mensaje.strip()
    if not texto:
        raise InvalidInput("El mensaje del commit está vacío")
    if not _git_cambios(carpeta):
        raise InvalidInput("No hay cambios que commitear")
    for argumentos in (
        # Todo, y luego el almacén propio fuera del índice: se actualiza solo y
        # no es trabajo. No vale excluirlo con un pathspec `:(exclude).EUI`:
        # nombrar una ruta ignorada hace que `git add` se niegue con «paths are
        # ignored» y salga con 1, que es justo el estado del laboratorio (`.EUI`
        # en `.git/info/exclude`). El reset sobra si no llegó a entrar.
        ("add", "-A", "--", "."),
        ("reset", "-q", "--", EUI_DIR),
        ("commit", "-m", texto),
    ):
        try:
            salida = subprocess.run(
                ["git", "-C", str(carpeta), *argumentos],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise InvalidInput("No se pudo ejecutar git") from exc
        if salida.returncode != 0:
            raise InvalidInput(salida.stderr.strip() or "git falló")


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
        # La tabla vive como `idea_data` desde la 0020; antes era `idea_entry`
        # (0006) y, más atrás, `ideas`.
        tabla_idea = "idea_data" if _existe(conn, "idea_data") else "ideas"
        ideas = conteo(conn, f"SELECT count(*) FROM {tabla_idea}")
        eventos = conteo(conn, "SELECT count(*) FROM event")
        por_estado: dict[str, int] = {}
        try:
            # El estado es una columna del nodo (0020): un GROUP BY y una
            # traducción de nombre. La entrada (`draft`) no cuenta, como antes.
            for estado, n in conn.execute("SELECT estado, count(*) FROM idea_node GROUP BY 1"):
                clave = {"rejected": "descartadas", "proposed": "cola"}.get(
                    str(estado), str(estado)
                )
                if estado != "draft":
                    por_estado[clave] = int(n)
        except sqlite3.Error:
            pass
        try:
            fila = conn.execute("SELECT max(ts) FROM event").fetchone()
            ultima = fila[0] if fila else None
        except sqlite3.Error:
            ultima = None

    es_git, git_root = _git_repo(carpeta)
    return {
        "repo": str(carpeta),
        "laboratorio": carpeta.parent == repos_root(),
        "git": es_git,
        "git_root": str(git_root) if git_root else None,
        # `symbolic-ref` funciona en un repo recién inicializado, antes del
        # primer commit; `rev-parse --abbrev-ref HEAD` no. El commit sí puede
        # faltar y se queda en `None`.
        "branch": _git(carpeta, "symbolic-ref", "--short", "HEAD") if es_git else None,
        "commit": _git(carpeta, "rev-parse", "--short", "HEAD") if es_git else None,
        "git_cambios": _git_cambios(carpeta) if es_git else [],
        "ideas": ideas,
        "events": eventos,
        "por_estado": por_estado,
        "ultima_actividad": ultima,
    }
