"""La resolución de rutas y la configuración no dependen del dominio.

`config.py` importaba `items.base.rutas` para guardar la raíz como ruta
absoluta, y con él arrastraba toda la capa de dominio. Lo compartido vive ahora
en `events_core.rutas`; aquí se prueba su comportamiento y que `config` se puede
cargar sin `items`.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

import events_core
from events_core import rutas
from events_core.errors import InvalidInput


def test_resuelve_un_nombre_del_laboratorio(monkeypatch, tmp_path: Path) -> None:  # noqa: ANN001
    monkeypatch.setenv("EVENTSUI_REPOS_ROOT", str(tmp_path))

    assert rutas.resolve_repo("lab") == (tmp_path / "lab").resolve()
    assert rutas.db_file_for("lab") == (tmp_path / "lab" / ".EUI" / "EUI_DATABASE.sqlite")


def test_la_raiz_por_defecto_es_el_laboratorio_del_proyecto(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.delenv("EVENTSUI_REPOS_ROOT", raising=False)
    proyecto = Path(str(events_core.__file__)).resolve().parents[4]

    assert rutas.repos_root() == proyecto / "repoprobe" / "repos"


def test_rechaza_un_nombre_que_escapa(monkeypatch, tmp_path: Path) -> None:  # noqa: ANN001
    monkeypatch.setenv("EVENTSUI_REPOS_ROOT", str(tmp_path))

    with pytest.raises(InvalidInput, match="nombre de repo inválido"):
        rutas.resolve_repo("..")


def test_config_se_carga_sin_el_dominio(tmp_path: Path) -> None:
    """`config` es app-level: no debe arrastrar `items` para resolver una ruta."""
    codigo = (
        "import sys\n"
        "import events_core.config\n"
        "print(any(m == 'events_core.items' or m.startswith('events_core.items.')"
        " for m in sys.modules))\n"
    )
    entorno = {
        **os.environ,
        "EVENTSUI_CONFIG": str(tmp_path / "config.json"),
        "EVENTSUI_REGISTRO_DB": str(tmp_path / "registro.sqlite"),
    }

    salida = subprocess.run(
        [sys.executable, "-c", codigo], capture_output=True, text=True, env=entorno
    )

    assert salida.returncode == 0, salida.stderr
    assert salida.stdout.strip() == "False", "config importó events_core.items"
