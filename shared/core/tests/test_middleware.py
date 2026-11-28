"""Los middlewares del core se montan en cualquier app.

Estaban dentro de `main.py`, pegados a la app de producción y a su montaje de
la web: el corte por origen, el prefijo `/api` y el reloj de inactividad solo se
podían probar a través del core entero. `middleware.instalar` los pone en un
`FastAPI` vacío, que es lo que hace `main.py` y lo que hace esta prueba.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from events_core import middleware


def _app() -> FastAPI:
    app = FastAPI()

    @app.post("/eco")
    def eco() -> dict[str, str]:
        return {"ok": "sí"}

    middleware.instalar(app)
    return app


def test_el_corte_por_origen_se_monta_en_otra_app() -> None:
    cliente = TestClient(_app())

    assert cliente.post("/eco", headers={"Origin": "https://evil.example"}).status_code == 403
    assert cliente.post("/eco").status_code == 200


def test_el_prefijo_api_se_monta_en_otra_app() -> None:
    cliente = TestClient(_app())

    respuesta = cliente.post("/api/eco")

    assert respuesta.status_code == 200
    assert respuesta.json() == {"ok": "sí"}


def test_el_reloj_de_inactividad_cuenta_las_peticiones() -> None:
    cliente = TestClient(_app())
    middleware.ULTIMA_ACTIVIDAD[0] = 0.0

    cliente.post("/eco")

    assert middleware.ULTIMA_ACTIVIDAD[0] > 0.0
