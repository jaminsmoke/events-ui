"""Las puertas del flujo: política, lectura y lo que no puede cerrar."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from events_core import cli, config, mcp_servidor
from events_core.items import InvalidInput, resolve_repo
from events_core.items.base.esquema import ensure_repo
from events_core.items.modelo import puertas

# `services/core/tests/test_puertas.py` -> raíz del proyecto.
RAIZ = Path(__file__).resolve().parents[3]


def _protocolo(carpeta: Path, datos: object) -> None:
    destino = puertas.ruta(carpeta)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(datos), encoding="utf-8")


def _ficha_en_roadmap(client, repo, fases=True):  # noqa: ANN001, ANN202
    """Un ítem activo, con o sin desglose, y su uid."""
    uid = client.post("/items", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    if not fases:
        return uid
    client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "proposed"})
    desglose = [{"titulo": "Una", "requisitos": [{"titulo": "Criterio"}]}]
    r = client.patch(
        f"/items/{uid}",
        params={"repo": repo},
        json={"status": "roadmap", "fases": desglose},
    )
    assert r.status_code == 200, r.json()
    return uid


def test_sin_archivo_valen_los_presets(tmp_path: Path) -> None:
    definidas = puertas.definiciones(tmp_path)

    assert [d.preset.id for d in definidas] == [p.id for p in puertas.PRESETS]
    assert all(d.activa and d.desde == "preset" for d in definidas)


def test_el_archivo_apaga_una_puerta(tmp_path: Path) -> None:
    _protocolo(
        tmp_path,
        {"version": 1, "puertas": [{"id": "una-ficha-a-la-vez", "activa": False}]},
    )

    por_id = {d.preset.id: d for d in puertas.definiciones(tmp_path)}

    assert por_id["una-ficha-a-la-vez"].activa is False
    assert por_id["una-ficha-a-la-vez"].desde == "repo"
    assert por_id["sin-ficha-activa"].activa is True
    assert por_id["sin-ficha-activa"].desde == "preset"


def test_el_archivo_cambia_el_motivo(tmp_path: Path) -> None:
    _protocolo(
        tmp_path,
        {"version": 1, "puertas": [{"id": "sin-ficha-activa", "motivo": "Primero la ficha."}]},
    )

    por_id = {d.preset.id: d for d in puertas.definiciones(tmp_path)}

    assert por_id["sin-ficha-activa"].motivo == "Primero la ficha."
    assert por_id["sin-ficha-activa"].desde == "repo"
    # Sin `motivo`, el archivo hereda el del core en vez de quedarse vacío.
    assert por_id["ficha-sin-fases"].motivo == puertas.PRESETS[1].motivo


def test_un_json_roto_falla_con_el_archivo(tmp_path: Path) -> None:
    destino = puertas.ruta(tmp_path)
    destino.parent.mkdir(parents=True)
    destino.write_text("{no", encoding="utf-8")

    with pytest.raises(InvalidInput, match="no es JSON válido"):
        puertas.definiciones(tmp_path)


def test_una_puerta_desconocida_falla(tmp_path: Path) -> None:
    _protocolo(tmp_path, {"version": 1, "puertas": [{"id": "inventada"}]})

    with pytest.raises(InvalidInput, match="puerta desconocida: inventada"):
        puertas.definiciones(tmp_path)


def test_una_version_desconocida_falla(tmp_path: Path) -> None:
    _protocolo(tmp_path, {"version": 2, "puertas": []})

    with pytest.raises(InvalidInput, match="version"):
        puertas.definiciones(tmp_path)


def test_una_puerta_no_puede_cerrar_lo_que_la_abre() -> None:
    mala = puertas.Preset(
        id="mala",
        motivo="",
        cierra=("item_move",),
        abren=("item_move",),
        evalua=lambda estado: True,
    )

    with pytest.raises(InvalidInput, match="cierra lo que la abre: item_move"):
        puertas._comprobar((mala,))

    # Las de verdad pasan la comprobación.
    puertas._comprobar(puertas.PRESETS)


def test_las_herramientas_de_las_puertas_existen() -> None:
    nombres = set(mcp_servidor.HERRAMIENTAS)

    for preset in puertas.PRESETS:
        assert set(preset.cierra) <= nombres, preset.id
        assert set(preset.abren) <= nombres, preset.id


def test_sin_ficha_activa_cierra_las_fases(client, repo) -> None:  # noqa: ANN001, ANN202
    activas = client.get("/puertas", params={"repo": repo}).json()

    assert [p["id"] for p in activas] == ["sin-ficha-activa"]
    assert activas[0]["desde"] == "preset"
    assert set(activas[0]["cierra"]) == {"item_fases", "item_requisito"}


def test_una_ficha_con_fases_solo_avisa_de_que_roadmap_esta_ocupado(
    client,
    repo,  # noqa: ANN001, ANN202
) -> None:
    _ficha_en_roadmap(client, repo)

    activas = client.get("/puertas", params={"repo": repo}).json()

    assert [p["id"] for p in activas] == ["una-ficha-a-la-vez"]
    assert activas[0]["cierra"] == []


def test_una_ficha_sin_fases_cierra_los_requisitos(client, repo) -> None:  # noqa: ANN001, ANN202
    r = client.post("/items", params={"repo": repo}, json={"title": "A", "status": "roadmap"})
    assert r.status_code == 201, r.json()

    activas = {p["id"]: p for p in client.get("/puertas", params={"repo": repo}).json()}

    assert activas["ficha-sin-fases"]["cierra"] == ["item_requisito"]
    assert "una-ficha-a-la-vez" in activas


def test_verificando_cierra_fases_y_requisitos(client, repo) -> None:  # noqa: ANN001, ANN202
    uid = _ficha_en_roadmap(client, repo)
    desglose = [
        {
            "titulo": "Una",
            "estado": "completada",
            "requisitos": [{"titulo": "Criterio", "hecho": True}],
        }
    ]
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"fases": desglose})
    assert r.status_code == 200, r.json()
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 200, r.json()

    activas = {p["id"]: p for p in client.get("/puertas", params={"repo": repo}).json()}

    assert set(activas["verificando-no-se-toca"]["cierra"]) == {
        "item_fases",
        "item_requisito",
    }


def test_documentos_fuera_del_flujo_cierra_el_apply(client, repo) -> None:  # noqa: ANN001, ANN202
    # Un marcador que el almacén no conoce: la purga de `.EUI` no lo toca (vive
    # fuera) y la guarda sí lo ve.
    carpeta = resolve_repo(repo)
    (carpeta / "PARCIAL.md").write_text(
        "- [eui:0123456789abcdef0123456789abcdef] Uno\n", encoding="utf-8"
    )

    activas = {p["id"]: p for p in client.get("/puertas", params={"repo": repo}).json()}

    assert activas["documentos-fuera-del-flujo"]["cierra"] == ["migrate_apply"]


def test_cli_puertas_json(tmp_path: Path, capsys, monkeypatch) -> None:  # noqa: ANN001, ANN202
    config.guardar(repo=str(tmp_path))
    visto: dict[str, str] = {}
    fila = {
        "id": "sin-ficha-activa",
        "motivo": "Mueve una.",
        "desde": "preset",
        "cierra": ["item_fases"],
    }

    def falso(url: str):
        visto["url"] = url
        return ([fila], None, 200)

    monkeypatch.setattr(cli, "_get", falso)

    assert cli.main(["puertas", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["id"] == "sin-ficha-activa"
    assert "/puertas?" in visto["url"]
    assert "repo=" in visto["url"]


def test_cli_puertas_texto(tmp_path: Path, capsys, monkeypatch) -> None:  # noqa: ANN001, ANN202
    config.guardar(repo=str(tmp_path))
    fila = {
        "id": "una-ficha-a-la-vez",
        "motivo": "Roadmap ocupado.",
        "desde": "repo",
        "cierra": [],
    }
    monkeypatch.setattr(cli, "_get", lambda url: ([fila], None, 200))

    assert cli.main(["puertas"]) == 0
    salida = capsys.readouterr().out
    assert "una-ficha-a-la-vez" in salida
    assert "informativa" in salida


def test_cli_puertas_sin_ninguna(tmp_path: Path, capsys, monkeypatch) -> None:  # noqa: ANN001
    config.guardar(repo=str(tmp_path))
    monkeypatch.setattr(cli, "_get", lambda url: ([], None, 200))

    assert cli.main(["puertas"]) == 0
    assert "ninguna puerta activa" in capsys.readouterr().out


def test_cli_puertas_sin_raiz_sale_con_2(capsys) -> None:  # noqa: ANN001
    assert cli.main(["puertas"]) == 2
    assert "no hay raíz" in capsys.readouterr().err


def test_el_esquema_del_protocolo_se_publica(capsys) -> None:  # noqa: ANN001
    assert cli.main(["schema", "puertas"]) == 0

    esquema = json.loads(capsys.readouterr().out)

    assert "version" in esquema["properties"]
    assert esquema["properties"]["puertas"]["type"] == "array"


def test_la_purga_de_eui_respeta_la_politica(tmp_path: Path) -> None:
    _protocolo(tmp_path, {"version": 1, "puertas": []})
    suelto = tmp_path / ".EUI" / "suelto.txt"
    suelto.write_text("x", encoding="utf-8")

    ensure_repo(str(tmp_path))

    assert puertas.ruta(tmp_path).exists()
    assert not suelto.exists()


def test_el_protocolo_del_repo_queda_versionado() -> None:
    reglas = (RAIZ / ".gitignore").read_text(encoding="utf-8").splitlines()

    assert ".EUI/*" in reglas
    assert "!.EUI/protocolos.json" in reglas

    if shutil.which("git") is None:
        pytest.skip("git no está instalado")
    # 1 = no ignorado; 0 sería el fallo que este test evita.
    resultado = subprocess.run(
        ["git", "check-ignore", "-q", ".EUI/protocolos.json"],
        cwd=RAIZ,
        capture_output=True,
    )
    assert resultado.returncode == 1, resultado.stderr.decode("utf-8", "replace")
