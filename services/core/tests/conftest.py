"""Aislamiento de los tests: temporales para repos y registro.

Los env vars tienen que estar antes de importar el core: `items` e
`registro` resuelven rutas al leerlos. El TestClient acota a las rutas de
producción (sin rutas de prueba: con el `main` importado, añadir rutas a la
app es contaminar las demás pruebas).
"""

import os
import tempfile
from pathlib import Path

_RAIZ_TMP = Path(tempfile.mkdtemp(prefix="eui-tests-"))
(REPOS := _RAIZ_TMP / "repos").mkdir(parents=True, exist_ok=True)
os.environ["EVENTSUI_REPOS_ROOT"] = str(REPOS)
os.environ["EVENTSUI_REGISTRO_DB"] = str(_RAIZ_TMP / "registro.sqlite")
# La configuración compartida también es estado: fuera del perfil del usuario.
os.environ["EVENTSUI_CONFIG"] = str(_RAIZ_TMP / "config.json")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from events_core.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _config_limpia():
    """Cada test empieza sin `config.json`: es estado que comparten los tests."""
    from events_core import config

    ruta = config.ruta()
    ruta.unlink(missing_ok=True)
    yield
    ruta.unlink(missing_ok=True)


@pytest.fixture()
def repo() -> str:
    """Un repo de laboratorio nuevo, por nombre (sin colisiones entre tests)."""
    import uuid

    nombre = f"lab-{uuid.uuid4().hex[:8]}"
    (REPOS / nombre).mkdir(exist_ok=True)
    return nombre
