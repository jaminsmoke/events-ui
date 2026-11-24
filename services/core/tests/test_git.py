"""Detección de Git en la proyección del repo.

El nodo Git del mapa no puede depender de que el ejecutable exista: tiene que
haber un work tree. Un `git init` sin commits ya cuenta, pero una carpeta
ignorada por el repo que la contiene no. Es el caso del laboratorio dentro del
repo de la aplicación.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from events_core import archivos, git_local

GIT = shutil.which("git")


pytestmark = pytest.mark.skipif(GIT is None, reason="git no está instalado")


def _git(carpeta: Path, *args: str) -> None:
    subprocess.run(
        [GIT or "git", *args],
        cwd=carpeta,
        check=True,
        capture_output=True,
        text=True,
    )


def _inicializar(carpeta: Path) -> None:
    carpeta.mkdir(parents=True, exist_ok=True)
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")


def _proyeccion(client, carpeta: Path) -> dict:  # noqa: ANN001
    r = client.get("/proyecciones/repo", params={"repo": str(carpeta)})
    assert r.status_code == 200, r.json()
    return r.json()


def test_carpeta_sin_git_se_queda_apagada(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "suelta"
    carpeta.mkdir()

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is False
    assert datos["git_root"] is None
    assert datos["branch"] is None
    assert datos["commit"] is None
    assert datos["git_cambios"] == []


def test_git_init_sin_commits_enciende_y_conserva_la_rama(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "nuevo"
    _inicializar(carpeta)

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is True
    assert Path(datos["git_root"]).resolve() == carpeta.resolve()
    assert datos["branch"] == "main"
    assert datos["commit"] is None


def test_repo_con_commit_expone_rama_y_hash(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "con-commit"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", "nota.txt")
    _git(carpeta, "commit", "-m", "inicial")

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is True
    assert datos["branch"] == "main"
    assert isinstance(datos["commit"], str) and len(datos["commit"]) >= 7


def test_cambios_sin_commit_incluyen_modificados_y_sin_seguimiento(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "cambios"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", "nota.txt")
    _git(carpeta, "commit", "-m", "inicial")
    (carpeta / "nota.txt").write_text("hola cambiado", encoding="utf-8")
    (carpeta / "nuevo.txt").write_text("nuevo", encoding="utf-8")

    datos = _proyeccion(client, carpeta)

    cambios = {(cambio["estado"], cambio["ruta"]) for cambio in datos["git_cambios"]}
    assert ("M", "nota.txt") in cambios
    assert ("??", "nuevo.txt") in cambios


def test_subcarpeta_de_un_repo_hereda_el_work_tree(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "raiz"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    datos = _proyeccion(client, sub)

    assert datos["git"] is True
    assert Path(datos["git_root"]).resolve() == raiz.resolve()
    assert datos["branch"] == "main"
    assert datos["commit"] is not None


def test_la_foto_de_fase_solo_acepta_el_repo_propio(tmp_path):  # noqa: ANN001, ANN202
    """La proyección acepta el repo contenedor; el parche de una fase, no.

    Una subcarpeta de otro repo forma parte de él para la identidad del mapa,
    pero sus archivos no son trabajo de el ítem: sin repo propio la foto se
    queda en rutas y estado, como decidió el producto. Las dos reglas salen de
    `git_local._git_repo`, así que un cambio en el repo contenedor llega a las
    dos a la vez.
    """
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    es_git, git_root = git_local._git_repo(sub)
    assert es_git is True
    assert Path(git_root).resolve() == raiz.resolve()
    assert archivos.hay_git(sub) is False

    propio = tmp_path / "propio"
    _inicializar(propio)
    assert archivos.hay_git(propio) is True


def test_carpeta_ignorada_por_el_repo_contenedor_no_cuenta(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / ".gitignore").write_text("ignorado/\n", encoding="utf-8")
    _git(raiz, "add", ".gitignore")
    _git(raiz, "commit", "-m", "ignorar laboratorio")
    ignorado = raiz / "ignorado"
    ignorado.mkdir()

    datos = _proyeccion(client, ignorado)

    assert datos["git"] is False
    assert datos["git_root"] is None
    assert datos["branch"] is None
    assert datos["commit"] is None
    assert datos["git_cambios"] == []


def test_repo_propio_dentro_de_una_carpeta_ignorada_si_cuenta(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / ".gitignore").write_text("laboratorio/\n", encoding="utf-8")
    _git(raiz, "add", ".gitignore")
    _git(raiz, "commit", "-m", "ignorar laboratorio")
    laboratorio = raiz / "laboratorio"
    _inicializar(laboratorio)

    datos = _proyeccion(client, laboratorio)

    assert datos["git"] is True
    assert Path(datos["git_root"]).resolve() == laboratorio.resolve()
    assert datos["branch"] == "main"
    assert datos["commit"] is None


def test_crear_repo_local_enciende_el_puente(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "suelta"
    carpeta.mkdir()

    r = client.post("/git/inicializar", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    datos = r.json()
    assert datos["git"] is True
    assert datos["branch"] == "main"
    assert (carpeta / ".git").is_dir()


def test_eliminar_repo_local_apaga_el_puente(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "propio"
    _inicializar(carpeta)

    r = client.post("/git/eliminar", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    assert r.json()["git"] is False
    assert not (carpeta / ".git").exists()


def test_eliminar_rechaza_el_repo_del_contenedor(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    r = client.post("/git/eliminar", params={"repo": str(sub)})

    assert r.status_code == 400, r.json()
    assert (raiz / ".git").is_dir()


def test_inicializar_rechaza_un_repo_ya_existente(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "propio"
    _inicializar(carpeta)

    r = client.post("/git/inicializar", params={"repo": str(carpeta)})

    assert r.status_code == 400, r.json()


def test_inicializar_no_anida_en_subcarpeta_de_un_repo(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    r = client.post("/git/inicializar", params={"repo": str(sub)})

    assert r.status_code == 400, r.json()
    assert not (sub / ".git").exists()


def test_inicializar_en_carpeta_ignorada_gana_al_contenedor(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / ".gitignore").write_text("laboratorio/\n", encoding="utf-8")
    _git(raiz, "add", ".gitignore")
    _git(raiz, "commit", "-m", "ignorar laboratorio")
    laboratorio = raiz / "laboratorio"
    laboratorio.mkdir()

    r = client.post("/git/inicializar", params={"repo": str(laboratorio)})

    assert r.status_code == 200, r.json()
    assert r.json()["git"] is True
    assert (laboratorio / ".git").is_dir()


def test_los_renombrados_separan_origen_y_destino(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "renombres"
    _inicializar(carpeta)
    (carpeta / "viejo nombre.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "inicial")
    _git(carpeta, "mv", "viejo nombre.txt", "nuevo ñ.txt")

    datos = _proyeccion(client, carpeta)

    cambios = {(c["estado"], c["ruta"], c.get("origen")) for c in datos["git_cambios"]}
    assert ("R", "nuevo ñ.txt", "viejo nombre.txt") in cambios
    assert not any("->" in c["ruta"] for c in datos["git_cambios"])


def test_las_rutas_con_acentos_o_almohadillas_llegan_tal_cual(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "raras"
    _inicializar(carpeta)
    (carpeta / "con acentos ñ y #.txt").write_text("hola", encoding="utf-8")

    datos = _proyeccion(client, carpeta)

    cambios = {(c["estado"], c["ruta"], c.get("origen")) for c in datos["git_cambios"]}
    assert ("??", "con acentos ñ y #.txt", None) in cambios


def test_historial_lista_los_commits_del_mas_nuevo_al_mas_viejo(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "historial"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("uno", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "primer commit")
    (carpeta / "nota.txt").write_text("dos", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "segundo commit con ñ")

    r = client.get("/git/commits", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    commits = r.json()
    assert [c["asunto"] for c in commits] == ["segundo commit con ñ", "primer commit"]
    assert all(c["hash"] for c in commits)
    assert commits[0]["autor"] == "Test"
    assert "T" in commits[0]["fecha"]


def test_historial_vacio_sin_commits_y_sin_git(client, tmp_path):  # noqa: ANN001, ANN202
    sin_commits = tmp_path / "sin-commits"
    _inicializar(sin_commits)
    suelta = tmp_path / "suelta"
    suelta.mkdir()

    assert client.get("/git/commits", params={"repo": str(sin_commits)}).json() == []
    assert client.get("/git/commits", params={"repo": str(suelta)}).json() == []


def test_commit_local_deja_historial_y_limpia_los_cambios(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "commit"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    (carpeta / "nueva.txt").write_text("nueva", encoding="utf-8")
    # La proyección siembra el `.EUI` del repo: el almacén de la app ya está en
    # disco cuando se commitea, y no puede salir en la lista ni entrar al commit.
    antes = _proyeccion(client, carpeta)
    assert not any(c["ruta"].startswith(".EUI/") for c in antes["git_cambios"])

    r = client.post("/git/commit", params={"repo": str(carpeta)}, json={"mensaje": "primer commit"})

    assert r.status_code == 200, r.json()
    datos = r.json()
    # Sin remoto: el commit es local y la proyección vuelve ya limpia.
    assert datos["git_cambios"] == []
    assert datos["commit"] is not None
    historial = client.get("/git/commits", params={"repo": str(carpeta)}).json()
    assert [c["asunto"] for c in historial] == ["primer commit"]
    seguidos = subprocess.run(
        [GIT or "git", "-C", str(carpeta), "ls-files"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert sorted(seguidos.stdout.split()) == ["nota.txt", "nueva.txt"]


def test_commit_con_el_almacen_en_el_exclude_commitea_igual(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "ignorado"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    # Así está el laboratorio: el almacén queda fuera del árbol desde
    # `.git/info/exclude`. Nombrar esa ruta en el `git add` hacía que Git se
    # negara («paths are ignored») y el commit muriera en un 400 sin que
    # faltara nada por commitear.
    exclude = carpeta / ".git" / "info" / "exclude"
    exclude.write_text(exclude.read_text(encoding="utf-8") + ".EUI/\n", encoding="utf-8")
    _proyeccion(client, carpeta)  # siembra el almacén, ya ignorado

    r = client.post("/git/commit", params={"repo": str(carpeta)}, json={"mensaje": "primer commit"})

    assert r.status_code == 200, r.json()
    assert r.json()["git_cambios"] == []
    seguidos = subprocess.run(
        [GIT or "git", "-C", str(carpeta), "ls-files"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert sorted(seguidos.stdout.split()) == ["nota.txt"]


def test_commit_sin_cambios_es_400(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "limpio"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "inicial")

    r = client.post("/git/commit", params={"repo": str(carpeta)}, json={"mensaje": "nada"})

    assert r.status_code == 400, r.json()
    assert "cambios" in r.json()["detail"]


def test_commit_rechaza_un_mensaje_en_blanco(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "blanco"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")

    vacio = client.post("/git/commit", params={"repo": str(carpeta)}, json={"mensaje": ""})
    espacios = client.post("/git/commit", params={"repo": str(carpeta)}, json={"mensaje": "   "})

    # El contrato ya no admite la cadena vacía; los espacios los corta el core.
    assert vacio.status_code == 422
    assert espacios.status_code == 400
    assert _proyeccion(client, carpeta)["commit"] is None


def test_commit_fuera_del_repo_propio_es_400(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", ".")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()
    (sub / "otra.txt").write_text("otra", encoding="utf-8")
    antes = _proyeccion(client, raiz)["commit"]

    r = client.post("/git/commit", params={"repo": str(sub)}, json={"mensaje": "desde la sub"})

    assert r.status_code == 400, r.json()
    despues = _proyeccion(client, raiz)
    assert despues["commit"] == antes
    assert any(c["ruta"] == "sub/otra.txt" for c in despues["git_cambios"])


def test_historial_respeta_el_limite(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "tres"
    _inicializar(carpeta)
    for n in range(3):
        (carpeta / "nota.txt").write_text(str(n), encoding="utf-8")
        _git(carpeta, "add", ".")
        _git(carpeta, "commit", "-m", f"commit {n}")

    commits = client.get("/git/commits", params={"repo": str(carpeta), "limite": 2}).json()

    assert [c["asunto"] for c in commits] == ["commit 2", "commit 1"]


def test_el_almacen_se_versiona_por_defecto_y_se_puede_ignorar(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "versionado"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "inicial")

    antes = _proyeccion(client, carpeta)  # siembra `.EUI` y su `.gitignore`
    assert antes["eui_ignorado"] is False

    r = client.post("/git/ignorar-almacen", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    assert r.json()["eui_ignorado"] is True
    assert (carpeta / ".gitignore").read_text(encoding="utf-8") == ".EUI/\n"
    # Idempotente: la segunda pasada no duplica la línea.
    assert client.post("/git/ignorar-almacen", params={"repo": str(carpeta)}).status_code == 200
    assert (carpeta / ".gitignore").read_text(encoding="utf-8") == ".EUI/\n"


def test_ignorar_el_almacen_conserva_las_otras_lineas(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "lineas"
    _inicializar(carpeta)
    (carpeta / ".gitignore").write_text("dist/\n*.log", encoding="utf-8")
    _git(carpeta, "add", ".gitignore")
    _git(carpeta, "commit", "-m", "ignorar")

    r = client.post("/git/ignorar-almacen", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    texto = (carpeta / ".gitignore").read_text(encoding="utf-8")
    assert texto == "dist/\n*.log\n.EUI/\n"
    assert r.json()["eui_ignorado"] is True


def test_ignorar_el_almacen_sin_git_es_400(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "sin-git"
    carpeta.mkdir()

    r = client.post("/git/ignorar-almacen", params={"repo": str(carpeta)})

    assert r.status_code == 400, r.json()
    assert not (carpeta / ".gitignore").exists()


def test_sin_git_la_proyeccion_no_sabe_si_el_almacen_se_versiona(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "suelta"
    carpeta.mkdir()

    assert _proyeccion(client, carpeta)["eui_ignorado"] is None


def test_un_repo_con_acento_en_la_ruta_se_detecta(client, tmp_path):  # noqa: ANN001, ANN202
    """`rev-parse` da la ruta en UTF-8: decodificada en cp1252 no era la del disco."""
    carpeta = tmp_path / "laboratorio año"
    _inicializar(carpeta)
    (carpeta / "base.txt").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is True
    assert Path(datos["git_root"]).name == "laboratorio año"
