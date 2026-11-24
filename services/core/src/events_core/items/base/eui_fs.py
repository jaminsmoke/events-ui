"""Contrato del directorio `.EUI`: solo almacén, gitignore y migraciones.

`.EUI` es configuración del producto, no un cajón de logs, claves, instaladores
ni scripts de prueba. Cualquier otra cosa se considera ajena: no se puede
escribir (vía `escribir_atomico`) y se purga al abrir el almacén.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from .comun import InvalidInput
from .rutas import DB_FILENAME, EUI_DIR, LEGACY_DB_FILENAME

# Un lote de migración es `uuid.uuid4().hex` (32 hex en minúsculas).
_LOTE_RE = re.compile(r"^[0-9a-f]{32}$")

_PERMITIDOS_RAIZ = frozenset(
    {
        ".gitignore",
        DB_FILENAME,
        f"{DB_FILENAME}-wal",
        f"{DB_FILENAME}-shm",
        f"{DB_FILENAME}-journal",
        LEGACY_DB_FILENAME,
        f"{LEGACY_DB_FILENAME}-wal",
        f"{LEGACY_DB_FILENAME}-shm",
        f"{LEGACY_DB_FILENAME}-journal",
    }
)


def _normalizar(relativa: str) -> str:
    return relativa.replace("\\", "/").strip("/")


def es_permitida_en_eui(relativa: str) -> bool:
    """¿Esta ruta relativa a `.EUI` forma parte del contrato?"""
    rel = _normalizar(relativa)
    if not rel or any(parte in {".", ".."} for parte in rel.split("/")):
        return False
    partes = rel.split("/")
    if len(partes) == 1:
        return partes[0] in _PERMITIDOS_RAIZ
    # Solo `migracion/<lote>/…`: el plan y los dry-runs no viven aquí.
    if partes[0] != "migracion" or len(partes) < 3:
        return False
    return bool(_LOTE_RE.fullmatch(partes[1]))


def _directorio_permitido(relativa: str) -> bool:
    rel = _normalizar(relativa)
    if not rel:
        return True
    if rel == "migracion":
        return True
    partes = rel.split("/")
    if partes[0] != "migracion" or len(partes) < 2:
        return False
    return bool(_LOTE_RE.fullmatch(partes[1]))


def relativa_bajo_eui(destino: Path) -> str | None:
    """Si `destino` cae bajo un `.EUI`, la ruta relativa a esa carpeta."""
    try:
        resuelto = destino.resolve()
    except OSError:
        resuelto = destino
    partes = resuelto.parts
    try:
        indice = partes.index(EUI_DIR)
    except ValueError:
        return None
    return Path(*partes[indice + 1 :]).as_posix() if indice + 1 < len(partes) else ""


def asegurar_destino_eui(destino: Path) -> None:
    """Rechaza escrituras dentro de `.EUI` fuera del contrato."""
    relativa = relativa_bajo_eui(destino)
    if relativa is None:
        return
    if relativa == "" or not es_permitida_en_eui(relativa):
        raise InvalidInput(
            f"ruta no permitida dentro de {EUI_DIR}: {relativa or '(raíz)'}; "
            f"solo {DB_FILENAME}, .gitignore y migracion/<lote>/…"
        )


def asegurar_directorio_eui(destino: Path) -> None:
    """Rechaza crear una carpeta dentro de `.EUI` fuera del contrato.

    `asegurar_destino_eui` mira el fichero que se va a escribir; esto mira la
    carpeta que hay que crear antes. `.EUI` y `migracion/<lote>` sí se crean:
    forman parte del contrato.
    """
    relativa = relativa_bajo_eui(destino)
    if relativa is None or relativa == "":
        return
    if not _directorio_permitido(relativa):
        raise InvalidInput(
            f"carpeta no permitida dentro de {EUI_DIR}: {relativa}; solo migracion/<lote>/…"
        )


def inventariar_ajenos(eui_dir: Path) -> list[str]:
    """Rutas relativas (archivos y carpetas) ajenas al contrato, sin borrarlas."""
    if not eui_dir.is_dir():
        return []
    ajenos: list[str] = []
    for path in sorted(eui_dir.rglob("*"), key=lambda p: p.as_posix()):
        try:
            rel = path.relative_to(eui_dir).as_posix()
        except ValueError:
            continue
        if path.is_dir():
            if not _directorio_permitido(rel):
                ajenos.append(f"{rel}/")
            continue
        if not es_permitida_en_eui(rel):
            ajenos.append(rel)
    return ajenos


def purgar_eui(eui_dir: Path) -> list[str]:
    """Borra lo ajeno bajo `.EUI`. Devuelve las rutas relativas eliminadas."""
    if not eui_dir.is_dir():
        return []
    eliminados: list[str] = []
    # De más profundo a más superficial: primero ficheros, luego carpetas.
    entradas = sorted(eui_dir.rglob("*"), key=lambda p: len(p.parts), reverse=True)
    for path in entradas:
        try:
            rel = path.relative_to(eui_dir).as_posix()
        except ValueError:
            continue
        if path.is_dir():
            if _directorio_permitido(rel):
                continue
            shutil.rmtree(path, ignore_errors=True)
            eliminados.append(f"{rel}/")
            continue
        if es_permitida_en_eui(rel):
            continue
        try:
            path.unlink()
            eliminados.append(rel)
        except OSError:
            pass
    return eliminados
