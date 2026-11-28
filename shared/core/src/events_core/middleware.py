"""Middlewares del core: orígenes con permiso, prefijo `/api` e inactividad.

Vivían dentro de `main.py`, pegados a la app y a su montaje de la web. Aquí se
montan sobre cualquier `FastAPI` con `instalar` —los tests lo hacen con una app
vacía— y `main.py` se queda en composición.
"""

from __future__ import annotations

import os
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Orígenes con derecho a llamar a la API: el webview de Tauri. CORS decide
# quién puede LEER la respuesta; las mutaciones comprueban además el origen,
# porque un POST simple de otra web se ejecuta igual aunque CORS esconda la
# respuesta.
#
# Modelo de confianza de las mutaciones (allowlist exacta, no comodín):
# - el webview de Tauri;
# - lo que liste `EVENTSUI_ORIGENES` (orígenes completos, separados por comas);
# - el propio origen del core, que es el de la web montada en `/webapp`: un
#   navegador manda `Origin` también en las peticiones del mismo origen.
# El comodín de bucle local solo existe en desarrollo (`EVENTSUI_DESARROLLO`),
# que ponen `pnpm dev` y el runner e2e: Vite salta de puerto y fijarlo dejaba
# fuera a la UI de dev. Sin esa variable, otro dev server local recibe 403.
ORIGENES_PERMITIDOS = (
    "tauri://localhost",
    "http://tauri.localhost",
)

ORIGENES_ENV_VAR = "EVENTSUI_ORIGENES"
DESARROLLO_ENV_VAR = "EVENTSUI_DESARROLLO"
_VERDADEROS = {"1", "true", "yes", "on", "si", "sí"}

METODOS_QUE_ESCRIBEN = {"POST", "PUT", "PATCH", "DELETE"}

# Reloj del apagado por inactividad: `serve.py` compara contra él. Cuenta todo
# menos el sondeo de `/health`, que la UI pide sola aunque nadie use la app.
ULTIMA_ACTIVIDAD = [time.monotonic()]


def _en_desarrollo() -> bool:
    """¿Este proceso se arrancó para desarrollo? Solo entonces vale el comodín."""
    return os.environ.get(DESARROLLO_ENV_VAR, "").strip().lower() in _VERDADEROS


def _normalizar_origen(origen: str) -> str:
    """La forma en la que se comparan: sin barra final y en minúsculas."""
    return origen.strip().rstrip("/").lower()


def _origenes_extra() -> frozenset[str]:
    """`EVENTSUI_ORIGENES`, ya normalizado."""
    crudo = os.environ.get(ORIGENES_ENV_VAR, "")
    return frozenset(_normalizar_origen(parte) for parte in crudo.split(",") if parte.strip())


def _es_bucle_local(origen: str) -> bool:
    """¿Es un `http` de la propia máquina, con el puerto que sea?"""
    partes = urlsplit(origen)
    return partes.scheme == "http" and partes.hostname in {"localhost", "127.0.0.1", "::1"}


def _host_de_bucle(host: str) -> bool:
    """¿El `Host` de la petición es de la propia máquina? (DNS rebinding, no)."""
    return urlsplit(f"//{host}").hostname in {"localhost", "127.0.0.1", "::1"}


def _origen_permitido(origen: str, *, host: str | None = None, esquema: str = "http") -> bool:
    """¿Puede esta web mutar el almacén?

    Se compara el origen entero (esquema, host y puerto), no solo el host: un
    dev server de otro proyecto en `localhost:15176` no es esta UI. El único
    atajo es el mismo origen del core, y solo si el `Host` es de bucle local:
    así una web que se haga resolver a 127.0.0.1 (DNS rebinding) no entra.
    """
    normalizado = _normalizar_origen(origen)
    if normalizado in ORIGENES_PERMITIDOS or normalizado in _origenes_extra():
        return True
    if host and _host_de_bucle(host) and normalizado == f"{esquema}://{host.strip().lower()}":
        return True
    return _en_desarrollo() and _es_bucle_local(normalizado)


class _CORSDeLaUI(CORSMiddleware):
    """CORS con la misma allowlist que las mutaciones.

    Starlette pregunta por cada origen a `is_allowed_origin`, así que la lista
    no se congela al montar la app: `EVENTSUI_ORIGENES` y el comodín de
    desarrollo valen también para LEER, que es lo que promete `VITE_API_URL`.
    """

    def is_allowed_origin(self, origin: str) -> bool:
        return _origen_permitido(origin)


async def origen_conocido(request: Request, call_next):
    """Rechaza mutaciones que vengan de una web ajena.

    Un navegador manda `Origin` en toda petición cross-origin; si falta (curl,
    CLI, el runner e2e o los tests) se deja pasar: no hay una web detrás que
    pueda falsificarlo. CORS no basta: impide leer la respuesta, pero el efecto
    del POST ya ocurrió.
    """
    origen = request.headers.get("origin")
    if (
        request.method in METODOS_QUE_ESCRIBEN
        and origen is not None
        and not _origen_permitido(
            origen,
            host=request.headers.get("host"),
            esquema=request.url.scheme,
        )
    ):
        return JSONResponse(status_code=403, content={"detail": "origen no permitido"})
    return await call_next(request)


async def quitar_prefijo_api(request: Request, call_next):
    """La UI llama a `/api/...` y aquí se enruta sin el prefijo.

    Es el mismo camino que en dev hace el proxy de Vite: la web montada en `/`
    habla con el core por el mismo origen. De paso, cuenta la petición para el
    apagado por inactividad (todo menos el sondeo de `/health`).
    """
    ruta = request.scope["path"]
    if ruta == "/api" or ruta.startswith("/api/"):
        request.scope["path"] = ruta[len("/api") :] or "/"
    # Lo que cuenta como uso para el apagado: todo menos el sondeo de `/health`.
    if request.scope["path"] != "/health":
        ULTIMA_ACTIVIDAD[0] = time.monotonic()
    return await call_next(request)


def instalar(app: FastAPI) -> None:
    """Monta CORS y los dos middlewares http, en el orden de siempre.

    El orden importa: se añaden de dentro afuera, así que el prefijo `/api` ve
    la petición antes del corte por origen, y el corte antes del router.
    """
    app.add_middleware(
        _CORSDeLaUI,
        # La lista la decide `is_allowed_origin`: no se repite aquí.
        allow_origins=[],
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        expose_headers=["Last-Event-ID"],
        allow_headers=["content-type"],
    )
    app.middleware("http")(origen_conocido)
    app.middleware("http")(quitar_prefijo_api)
