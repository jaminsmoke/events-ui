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

import os
import shutil
import sqlite3
import subprocess
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .db import open_read_only
from .git_local import _git_repo, _proceso_git, cambios, ejecutar, texto
from .items import InvalidInput, _existe, ensure_repo, repos_root, resolve_repo
from .items.base.rutas import DB_FILENAME, EUI_DIR

# La proyección se pide cada ~6 s por cliente y el estado de Git cambia poco.
# Se recuerda la parte de Git por carpeta y solo se rehace cuando cambia la
# huella de lo que Git cuenta, cuando el árbol deja de estar como HEAD o cuando
# toca revisar los no seguidos: eso último es lo único que obliga a recorrer el
# árbol, así que se hace cada `TTL_NO_SEGUIDOS` y no en cada lectura.
TTL_NO_SEGUIDOS = 10.0


@dataclass
class _CacheGit:
    """La parte de Git de una proyección y cuándo se miró el árbol entero."""

    propio: bool
    raiz: Path | None
    huella: tuple[object, ...] | None
    parte: dict[str, Any]
    escaneo: float


_ULTIMA_GIT: dict[Path, _CacheGit] = {}


def _firma(ruta: Path) -> tuple[int, int] | None:
    """`(mtime_ns, tamaño)` de una ruta; `None` si no está."""
    try:
        info = ruta.stat()
    except OSError:
        return None
    return info.st_mtime_ns, info.st_size


def _firma_refs(refs: Path) -> tuple[tuple[str, tuple[int, int] | None], ...]:
    """La firma de cada ref: un commit mueve la de su rama, no la de `refs/`."""
    firmas = []
    for raiz, _, ficheros in os.walk(refs):
        for fichero in ficheros:
            ruta = Path(raiz) / fichero
            firmas.append((ruta.relative_to(refs).as_posix(), _firma(ruta)))
    return tuple(sorted(firmas))


def _huella_git(raiz: Path) -> tuple[object, ...] | None:
    """La firma de lo que Git cuenta: índice, HEAD y refs.

    `None` cuando no hay una huella fiable —un work tree enlazado guarda su
    estado fuera de la carpeta— y entonces no se recuerda nada.
    """
    punto = raiz / ".git"
    if not punto.is_dir():
        return None
    return (
        _firma(punto / "index"),
        _firma(punto / "HEAD"),
        _firma(punto / "packed-refs"),
        _firma_refs(punto / "refs"),
    )


def _sin_tocar(carpeta: Path) -> bool | None:
    """¿El árbol sigue como HEAD, sin tocar lo que el índice conoce?

    `diff-index --quiet` no escribe nada ni enumera los no seguidos —eso es lo
    caro de `git status`—: solo mira los archivos que el índice ya conoce, que
    es justo lo que un editor cambia. `None` cuando no se puede saber (un repo
    sin commits, por ejemplo).
    """
    salida = _proceso_git(carpeta, "diff-index", "--quiet", "HEAD", "--", timeout=5)
    if salida is None or salida.returncode not in (0, 1):
        return None
    return salida.returncode == 0


def _olvidar(carpeta: Path) -> None:
    """Tira la proyección recordada: algo cambió sin mover su huella."""
    _ULTIMA_GIT.pop(carpeta, None)


def _parte_git(carpeta: Path) -> dict[str, Any]:
    """Identidad, rama, commit y cambios: lo que se pregunta a Git.

    En cada lectura se miran dos cosas baratas: la huella de lo que Git cuenta
    y si el árbol sigue como HEAD. Con eso se reutiliza lo último sin lanzar el
    `status`; los no seguidos, que no dejan huella, se revisan cada
    `TTL_NO_SEGUIDOS`.
    """
    ahora = time.monotonic()
    # Solo importa si hay `.git` propio: su `mtime` lo mueve el propio
    # `status` (crea y borra el lock del índice) y no dice nada.
    propio = (carpeta / ".git").is_dir()
    cache = _ULTIMA_GIT.get(carpeta)
    if cache is not None and cache.propio == propio:
        if cache.raiz is None:
            if ahora - cache.escaneo < TTL_NO_SEGUIDOS:
                return cache.parte
        elif (
            cache.huella is not None
            and _huella_git(cache.raiz) == cache.huella
            and _sin_tocar(carpeta) is True
            and ahora - cache.escaneo < TTL_NO_SEGUIDOS
        ):
            return cache.parte

    es_git, raiz = _git_repo(carpeta)
    if not es_git or raiz is None:
        parte: dict[str, Any] = {
            "git": False,
            "git_root": None,
            "branch": None,
            "commit": None,
            "git_cambios": [],
            "eui_ignorado": None,
        }
        _ULTIMA_GIT[carpeta] = _CacheGit(propio, None, None, parte, ahora)
        return parte

    # `symbolic-ref` funciona en un repo recién inicializado, antes del primer
    # commit; `rev-parse --abbrev-ref HEAD` no. El commit sí puede faltar y se
    # queda en `None`.
    parte = {
        "git": True,
        "git_root": str(raiz),
        "branch": texto(carpeta, "symbolic-ref", "--short", "HEAD", timeout=5),
        "commit": texto(carpeta, "rev-parse", "--short", "HEAD", timeout=5),
        "git_cambios": cambios(carpeta),
        "eui_ignorado": _almacen_ignorado(carpeta),
    }
    _ULTIMA_GIT[carpeta] = _CacheGit(propio, raiz, _huella_git(raiz), parte, ahora)
    return parte


def _almacen_ignorado(carpeta: Path) -> bool | None:
    """¿Git ignora el almacén de la app en esta raíz?

    `check-ignore` sale con 0 si la ruta está ignorada, 1 si no y 128 cuando
    no hay repo o Git falla: el tercer caso no se confunde con «no ignorado».
    Se pregunta por el fichero, no por la carpeta, que es lo que decide si el
    binario entra en el próximo commit.
    """
    try:
        salida = ejecutar(
            carpeta, "check-ignore", "-q", "--", f"{EUI_DIR}/{DB_FILENAME}", timeout=5
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if salida.returncode == 0:
        return True
    if salida.returncode == 1:
        return False
    return None


def ignorar_almacen(carpeta: Path) -> None:
    """Añade `.EUI/` al `.gitignore` de la raíz elegida.

    Solo se toca la carpeta abierta: si es una subcarpeta de otro repo, su
    `.gitignore` ignora su propio almacén y el árbol padre queda intacto. Es
    idempotente: si la línea ya está (con o sin barra final) no reescribe, y
    conserva el resto del fichero tal cual.
    """
    es_git, _ = _git_repo(carpeta)
    if not es_git:
        raise InvalidInput("Sin repositorio Git en esta carpeta")
    destino = carpeta / ".gitignore"
    try:
        actual = destino.read_text(encoding="utf-8")
    except FileNotFoundError:
        actual = ""
    except OSError as exc:
        raise InvalidInput(f"No se pudo leer {destino}: {exc}") from exc
    if any(line.strip().rstrip("/") == EUI_DIR for line in actual.splitlines()):
        return
    nuevo = actual
    if nuevo and not nuevo.endswith("\n"):
        nuevo += "\n"
    nuevo += f"{EUI_DIR}/\n"
    try:
        destino.write_text(nuevo, encoding="utf-8")
    except OSError as exc:
        raise InvalidInput(f"No se pudo escribir {destino}: {exc}") from exc
    # El `.gitignore` puede ser nuevo y no cambiar índice ni HEAD: la
    # proyección recordada diría que el almacén sigue versionándose.
    _olvidar(carpeta)


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
        salida = ejecutar(
            git_root,
            "log",
            f"-n{limite}",
            "--no-show-signature",
            "--format=%h%x1f%s%x1f%an%x1f%aI",
            timeout=5,
            errors="surrogateescape",
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
        salida = ejecutar(carpeta, "init", "-b", "main", timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        raise InvalidInput("No se pudo ejecutar git init") from exc
    if salida.returncode != 0:
        detalle = salida.stderr.strip() or "git init falló"
        raise InvalidInput(detalle)
    _olvidar(carpeta)


def _liberar_lectura(funcion, ruta, _error):  # noqa: ANN001
    """Borra un fichero de solo lectura.

    Los objetos sueltos que deja un commit nacen de solo lectura y, en Windows,
    `rmtree` se para con `PermissionError`: eliminar un repo con historial
    fallaba con un 500. Se devuelve el permiso de escritura y se reintenta.
    """
    os.chmod(ruta, 0o700)
    funcion(ruta)


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
    shutil.rmtree(punto_git, onexc=_liberar_lectura)
    _olvidar(carpeta)


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
    if not cambios(carpeta):
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
            salida = ejecutar(carpeta, *argumentos, timeout=10)
        except (OSError, subprocess.SubprocessError) as exc:
            raise InvalidInput("No se pudo ejecutar git") from exc
        if salida.returncode != 0:
            raise InvalidInput(salida.stderr.strip() or "git falló")
    _olvidar(carpeta)


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
        # La tabla vive como `work_item_data` desde la 0020; antes era `idea_entry`
        # (0006) y, más atrás, `items`.
        tabla_item = "work_item_data" if _existe(conn, "work_item_data") else "ideas"
        items = conteo(conn, f"SELECT count(*) FROM {tabla_item}")
        eventos = conteo(conn, "SELECT count(*) FROM event")
        por_estado: dict[str, int] = {}
        try:
            # El estado es una columna del nodo (0020): un GROUP BY y una
            # traducción de nombre. La entrada (`draft`) no cuenta, como antes.
            for estado, n in conn.execute("SELECT estado, count(*) FROM work_item_node GROUP BY 1"):
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

    return {
        "repo": str(carpeta),
        "laboratorio": carpeta.parent == repos_root(),
        **_parte_git(carpeta),
        "items": items,
        "events": eventos,
        "por_estado": por_estado,
        "ultima_actividad": ultima,
    }
