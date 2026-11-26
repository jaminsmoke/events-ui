"""Ficha 615cbeb0: `cli`, `migracion` y `mcp_servidor` son paquetes.

Los tres eran módulos de más de mil líneas y ahora son carpetas con trozos
pequeños. Partirlos no puede cambiar lo que ven fuera: la fachada conserva el
contrato (`cli.main`, `migracion.escanear`, `mcp_servidor.manejar`), los dos
`python -m` siguen arrancando, y ningún trozo pasa del tamaño de los demás.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from events_core import cli, mcp_servidor, migracion

PAQUETES = ("cli", "migracion", "mcp_servidor")
RAIZ = Path(__file__).resolve().parents[1] / "src" / "events_core"

# El tope que pidió la ficha: ~400 líneas. Cuatrocientas veinte deja aire para
# el docstring y los imports de cada trozo sin que ninguno vuelva a crecer.
LIMITE = 420


def test_las_tres_fachadas_responden() -> None:
    """Lo que importaba el resto del proyecto se sigue llamando igual."""
    assert callable(cli.main)
    assert callable(migracion.escanear)
    assert callable(mcp_servidor.manejar)


def test_la_version_sale_por_la_fachada_del_cli(capsys) -> None:
    with pytest.raises(SystemExit) as salida:
        cli.main(["--version"])
    assert salida.value.code == 0
    assert capsys.readouterr().out.strip()


def test_escanear_sigue_leyendo_un_repo(tmp_path: Path) -> None:
    informe = migracion.escanear(tmp_path)
    assert Path(informe.repo) == tmp_path
    assert informe.archivos == []


def test_manejar_contesta_al_saludo_del_mcp() -> None:
    respuesta = mcp_servidor.manejar(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "prueba", "version": "0"},
            },
        }
    )
    assert respuesta is not None
    assert respuesta["result"]["serverInfo"]["name"]


def test_los_dos_python_m_arrancan() -> None:
    for modulo in ("events_core.cli", "events_core.mcp_servidor"):
        salida = subprocess.run(
            [sys.executable, "-m", modulo, "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        assert salida.returncode == 0, salida.stderr
        assert "usage" in salida.stdout.lower()


def test_los_tres_son_paquetes_y_ningun_trozo_se_desborda() -> None:
    """Un módulo suelto no cumple la ficha, y un trozo grande tampoco."""
    sueltos = [paquete for paquete in PAQUETES if (RAIZ / f"{paquete}.py").exists()]
    assert not sueltos, "siguen siendo módulos sueltos: " + ", ".join(sueltos)

    grandes = []
    for paquete in PAQUETES:
        carpeta = RAIZ / paquete
        assert (carpeta / "__init__.py").is_file(), f"{paquete} no tiene fachada"
        for ruta in sorted(carpeta.glob("*.py")):
            lineas = len(ruta.read_text(encoding="utf-8").splitlines())
            if lineas > LIMITE:
                grandes.append(f"{paquete}/{ruta.name}: {lineas} líneas")
    assert not grandes, f"módulos por encima de {LIMITE} líneas: " + ", ".join(grandes)
