"""Las capas de `items/` solo miran hacia abajo.

- `base/` no sabe de items: rutas del almacén, esquema, migraciones y lo común.
- `modelo/` conoce el flujo: carriles, fichas, dependencias y compuertas.
- `trabajo/` lo desglosa en fases, requisitos y los archivos de cada evento.
- `consulta.py` y `crud.py` son las dos caras de la API.

Un módulo solo puede importar capas iguales o inferiores; la fachada
`__init__.py` queda fuera de la regla porque es justo lo que se ve desde fuera.
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
PAQUETE = SRC / "events_core" / "ideas"

# De abajo arriba: cuanto más alto el número, más sabe de items.
CAPAS = {"base": 0, "modelo": 1, "trabajo": 2}
API = 3
NOMBRES = {**{numero: nombre for nombre, numero in CAPAS.items()}, API: "api"}


def _capa(destino: Path) -> int | None:
    """Capa de un fichero o carpeta del paquete; `None` si es la fachada."""
    partes = destino.relative_to(PAQUETE).parts
    if not partes:
        return API
    if partes[0] == "__init__.py":
        return None
    if partes[0] in CAPAS:
        return CAPAS[partes[0]]
    assert len(partes) == 1 and destino.suffix == ".py", f"capa sin nombre en items/: {partes[0]}"
    return API


def _ruta(nombre: str) -> Path | None:
    """Fichero o carpeta de un módulo de `events_core`, si cae dentro de items."""
    partes = nombre.split(".")
    if partes[:2] != ["events_core", "ideas"]:
        return None
    destino = SRC.joinpath(*partes)
    if destino.with_suffix(".py").is_file():
        return destino.with_suffix(".py")
    return destino


def _destinos(fichero: Path) -> list[Path]:
    """Módulos del paquete que importa un fichero, relativos o absolutos."""
    arbol = ast.parse(fichero.read_text(encoding="utf-8"))
    paquete = fichero.relative_to(SRC).with_suffix("").parts[:-1]
    destinos: list[Path] = []
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.ImportFrom):
            if nodo.level:
                # `..base.comun` sube (nivel - 1) desde el paquete del fichero.
                base = paquete[: len(paquete) - (nodo.level - 1)]
                nombre = ".".join((*base, *(nodo.module.split(".") if nodo.module else ())))
            else:
                nombre = nodo.module or ""
        elif isinstance(nodo, ast.Import):
            nombre = ""
        else:
            continue

        candidatos = [nombre] if nombre else []
        # `from ..base import rutas`: el submódulo importado también cuenta.
        candidatos += [f"{nombre}.{alias.name}" for alias in nodo.names if nombre]
        for candidato in candidatos:
            ruta = _ruta(candidato)
            if ruta is not None and ruta.exists() and ruta not in destinos:
                destinos.append(ruta)
    return destinos


def test_las_capas_de_items_importan_solo_hacia_abajo() -> None:
    problemas: list[str] = []
    for fichero in sorted(PAQUETE.rglob("*.py")):
        if "__pycache__" in fichero.parts or fichero == PAQUETE / "__init__.py":
            continue
        capa = _capa(fichero)
        for destino in _destinos(fichero):
            objetivo = _capa(destino)
            if objetivo is None:
                problemas.append(f"{fichero.relative_to(PAQUETE).as_posix()}: importa la fachada")
            elif objetivo > capa:
                problemas.append(
                    f"{fichero.relative_to(PAQUETE).as_posix()} ({NOMBRES[capa]})"
                    f" importa {destino.relative_to(PAQUETE).as_posix()}"
                    f" ({NOMBRES[objetivo]})"
                )

    assert not problemas, "imports hacia arriba en items/:\n" + "\n".join(problemas)
