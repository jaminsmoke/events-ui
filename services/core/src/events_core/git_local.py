"""La única implementación de Git del core.

Dos módulos miraban el mismo work tree por caminos distintos: `archivos` pedía
parches para la foto de una fase y `proyeccion` resolvía la identidad del repo.
Aquí viven las primitivas y las dos preguntas que se hacen sobre ellas, para que
un cambio en la regla del repo contenedor llegue a las dos a la vez.
"""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from . import proceso, registro
from .items.base.rutas import EUI_DIR

# Tope por comando. Un `git` colgado no puede dejar la petición esperando más.
TIMEOUT = 15

# `git diff HEAD` en un repo sin commits falla con esto: no hay parche que dar,
# no es un fallo que merezca un aviso en el registro.
_SIN_HEAD = (
    "ambiguous argument 'HEAD'",
    "bad revision 'HEAD'",
    "unknown revision or path not in the working tree",
)

# Tope por lote del `git diff`. `git diff` no admite `--pathspec-from-file` (eso
# es de `git add`, `commit`, `reset`…), así que las rutas van en el `argv` pero
# repartidas: con miles de archivos se pasaba del límite de línea de comandos de
# Windows (~32k caracteres) y la fase se quedaba sin parches, en silencio.
MAX_RUTAS_POR_LOTE = 200
MAX_CARACTERES_POR_LOTE = 8_000


def _proceso_git(
    carpeta: Path, *args: str, timeout: float = TIMEOUT
) -> subprocess.CompletedProcess[str] | None:
    """El proceso de Git, con éxito o no; `None` si no se pudo lanzar.

    La diferencia con `_git` es el `stderr`: quien reparte el diff en lotes
    necesita saber si el fallo es «todavía no hay HEAD» o uno de verdad.
    """
    try:
        # El texto sale en UTF-8: `proceso.run` ya lo fija, que es donde estaba
        # el mojibake (cp1252) en todas las copias de `_git`.
        return proceso.run(
            ["git", "-C", str(carpeta), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _git(
    carpeta: Path, *args: str, timeout: float = TIMEOUT
) -> subprocess.CompletedProcess[str] | None:
    """Un comando de Git en la carpeta, o `None` si no hay repo o falla."""
    salida = _proceso_git(carpeta, *args, timeout=timeout)
    return salida if salida is not None and salida.returncode == 0 else None


def texto(carpeta: Path, *args: str, timeout: float = TIMEOUT) -> str | None:
    """La salida de un comando ya recortada, o `None` si no hay repo o falla."""
    salida = _git(carpeta, *args, timeout=timeout)
    if salida is None:
        return None
    return salida.stdout.strip() or None


def ejecutar(
    carpeta: Path, *args: str, timeout: float = TIMEOUT, errors: str | None = None
) -> subprocess.CompletedProcess[str]:
    """El proceso de Git tal cual, sin exigir éxito.

    `_git` es para las consultas que fallan en silencio (sin repo, sin commits);
    las acciones —inicializar, commitear, listar— necesitan el código de salida
    y el `stderr` para decirle al usuario qué pasó. `errors` permite el
    `surrogateescape` de los asuntos que no llegan en UTF-8.
    """
    opciones: dict[str, Any] = {"capture_output": True, "text": True, "timeout": timeout}
    if errors is not None:
        opciones["errors"] = errors
    return proceso.run(["git", "-C", str(carpeta), *args], **opciones)


def _git_repo(carpeta: Path) -> tuple[bool, Path | None]:
    """La carpeta y el work tree Git que la contiene, si de verdad lo hay.

    `rev-parse --show-toplevel` responde tanto para un repo propio como para
    una subcarpeta de otro repo. Una carpeta ignorada por el repo contenedor
    no cuenta: el laboratorio vive dentro del repo del proyecto, pero su
    contenido no forma parte de él. Un `git init` propio siempre gana, porque
    el toplevel pasa a ser la propia carpeta.
    """
    salida = texto(carpeta, "rev-parse", "--show-toplevel")
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
    if texto(raiz, "check-ignore", "--", relativa):
        return False, None
    return True, raiz


def hay_git(carpeta: Path) -> bool:
    """¿La carpeta es la raíz de su propio work tree?

    Misma base que `_git_repo`, otra pregunta: la foto de una fase solo guarda
    parches del repo propio (una subcarpeta de otro repo no es trabajo de el
    ítem, como decidió el producto), mientras que la proyección acepta el repo
    contenedor. Al salir las dos de `_git_repo`, no pueden separarse por
    descuido: heredar el repo contenedor sería una decisión de producto, no un
    efecto de compartir el código.
    """
    es_git, raiz = _git_repo(carpeta)
    try:
        return es_git and raiz is not None and raiz.resolve() == carpeta.resolve()
    except (OSError, RuntimeError):
        return False


def cambios(carpeta: Path) -> list[dict[str, str]]:
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
        salida = proceso.run(
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
        # item, así que enseñarlo dejaría la lista de cambios siempre con algo
        # y «nada sin commit» no llegaría nunca. Mismo criterio que la foto de
        # una fase.
        if ruta == EUI_DIR or ruta.startswith(f"{EUI_DIR}/"):
            continue
        cambios.append(cambio)
    return cambios


def _lotes(rutas: list[str]) -> Iterator[list[str]]:
    """Parte las rutas en lotes que quepan en un `argv` de Windows."""
    lote: list[str] = []
    largo = 0
    for ruta in rutas:
        if lote and (
            len(lote) >= MAX_RUTAS_POR_LOTE or largo + len(ruta) + 1 > MAX_CARACTERES_POR_LOTE
        ):
            yield lote
            lote = []
            largo = 0
        lote.append(ruta)
        largo += len(ruta) + 1
    if lote:
        yield lote


def parches(carpeta: Path, rutas: set[str]) -> dict[str, str]:
    """El parche de cada ruta, en lotes de `git diff HEAD`.

    `HEAD` incluye lo preparado y lo que no, que es justo lo que añade Git a la
    foto. Las rutas van ordenadas para que dos llamadas con el mismo conjunto
    pidan lo mismo, y `core.quotepath=false` evita que Git escape los acentos en
    la cabecera del bloque.

    Las rutas van en el `argv`, pero repartidas en lotes acotados: con miles de
    archivos —un `vendor/` o un renombrado grande— la línea de comandos de
    Windows se pasaba del tope, `git` fallaba y la fase se guardaba sin parches,
    en silencio. Un lote que falla no se lleva a los demás y deja aviso; el repo
    sin HEAD no avisa, porque no hay diff que dar.
    """
    if not rutas:
        return {}
    lista = sorted(rutas)
    total = 0
    parcheado: dict[str, str] = {}
    fallos: list[str] = []
    for lote in _lotes(lista):
        total += 1
        salida = _proceso_git(
            carpeta,
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "HEAD",
            "--",
            *lote,
        )
        if salida is not None and salida.returncode == 0:
            parcheado.update(_partir_diff(salida.stdout, set(lote)))
            continue
        error = (salida.stderr or "").strip() if salida is not None else ""
        if any(marca in error for marca in _SIN_HEAD):
            return {}
        fallos.append(error or "git diff falló")
    if fallos:
        registro.escribir(
            "aviso",
            f"sin parches en {carpeta}: {len(fallos)} de {total} lotes fallaron"
            f" ({fallos[0][:120]})",
        )
    return parcheado


def _partir_diff(texto: str, rutas: set[str]) -> dict[str, str]:
    """Reparte la salida de un `git diff` de varias rutas en un parche por ruta.

    Cada bloque empieza por `diff --git a/… b/…`; el nombre del final es el que
    identifica el archivo, así que se busca cuál de las rutas pedidas encaja.
    """
    parcheado: dict[str, str] = {}
    actual: str | None = None
    bloque: list[str] = []
    for linea in texto.splitlines(keepends=True):
        if linea.startswith("diff --git "):
            if actual is not None:
                parcheado[actual] = "".join(bloque)
            cabeza = linea.rstrip("\n")
            actual = next((ruta for ruta in rutas if cabeza.endswith(f" b/{ruta}")), None)
            bloque = [linea] if actual is not None else []
        elif actual is not None:
            bloque.append(linea)
    if actual is not None:
        parcheado[actual] = "".join(bloque)
    return parcheado
