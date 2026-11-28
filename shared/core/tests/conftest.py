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


# Lo que la 0034 renombró, para poder deshacerlo sobre un almacén recién creado
# y probar la migración con datos de verdad en vez de con un esquema a mano.
# La 0035 (el lote) va aparte: se deshace sin tocar las tablas de ítems.
_TABLAS_0034 = (
    ("work_item_data", "idea_data"),
    ("work_item_node", "idea_node"),
    ("work_item_fase", "idea_fase"),
    ("work_item_requisito", "idea_requisito"),
    ("work_item_foto", "idea_foto"),
    ("work_item_fase_archivo", "idea_fase_archivo"),
    ("migracion_item", "migracion_idea"),
)
_COLUMNAS_0034 = (
    "work_item_fase",
    "work_item_requisito",
    "work_item_foto",
    "work_item_fase_archivo",
    "migracion_item",
)
_INDICES_0034 = (
    "work_item_cola_orden",
    "work_item_roadmap_unico",
    "work_item_node_estado",
    "work_item_node_estado_fecha",
    "migracion_item_uid",
)


def _deshacer_0036(conn) -> None:  # noqa: ANN001
    """Deja `work_item_data` como en la 0035: `kind` vuelve a admitir `idea`."""
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript(
        """
        CREATE TABLE work_item_data_v35 (
            id          INTEGER PRIMARY KEY,
            uid         TEXT    NOT NULL UNIQUE,
            title       TEXT    NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            content     TEXT    NOT NULL DEFAULT '',
            kind        TEXT    NOT NULL DEFAULT 'idea'
                        CHECK (kind IN ('idea', 'adr', 'note')),
            tags        TEXT    NOT NULL DEFAULT '[]'
                        CHECK (json_valid(tags) AND json_type(tags) = 'array'),
            verificacion_intentos INTEGER NOT NULL DEFAULT 0
                        CHECK (verificacion_intentos >= 0),
            depende_de  TEXT    NOT NULL DEFAULT '[]'
                        CHECK (json_valid(depende_de) AND json_type(depende_de) = 'array'),
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL
        );
        INSERT INTO work_item_data_v35
        SELECT id, uid, title, description, content,
               CASE kind WHEN 'work_item' THEN 'idea' ELSE kind END,
               tags, verificacion_intentos, depende_de, created_at, updated_at
        FROM work_item_data;
        DROP TABLE work_item_data;
        ALTER TABLE work_item_data_v35 RENAME TO work_item_data;
        """
    )
    conn.execute("PRAGMA foreign_keys = ON")


@pytest.fixture()
def bajar_a_la_0033():
    """Baja un almacén recién creado a la 0033, 0034 o 0035.

    Deshace la 0036 (el `kind`), la 0035 (el lote) y la 0034 (las tablas), en
    ese orden. Devuelve la función `bajar(db, version)`; el llamador sigue
    abriendo el almacén con `ensure_repo` para que corran las migraciones.
    """
    import sqlite3
    from contextlib import closing

    def bajar(db: Path, version: int = 33) -> None:
        with closing(sqlite3.connect(str(db))) as conn:
            _deshacer_0036(conn)
            if version == 35:
                conn.execute("PRAGMA user_version = 35")
                conn.commit()
                return
            if version == 34:
                # La 0035: el lote vuelve a `migracion_idea` y su índice
                # (`migracion_item_uid`) lo sigue en el renombrado.
                conn.execute("ALTER TABLE migracion_item RENAME TO migracion_idea")
                conn.execute("PRAGMA user_version = 34")
                conn.commit()
                return
            if version <= 32:
                conn.execute("DROP INDEX work_item_node_estado_fecha")
                conn.execute("ALTER TABLE work_item_node DROP COLUMN created_at")
                conn.execute("ALTER TABLE work_item_node DROP COLUMN id")
            for indice in _INDICES_0034:
                conn.execute(f"DROP INDEX IF EXISTS {indice}")
            for tabla in _COLUMNAS_0034:
                conn.execute(f"ALTER TABLE {tabla} RENAME COLUMN work_item_uid TO idea_uid")
            for nuevo, viejo in _TABLAS_0034:
                conn.execute(f"ALTER TABLE {nuevo} RENAME TO {viejo}")
            conn.executescript(
                """
                CREATE UNIQUE INDEX idea_cola_orden
                    ON idea_node (posicion) WHERE estado = 'proposed';
                CREATE UNIQUE INDEX idea_roadmap_unico
                    ON idea_node (estado) WHERE estado = 'roadmap';
                CREATE INDEX migracion_idea_uid ON migracion_idea (idea_uid);
                """
            )
            if version >= 32:
                conn.execute("CREATE INDEX idea_node_estado ON idea_node (estado, posicion)")
            if version > 32:
                conn.execute(
                    "CREATE INDEX idea_node_estado_fecha ON idea_node (estado, created_at, id)"
                )
            conn.execute(f"PRAGMA user_version = {version}")
            conn.commit()

    return bajar
