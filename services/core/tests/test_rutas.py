"""Las carpetas con caracteres de URI (`#`) se abren igual.

La conexión de solo lectura se arma con una URI de SQLite: sin escapar, `#`
empieza el fragmento y `?` la query, así que el almacén se abría en otra ruta.
"""

from __future__ import annotations

from events_core import ideas


def test_carpeta_con_almohadilla_abre_mapa_y_revision(client):  # noqa: ANN001, ANN202
    carpeta = ideas.repos_root() / "carpeta#1"
    carpeta.mkdir(exist_ok=True)
    uid = client.post("/ideas", params={"repo": str(carpeta)}, json={"title": "A"}).json()["uid"]

    mapa = client.get("/mapa", params={"repo": str(carpeta)})
    assert mapa.status_code == 200, mapa.json()
    assert [i["uid"] for i in mapa.json()["ideas"]] == [uid]

    revision = client.get("/revision", params={"repo": str(carpeta)})
    assert revision.status_code == 200, revision.json()
    assert revision.json()["ideas"] == 1
