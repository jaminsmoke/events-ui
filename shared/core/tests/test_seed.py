"""`seed` importado no debe ejecutar la CLI ni salir con `SystemExit`."""

from __future__ import annotations

import subprocess
import sys

from events_core import seed


def test_importarlo_deja_la_cli_disponible() -> None:
    # Si el módulo ejecutara `main` al importarse, este import habría salido con 2.
    assert callable(seed.main)


def test_la_cli_sin_repo_sale_con_2() -> None:
    r = subprocess.run(
        [sys.executable, "-m", "events_core.seed"],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 2, r.stderr
    assert "uso: python -m events_core.seed" in r.stderr
