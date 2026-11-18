"""Instantánea consistente de un almacén versionado con WAL activo."""

from __future__ import annotations

import shutil
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from events_core.instantanea import copia_consistente, main


def _uids(db: Path) -> list[str]:
    """UIDs que ve una conexión limpia; si la tabla no llegó a la copia, []."""
    with closing(sqlite3.connect(db)) as conn:
        try:
            filas = conn.execute("SELECT uid FROM idea_entry ORDER BY uid")
            return [str(fila[0]) for fila in filas]
        except sqlite3.OperationalError:
            return []


def _almacen_con_wal(db: Path) -> sqlite3.Connection:
    """Almacén WAL con una fila confirmada y sin checkpoint automático."""
    escritor = sqlite3.connect(db)
    escritor.execute("PRAGMA journal_mode = WAL")
    escritor.execute("PRAGMA wal_autocheckpoint = 0")
    escritor.execute("CREATE TABLE idea_entry (uid TEXT PRIMARY KEY)")
    escritor.execute("INSERT INTO idea_entry VALUES ('uno')")
    escritor.commit()
    return escritor


def test_la_copia_incluye_el_wal_confirmado(tmp_path: Path) -> None:
    origen = tmp_path / "EUI_DATABASE.sqlite"
    escritor = _almacen_con_wal(origen)
    try:
        # La copia a mano del fichero principal pierde lo que vive en el WAL.
        a_mano = tmp_path / "a-mano.sqlite"
        shutil.copyfile(origen, a_mano)
        assert _uids(a_mano) == []

        copia = tmp_path / "copia.sqlite"
        copia_consistente(origen, copia)
    finally:
        escritor.close()

    assert _uids(copia) == ["uno"]
    assert not Path(f"{copia}-wal").exists()
    assert not Path(f"{copia}-shm").exists()


def test_el_comando_deja_una_copia_abrible_sola(tmp_path: Path, capsys) -> None:
    origen = tmp_path / "EUI_DATABASE.sqlite"
    _almacen_con_wal(origen).close()
    copia = tmp_path / "destino" / "copia.sqlite"

    assert main([str(origen), str(copia)]) == 0
    assert _uids(copia) == ["uno"]
    assert "instantánea" in capsys.readouterr().out


def test_errores_de_uso(tmp_path: Path) -> None:
    origen = tmp_path / "EUI_DATABASE.sqlite"
    _almacen_con_wal(origen).close()

    with pytest.raises(ValueError, match="propio almacén"):
        copia_consistente(origen, origen)
    with pytest.raises(FileNotFoundError):
        copia_consistente(tmp_path / "falta.sqlite", tmp_path / "copia.sqlite")
    assert main([]) == 2
