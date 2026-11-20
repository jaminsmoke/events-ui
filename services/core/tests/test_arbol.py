"""El árbol de archivos por niveles (`GET /arbol`): lo que hay, sin foto.

Cubre lo que pide el pane: la raíz sola, varios niveles en una petición, que se
vea *todo* (también lo que Git ignora) y que una ruta con `..` no liste fuera
del repo. Además, que dos peticiones seguidas vean lo que el disco tiene en
cada momento.
"""

from __future__ import annotations

from pathlib import Path


def _arbol(client, carpeta: Path, *rutas: str):  # noqa: ANN001, ANN202
    """Los niveles pedidos, ya en JSON (el endpoint responde una lista)."""
    respuesta = client.get("/arbol", params={"repo": str(carpeta), "rutas": list(rutas)})
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def test_la_raiz_va_siempre_y_las_carpetas_primero(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "raiz"
    (carpeta / "src").mkdir(parents=True)
    (carpeta / "README.md").write_text("# hola", encoding="utf-8")

    niveles = _arbol(client, carpeta)

    assert [nivel["ruta"] for nivel in niveles] == [""]
    # Carpetas antes que archivos: el pane no los mezcla.
    assert [(hijo["nombre"], hijo["tipo"]) for hijo in niveles[0]["hijos"]] == [
        ("src", "carpeta"),
        ("README.md", "archivo"),
    ]


def test_lista_los_niveles_pedidos_sin_repetir(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "niveles"
    (carpeta / "src" / "mapa").mkdir(parents=True)
    (carpeta / "src" / "mapa" / "nodo.tsx").write_text("x", encoding="utf-8")

    niveles = _arbol(client, carpeta, "src", "src", "")

    # La raíz primero (siempre), y `src` una sola vez aunque se repita.
    assert [nivel["ruta"] for nivel in niveles] == ["", "src"]
    assert [hijo["ruta"] for hijo in niveles[1]["hijos"]] == ["src/mapa"]
    # La ruta que devuelve cada hijo es relativa y con barras: es la clave con
    # la que el pane pide el nivel siguiente.
    profundos = _arbol(client, carpeta, "src/mapa")
    assert [hijo["ruta"] for hijo in profundos[1]["hijos"]] == ["src/mapa/nodo.tsx"]


def test_se_ve_todo_lo_que_hay_en_disco(client, tmp_path):  # noqa: ANN001, ANN202
    """Ni el `.git` ni las dependencias ni la base se esconden.

    El árbol no filtra: lo que el pane deja fuera es lo que está plegado.
    """
    carpeta = tmp_path / "todo"
    (carpeta / ".git" / "objects").mkdir(parents=True)
    (carpeta / "node_modules" / "pkg").mkdir(parents=True)
    (carpeta / ".EUI").mkdir()
    (carpeta / ".gitignore").write_text("node_modules\n", encoding="utf-8")
    (carpeta / "main.py").write_text("x", encoding="utf-8")

    hijos = _arbol(client, carpeta)[0]["hijos"]

    # Carpetas por nombre (el punto no las manda al final), luego el archivo.
    assert [(hijo["nombre"], hijo["tipo"]) for hijo in hijos] == [
        (".EUI", "carpeta"),
        (".git", "carpeta"),
        ("node_modules", "carpeta"),
        (".gitignore", "archivo"),
        ("main.py", "archivo"),
    ]
    # Y lo ignorado se puede desplegar como cualquier otra carpeta.
    assert [hijo["ruta"] for hijo in _arbol(client, carpeta, ".git")[1]["hijos"]] == [
        ".git/objects"
    ]


def test_una_ruta_que_se_sale_del_repo_es_400(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "dentro"
    carpeta.mkdir()
    (tmp_path / "secreto.txt").write_text("x", encoding="utf-8")

    respuesta = client.get("/arbol", params={"repo": str(carpeta), "rutas": [".."]})

    assert respuesta.status_code == 400


def test_dos_peticiones_ven_lo_que_hay_ahora(client, tmp_path):  # noqa: ANN001, ANN202
    """Sin foto guardada: lo creado y lo borrado aparecen en la siguiente."""
    carpeta = tmp_path / "vivo"
    carpeta.mkdir()
    (carpeta / "se-va.txt").write_text("x", encoding="utf-8")
    assert [hijo["nombre"] for hijo in _arbol(client, carpeta)[0]["hijos"]] == ["se-va.txt"]

    (carpeta / "se-va.txt").unlink()
    (carpeta / "llega.txt").write_text("y", encoding="utf-8")

    assert [hijo["nombre"] for hijo in _arbol(client, carpeta)[0]["hijos"]] == ["llega.txt"]
