"""Los archivos de cada fase (0028): fotos por evento, sin watcher.

Cubre las dos caras: sin Git se anotan las rutas y su estado —sin contenido— y
con Git se añade el parche. También la cadena entre fases (cada cierre mide
desde el anterior) y que reabrir una fase suelta lo anotado.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

import pytest

from events_core import archivos

GIT = shutil.which("git")


def _git(carpeta: Path, *args: str) -> None:
    subprocess.run([GIT or "git", *args], cwd=carpeta, check=True, capture_output=True, text=True)


def _en_roadmap(client, carpeta: Path) -> str:  # noqa: ANN001
    """Una idea en roadmap con una fase pendiente: ahí empieza el trabajo."""
    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={"title": "A", "status": "proposed"},
    )
    assert r.status_code == 201, r.json()
    uid = r.json()["uid"]
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": str(carpeta)},
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]}],
        },
    )
    assert r.status_code == 200, r.json()
    return uid


def _cerrar(client, carpeta: Path, uid: str, orden: int = 1, titulo: str = "Diseño"):  # noqa: ANN001, ANN202
    """Cierra la fase por la vía normal: requisito hecho y estado completada."""
    ficha = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    fases = [
        {
            "orden": fase["orden"],
            "titulo": fase["titulo"],
            "estado": fase["estado"],
            "requisitos": [
                {"orden": requisito["orden"], "titulo": requisito["titulo"], "hecho": True}
                for requisito in fase["requisitos"]
            ],
        }
        for fase in ficha["fases"]
    ]
    for fase in fases:
        if fase["orden"] == orden:
            fase["estado"] = "completada"
    r = client.patch(f"/ideas/{uid}", params={"repo": str(carpeta)}, json={"fases": fases})
    assert r.status_code == 200, r.json()
    return next(fase for fase in r.json()["fases"] if fase["orden"] == orden)


def test_sin_git_anota_rutas_y_estado_sin_contenido(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "sin-git"
    carpeta.mkdir()
    (carpeta / "base.txt").write_text("hola", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "nuevo.txt").write_text("más", encoding="utf-8")
    (carpeta / "base.txt").write_text("hola, más largo", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)

    assert [(archivo["ruta"], archivo["estado"]) for archivo in fase["archivos"]] == [
        ("base.txt", "modificado"),
        ("nuevo.txt", "nuevo"),
    ]
    # Sin Git no se guarda contenido; la base del propio repo tampoco cuenta.
    assert all(archivo["contenido"] is None for archivo in fase["archivos"])


def test_sin_git_anota_el_borrado(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "borrado"
    carpeta.mkdir()
    (carpeta / "se-va.txt").write_text("x", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "se-va.txt").unlink()
    fase = _cerrar(client, carpeta, uid)

    assert fase["archivos"] == [
        {"ruta": "se-va.txt", "estado": "borrado", "desde": None, "contenido": None}
    ]


def test_sin_git_un_renombrado_es_una_sola_fila(client, tmp_path):  # noqa: ANN001, ANN202
    """Mover un archivo conserva su huella: no son un borrado y un nuevo."""
    carpeta = tmp_path / "renombrado"
    carpeta.mkdir()
    (carpeta / "viejo.txt").write_text("contenido", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "viejo.txt").rename(carpeta / "nuevo.txt")
    fase = _cerrar(client, carpeta, uid)

    assert fase["archivos"] == [
        {
            "ruta": "nuevo.txt",
            "estado": "renombrado",
            "desde": "viejo.txt",
            "contenido": None,
        }
    ]


def test_cada_cierre_mide_desde_el_anterior(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "cadena"
    carpeta.mkdir()
    (carpeta / "uno.txt").write_text("uno", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "uno.txt").write_text("uno, tocado", encoding="utf-8")
    assert [archivo["ruta"] for archivo in _cerrar(client, carpeta, uid)["archivos"]] == ["uno.txt"]

    # Segunda fase: la foto de referencia es el cierre de la primera, no el
    # principio del roadmap; el archivo de antes ya no se vuelve a anotar.
    ficha = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": str(carpeta)},
        json={
            "fases": [
                *[
                    {
                        "orden": fase["orden"],
                        "titulo": fase["titulo"],
                        "estado": fase["estado"],
                        "requisitos": [
                            {
                                "orden": requisito["orden"],
                                "titulo": requisito["titulo"],
                                "hecho": requisito["hecho"],
                            }
                            for requisito in fase["requisitos"]
                        ],
                    }
                    for fase in ficha["fases"]
                ],
                {"titulo": "Prueba", "requisitos": [{"titulo": "Pasa lint"}]},
            ]
        },
    )
    assert r.status_code == 200, r.json()

    (carpeta / "dos.txt").write_text("dos", encoding="utf-8")
    segunda = _cerrar(client, carpeta, uid, orden=2, titulo="Prueba")
    assert [archivo["ruta"] for archivo in segunda["archivos"]] == ["dos.txt"]


def test_reabrir_la_fase_suelta_sus_archivos(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "reabrir"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "tocado.txt").write_text("x", encoding="utf-8")
    assert _cerrar(client, carpeta, uid)["archivos"]

    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": str(carpeta)},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Diseño",
                    "estado": "pendiente",
                    "requisitos": [{"orden": 1, "titulo": "Cubre el borde"}],
                }
            ]
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["fases"][0]["archivos"] == []


def test_el_mapa_lleva_el_recuento_sin_el_parche(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "mapa"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "a.txt").write_text("a", encoding="utf-8")
    _cerrar(client, carpeta, uid)

    idea = client.get("/mapa", params={"repo": str(carpeta)}).json()["ideas"][0]
    assert [archivo["ruta"] for archivo in idea["fases"][0]["archivos"]] == ["a.txt"]
    assert all(archivo["contenido"] is None for archivo in idea["fases"][0]["archivos"])


@pytest.mark.skipif(GIT is None, reason="git no está instalado")
def test_con_git_guarda_el_parche(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "con-git"
    carpeta.mkdir()
    (carpeta / "modulo.py").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "modulo.py").write_text("uno\ndos\n", encoding="utf-8")
    (carpeta / "nuevo.txt").write_text("hola\n", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)
    por_ruta = {archivo["ruta"]: archivo for archivo in fase["archivos"]}

    assert por_ruta["modulo.py"]["estado"] == "modificado"
    assert "+dos" in (por_ruta["modulo.py"]["contenido"] or "")
    assert por_ruta["nuevo.txt"]["estado"] == "nuevo"
    assert "hola" in (por_ruta["nuevo.txt"]["contenido"] or "")
    # La base del repo se escribe sola: no es un archivo de la fase.
    assert all(".EUI" not in archivo["ruta"] for archivo in fase["archivos"])


def _fases_payload(client, carpeta: Path, uid: str):  # noqa: ANN001, ANN202
    """Las fases como payload del PATCH, para retocarlas en el test."""
    ficha = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    return [
        {
            "orden": fase["orden"],
            "titulo": fase["titulo"],
            "estado": fase["estado"],
            "requisitos": [
                {
                    "orden": requisito["orden"],
                    "titulo": requisito["titulo"],
                    "hecho": requisito["hecho"],
                }
                for requisito in fase["requisitos"]
            ],
        }
        for fase in ficha["fases"]
    ]


def _guardar_fases(client, carpeta: Path, uid: str, fases):  # noqa: ANN001, ANN202
    """Manda las fases y devuelve la idea tal como queda."""
    r = client.patch(f"/ideas/{uid}", params={"repo": str(carpeta)}, json={"fases": fases})
    assert r.status_code == 200, r.json()
    return r.json()


def test_marcar_un_requisito_anota_lo_suyo(client, tmp_path):  # noqa: ANN001, ANN202
    """El evento es el requisito: lo que cambió hasta marcarlo es lo suyo."""
    carpeta = tmp_path / "requisito"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "pieza.py").write_text("x", encoding="utf-8")

    fases = _fases_payload(client, carpeta, uid)
    fases[0]["requisitos"][0]["hecho"] = True
    idea = _guardar_fases(client, carpeta, uid, fases)

    assert [archivo["ruta"] for archivo in idea["fases"][0]["requisitos"][0]["archivos"]] == [
        "pieza.py"
    ]
    # La fase suma lo de sus requisitos: el cierre sigue enseñando el total.
    assert [archivo["ruta"] for archivo in idea["fases"][0]["archivos"]] == ["pieza.py"]


def test_dos_requisitos_a_la_vez_se_quedan_en_la_fase(client, tmp_path):  # noqa: ANN001, ANN202
    """Marcar varios en el mismo PATCH no se puede repartir: va a la fase."""
    carpeta = tmp_path / "tanda"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)

    fases = _fases_payload(client, carpeta, uid)
    fases[0]["requisitos"].append({"orden": 2, "titulo": "Y el otro"})
    _guardar_fases(client, carpeta, uid, fases)

    (carpeta / "dos.py").write_text("x", encoding="utf-8")
    fases = _fases_payload(client, carpeta, uid)
    for requisito in fases[0]["requisitos"]:
        requisito["hecho"] = True
    idea = _guardar_fases(client, carpeta, uid, fases)

    assert all(not requisito["archivos"] for requisito in idea["fases"][0]["requisitos"])
    assert [archivo["ruta"] for archivo in idea["fases"][0]["archivos"]] == ["dos.py"]


def test_destildar_un_requisito_no_pierde_lo_anotado(client, tmp_path):  # noqa: ANN001, ANN202
    """Un clic de más no borra el registro: deshacer la marca solo deshace."""
    carpeta = tmp_path / "destildado"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "pieza.py").write_text("x", encoding="utf-8")

    fases = _fases_payload(client, carpeta, uid)
    fases[0]["requisitos"][0]["hecho"] = True
    assert _guardar_fases(client, carpeta, uid, fases)["fases"][0]["archivos"]

    fases = _fases_payload(client, carpeta, uid)
    fases[0]["requisitos"][0]["hecho"] = False
    idea = _guardar_fases(client, carpeta, uid, fases)

    assert [archivo["ruta"] for archivo in idea["fases"][0]["requisitos"][0]["archivos"]] == [
        "pieza.py"
    ]
    assert [archivo["ruta"] for archivo in idea["fases"][0]["archivos"]] == ["pieza.py"]

    # Volver a marcarlo tampoco reescribe vacío: lo de antes sigue y lo nuevo
    # se suma.
    (carpeta / "segunda.py").write_text("y", encoding="utf-8")
    fases = _fases_payload(client, carpeta, uid)
    fases[0]["requisitos"][0]["hecho"] = True
    idea = _guardar_fases(client, carpeta, uid, fases)
    assert [archivo["ruta"] for archivo in idea["fases"][0]["requisitos"][0]["archivos"]] == [
        "pieza.py",
        "segunda.py",
    ]


def test_quitar_un_requisito_borra_sus_archivos(client, tmp_path):  # noqa: ANN001, ANN202
    """Lo que no se borra al destildar sí se va con el requisito que desaparece."""
    carpeta = tmp_path / "quitado"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "pieza.py").write_text("x", encoding="utf-8")

    fases = _fases_payload(client, carpeta, uid)
    fases[0]["requisitos"][0]["hecho"] = True
    assert _guardar_fases(client, carpeta, uid, fases)["fases"][0]["archivos"]

    idea = _guardar_fases(
        client,
        carpeta,
        uid,
        [{"orden": 1, "titulo": "Diseño", "requisitos": [{"titulo": "Otro criterio"}]}],
    )
    assert idea["fases"][0]["archivos"] == []
    assert idea["fases"][0]["requisitos"][0]["archivos"] == []


def test_nacer_en_roadmap_toma_la_foto_de_partida(client, tmp_path):  # noqa: ANN001, ANN202
    """Crear la idea ya en roadmap no puede anotar todo el árbol existente."""
    carpeta = tmp_path / "ya-en-roadmap"
    carpeta.mkdir()
    (carpeta / "viejo.txt").write_text("antes", encoding="utf-8")

    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={"title": "A", "status": "roadmap"},
    )
    assert r.status_code == 201, r.json()
    uid = r.json()["uid"]
    fases = [{"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]}]
    assert _guardar_fases(client, carpeta, uid, fases)["fases"][0]["archivos"] == []

    (carpeta / "nuevo.txt").write_text("después", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)
    assert [archivo["ruta"] for archivo in fase["archivos"]] == ["nuevo.txt"]


def test_nacer_en_roadmap_con_fases_toma_la_foto_de_partida(client, tmp_path):  # noqa: ANN001, ANN202
    """El alta con desglose no puede anotar como trabajo el árbol que ya estaba."""
    carpeta = tmp_path / "roadmap-con-fases"
    carpeta.mkdir()
    (carpeta / "viejo.txt").write_text("antes", encoding="utf-8")

    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={
            "title": "A",
            "status": "roadmap",
            "fases": [{"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]}],
        },
    )
    assert r.status_code == 201, r.json()
    uid = r.json()["uid"]
    assert r.json()["fases"][0]["archivos"] == []

    (carpeta / "nuevo.txt").write_text("después", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)
    assert [archivo["ruta"] for archivo in fase["archivos"]] == ["nuevo.txt"]


def test_el_tope_por_fase_cuenta_bytes_y_no_caracteres(monkeypatch):  # noqa: ANN001, ANN202
    texto = "ñ" * 20  # 20 caracteres, 40 bytes en UTF-8
    monkeypatch.setattr(archivos, "hay_git", lambda _carpeta: True)
    monkeypatch.setattr(archivos, "_leer_texto", lambda _ruta: texto)
    monkeypatch.setattr(archivos, "LIMITE_TOTAL", 30)

    cambios = [
        {"estado": "nuevo", "ruta": "a.txt"},
        {"estado": "nuevo", "ruta": "b.txt"},
    ]
    archivos.contenidos(Path("."), cambios)

    # Los 20 caracteres caben en 30, pero sus 40 bytes no: antes se colaba.
    assert all("contenido" not in cambio for cambio in cambios)


def test_un_patch_con_tres_cierres_recorre_el_arbol_una_vez(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """El PATCH entero es un recorrido y un diff; el delta va al primer evento."""
    carpeta = tmp_path / "tres-cierres"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    fases = _fases_payload(client, carpeta, uid)
    fases.append({"titulo": "Prueba", "requisitos": [{"titulo": "Pasa lint"}]})
    fases.append({"titulo": "Cierre", "requisitos": [{"titulo": "Pasa e2e"}]})
    _guardar_fases(client, carpeta, uid, fases)

    llamadas = {"foto": 0, "contenidos": 0}
    foto, contenidos = archivos.foto, archivos.contenidos

    def foto_contada(ruta):  # noqa: ANN001, ANN202
        llamadas["foto"] += 1
        return foto(ruta)

    def contenidos_contados(ruta, cambios):  # noqa: ANN001, ANN202
        llamadas["contenidos"] += 1
        return contenidos(ruta, cambios)

    monkeypatch.setattr(archivos, "foto", foto_contada)
    monkeypatch.setattr(archivos, "contenidos", contenidos_contados)

    (carpeta / "pieza.py").write_text("x", encoding="utf-8")
    fases = _fases_payload(client, carpeta, uid)
    for fase in fases:
        fase["estado"] = "completada"
        for requisito in fase["requisitos"]:
            requisito["hecho"] = True
    idea = _guardar_fases(client, carpeta, uid, fases)

    assert llamadas == {"foto": 1, "contenidos": 1}
    # El delta no se reparte: se queda en el primer cierre del PATCH.
    assert [archivo["ruta"] for archivo in idea["fases"][0]["archivos"]] == ["pieza.py"]
    assert idea["fases"][1]["archivos"] == []
    assert idea["fases"][2]["archivos"] == []


def test_el_arbol_se_lee_fuera_de_la_transaccion(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """Si el disco se leyera tras el primer UPDATE, `in_transaction` sería True."""
    carpeta = tmp_path / "fuera-del-begin"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)

    from events_core.ideas import crud as crud_modulo

    conexiones = []
    conectar = crud_modulo.connect

    def conectar_vigilado(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        conn = conectar(*args, **kwargs)
        conexiones.append(conn)
        return conn

    monkeypatch.setattr(crud_modulo, "connect", conectar_vigilado)

    abiertas = []
    foto = archivos.foto

    def foto_vigilada(ruta):  # noqa: ANN001, ANN202
        abiertas.append(conexiones[-1].in_transaction)
        return foto(ruta)

    monkeypatch.setattr(archivos, "foto", foto_vigilada)

    (carpeta / "pieza.py").write_text("x", encoding="utf-8")
    _cerrar(client, carpeta, uid)

    # Una sola lectura del árbol, y sin transacción abierta.
    assert abiertas == [False]


def test_nacer_en_roadmap_fotografia_antes_de_abrir_la_conexion(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """La foto de partida se toma con cero conexiones de escritura abiertas."""
    carpeta = tmp_path / "foto-antes"
    carpeta.mkdir()
    (carpeta / "viejo.txt").write_text("antes", encoding="utf-8")

    from events_core.ideas import crud as crud_modulo

    conexiones = []
    conectar = crud_modulo.connect

    def conectar_vigilado(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        conn = conectar(*args, **kwargs)
        conexiones.append(conn)
        return conn

    monkeypatch.setattr(crud_modulo, "connect", conectar_vigilado)

    vistas = []
    foto = archivos.foto

    def foto_vigilada(ruta):  # noqa: ANN001, ANN202
        vistas.append(len(conexiones))
        return foto(ruta)

    monkeypatch.setattr(archivos, "foto", foto_vigilada)

    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={"title": "A", "status": "roadmap"},
    )
    assert r.status_code == 201, r.json()
    # Una sola foto, y antes de que exista la conexión del alta.
    assert vistas == [0]


def test_si_el_arbol_falla_la_idea_nace_igual(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """Un árbol ilegible deja aviso, no un 500: la idea se crea igual."""
    from types import SimpleNamespace

    from events_core.ideas import crud as crud_modulo

    carpeta = tmp_path / "arbol-roto"
    carpeta.mkdir()

    def foto_rota(_ruta):  # noqa: ANN001, ANN202
        raise OSError("árbol ilegible")

    avisos = []
    monkeypatch.setattr(archivos, "foto", foto_rota)
    monkeypatch.setattr(
        crud_modulo,
        "registro",
        SimpleNamespace(escribir=lambda nivel, texto: avisos.append((nivel, texto))),
    )

    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={"title": "A", "status": "roadmap"},
    )
    assert r.status_code == 201, r.json()
    uid = r.json()["uid"]
    assert client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).status_code == 200
    assert any(nivel == "aviso" and "No se pudo fotografiar" in texto for nivel, texto in avisos)


@pytest.mark.skipif(GIT is None, reason="git no está instalado")
def test_la_foto_de_partida_espera_a_que_exista_el_almacen(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """La foto se toma con el almacén ya sembrado; si no, el orden no es el bueno."""
    from events_core.ideas.base.rutas import DB_FILENAME, EUI_DIR

    carpeta = tmp_path / "orden-sembrado"
    carpeta.mkdir()
    (carpeta / "base.txt").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")
    assert not (carpeta / EUI_DIR).exists()

    vistas = []
    foto = archivos.foto

    def foto_vigilada(ruta):  # noqa: ANN001, ANN202
        vistas.append((carpeta / EUI_DIR / DB_FILENAME).is_file())
        return foto(ruta)

    monkeypatch.setattr(archivos, "foto", foto_vigilada)

    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={"title": "A", "status": "roadmap"},
    )
    assert r.status_code == 201, r.json()
    # Una sola foto, y con el almacén ya en su sitio.
    assert vistas == [True]


def test_el_presupuesto_corta_la_anotacion_y_deja_aviso(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """Pasado el tope no se paga el diff, el evento se queda sin archivos y avisa."""
    from types import SimpleNamespace

    from events_core.ideas.trabajo import anotacion as anotacion_modulo

    carpeta = tmp_path / "presupuesto"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "pieza.py").write_text("x", encoding="utf-8")

    avisos = []
    monkeypatch.setattr(
        anotacion_modulo,
        "registro",
        SimpleNamespace(escribir=lambda nivel, texto: avisos.append((nivel, texto))),
    )
    monkeypatch.setattr(anotacion_modulo, "PRESUPUESTO_MS", 5)

    foto = archivos.foto

    def foto_lenta(ruta):  # noqa: ANN001, ANN202
        time.sleep(0.02)
        return foto(ruta)

    monkeypatch.setattr(archivos, "foto", foto_lenta)

    diffs = []
    contenidos = archivos.contenidos

    def contenidos_contados(ruta, cambios):  # noqa: ANN001, ANN202
        diffs.append(1)
        return contenidos(ruta, cambios)

    monkeypatch.setattr(archivos, "contenidos", contenidos_contados)

    fase = _cerrar(client, carpeta, uid)

    # Se paró antes del paso caro y el evento quedó sin archivos.
    assert diffs == []
    assert fase["archivos"] == []
    # El aviso lleva el uid y el evento que se quedó sin lista.
    assert any(nivel == "aviso" and uid in texto and "fase 1" in texto for nivel, texto in avisos)


@pytest.mark.skipif(GIT is None, reason="git no está instalado")
def test_el_parche_guarda_los_acentos_tal_cual(client, tmp_path):  # noqa: ANN001, ANN202
    """Git emite UTF-8: decodificarlo en cp1252 guardaría `Ã¡` donde había `á`."""
    carpeta = tmp_path / "acentos"
    carpeta.mkdir()
    (carpeta / "base.txt").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "base.txt").write_text("uno\nárbol\n", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)

    parche = fase["archivos"][0]["contenido"] or ""
    assert "árbol" in parche
    assert "Ã¡" not in parche


@pytest.mark.skipif(GIT is None, reason="git no está instalado")
def test_un_nombre_con_acento_se_anota_con_su_ruta_real(client, tmp_path):  # noqa: ANN001, ANN202
    """Una ruta mojibake no existe en disco: el archivo nuevo se perdería."""
    carpeta = tmp_path / "nombres"
    carpeta.mkdir()
    (carpeta / "base.txt").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "diseño.md").write_text("# canción\n", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)

    por_ruta = {archivo["ruta"]: archivo for archivo in fase["archivos"]}
    assert list(por_ruta) == ["diseño.md"]
    assert por_ruta["diseño.md"]["estado"] == "nuevo"
    assert "canción" in (por_ruta["diseño.md"]["contenido"] or "")
