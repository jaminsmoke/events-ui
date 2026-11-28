"""El cliente HTTP del CLI y el `doctor` que comprueba que responde.

(Parte del paquete `cli`; la fachada está en `events_core.cli`.)

Original: CLI `eui`: lo que un agente usa en vez de la API cruda.

Comandos: `doctor` (la puerta), `config`, y la lectura `repo`, `item` y
`schema`, todos sobre el mismo cliente HTTP. La migración llega después.
Los dos clientes se abren con `--webapp` (la web en el navegador) y
`--desktop`; si no están instalados, el CLI ofrece instalarlos.

    uv run --directory shared/core python -m events_core.cli doctor
    uv run --directory shared/core python -m events_core.cli config --json

Códigos de salida: 0 bien, 1 algo no cuadra, 2 uso o valor inválido (argparse
sale con 2 por su cuenta).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .. import __version__
from .. import config as configuracion
from ..contrato import InformeDoctor
from ..items.base.comun import InvalidInput
from ..items.base.rutas import resolve_repo

TIMEOUT_S = 2.0
# Aplicar un lote escribe en el almacén: no cabe en el tiempo de un sondeo.
TIMEOUT_LARGO_S = 30.0


def _url(argumento: str | None, puerto: int) -> str:
    """La base del core: `--url` manda; si no, el puerto configurado."""
    if argumento:
        return argumento.rstrip("/")
    return f"http://127.0.0.1:{puerto}"


def _detalle(exc: HTTPError) -> str | None:
    """El `detail` del core (400/404), que ya está escrito para leerse."""
    try:
        cuerpo = json.loads(exc.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    detalle = cuerpo.get("detail") if isinstance(cuerpo, dict) else None
    return detalle if isinstance(detalle, str) else None


def _get(url: str) -> tuple[Any | None, str | None, int]:
    """GET en JSON: `(datos, detalle, estado)`; estado 0 si no hubo respuesta."""
    try:
        with urlopen(url, timeout=TIMEOUT_S) as respuesta:
            return json.loads(respuesta.read().decode("utf-8")), None, respuesta.status
    except HTTPError as exc:
        return None, _detalle(exc) or f"HTTP {exc.code}", exc.code
    except (URLError, OSError, ValueError) as exc:
        return None, str(getattr(exc, "reason", exc)), 0


def _enviar(metodo: str, url: str, datos: Any | None = None) -> tuple[Any | None, str | None, int]:
    """POST/PATCH/DELETE en JSON: `(datos, detalle, estado)`; 0 sin respuesta."""
    cuerpo = None if datos is None else json.dumps(datos).encode("utf-8")
    peticion = Request(
        url,
        data=cuerpo,
        headers={"content-type": "application/json"} if cuerpo is not None else {},
        method=metodo,
    )
    try:
        with urlopen(peticion, timeout=TIMEOUT_LARGO_S) as respuesta:
            return json.loads(respuesta.read().decode("utf-8")), None, respuesta.status
    except HTTPError as exc:
        return None, _detalle(exc) or f"HTTP {exc.code}", exc.code
    except (URLError, OSError, ValueError) as exc:
        return None, str(getattr(exc, "reason", exc)), 0


def _post(url: str, datos: Any) -> tuple[Any | None, str | None, int]:
    return _enviar("POST", url, datos)


def _patch(url: str, datos: Any) -> tuple[Any | None, str | None, int]:
    return _enviar("PATCH", url, datos)


def _delete(url: str) -> tuple[Any | None, str | None, int]:
    return _enviar("DELETE", url)


def _health(url: str) -> tuple[dict[str, Any] | None, str | None]:
    """GET /health sin dependencias: el CLI no arrastra un cliente HTTP."""
    datos, detalle, _ = _get(f"{url}/health")
    return (datos if detalle is None else None), detalle


def _comprobacion(nombre: str, estado: str, detalle: str) -> dict[str, str]:
    return {"nombre": nombre, "estado": estado, "detalle": detalle}


def evaluar(
    *,
    ajustes: configuracion.Config,
    problema: str | None,
    url: str,
    health: dict[str, Any] | None,
    fallo: str | None,
    raiz: Path | None,
    version: str,
) -> list[dict[str, str]]:
    """Las comprobaciones de `doctor`, sin red: así se prueban sin arrancar nada."""
    comprobaciones: list[dict[str, str]] = []

    fichero = configuracion.ruta()
    if problema:
        comprobaciones.append(_comprobacion("configuración", "error", problema))
    elif fichero.exists():
        comprobaciones.append(_comprobacion("configuración", "ok", str(fichero)))
    else:
        comprobaciones.append(
            _comprobacion("configuración", "aviso", f"{fichero} (sin fichero: valores por defecto)")
        )

    if fallo:
        comprobaciones.append(_comprobacion("conexión", "error", f"{url}: {fallo}"))
    else:
        comprobaciones.append(_comprobacion("conexión", "ok", f"{url} responde"))

    if health is not None:
        version_core = str(health.get("version") or "")
        if not version_core:
            comprobaciones.append(
                _comprobacion("versión", "error", "el core no publica `version` en /health")
            )
        elif version != version_core:
            comprobaciones.append(
                _comprobacion("versión", "error", f"core {version_core}, cli {version}")
            )
        else:
            comprobaciones.append(_comprobacion("versión", "ok", version_core))

        estado = str(health.get("status") or "?")
        if estado == "ok":
            comprobaciones.append(_comprobacion("estado", "ok", "core sano"))
        else:
            comprobaciones.append(
                _comprobacion(
                    "estado",
                    "aviso",
                    f"{estado} (sin BD de eventos: normal antes del primer log)",
                )
            )

    if raiz is None:
        comprobaciones.append(
            _comprobacion(
                "raíz",
                "aviso",
                "ninguna: abre una carpeta en la app o usa `eui config set repo <ruta>`",
            )
        )
    elif not raiz.exists():
        comprobaciones.append(_comprobacion("raíz", "error", f"{raiz} no existe"))
    elif not raiz.is_dir():
        comprobaciones.append(_comprobacion("raíz", "error", f"{raiz} no es una carpeta"))
    else:
        comprobaciones.append(_comprobacion("raíz", "ok", str(raiz)))
        if os.access(raiz, os.W_OK):
            comprobaciones.append(_comprobacion("escritura", "ok", "se puede escribir"))
        else:
            comprobaciones.append(
                _comprobacion("escritura", "error", f"sin permiso de escritura en {raiz}")
            )
        from ..items.base.eui_fs import inventariar_ajenos
        from ..items.base.rutas import EUI_DIR

        ajenos = inventariar_ajenos(raiz / EUI_DIR)
        if ajenos:
            muestra = ", ".join(ajenos[:3])
            resto = f" (+{len(ajenos) - 3} más)" if len(ajenos) > 3 else ""
            comprobaciones.append(
                _comprobacion(
                    ".EUI",
                    "aviso",
                    f"{len(ajenos)} ajenos (se purgan al abrir el almacén): {muestra}{resto}",
                )
            )
        elif (raiz / EUI_DIR).is_dir():
            comprobaciones.append(
                _comprobacion(".EUI", "ok", "solo almacén, gitignore y migraciones")
            )

    return comprobaciones


def _imprimir(comprobaciones: list[dict[str, str]]) -> None:
    ancho = max(len(c["nombre"]) for c in comprobaciones)
    for comprobacion in comprobaciones:
        estado = comprobacion["estado"]
        print(f"{estado:<5} {comprobacion['nombre']:<{ancho}}  {comprobacion['detalle']}")


def _doctor(args: argparse.Namespace) -> int:
    try:
        ajustes = configuracion.leer()
        problema = None
    except configuracion.ConfigInvalida as exc:
        ajustes, problema = configuracion.leer_segura(), str(exc)

    url = _url(args.url, args.port or ajustes.port)
    # Por la fachada, para que las pruebas puedan sustituir el sondeo.
    from .http import _health as sondeo

    health, fallo = sondeo(url)

    raiz: Path | None
    if args.repo:
        try:
            raiz = resolve_repo(args.repo)
        except InvalidInput as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    elif health is not None and health.get("repo"):
        raiz = Path(str(health["repo"]))
    else:
        raiz = ajustes.repo

    comprobaciones = evaluar(
        ajustes=ajustes,
        problema=problema,
        url=url,
        health=health,
        fallo=fallo,
        raiz=raiz,
        version=__version__,
    )

    # Las puertas se evalúan contra el almacén en cada lectura: medimos cinco
    # para saber cuánto cuesta de verdad, sin caché todavía.
    if raiz is not None:
        consulta = f"{url}/puertas?{urlencode({'repo': str(raiz)})}"
        tiempos: list[float] = []
        ultimo_fallo: str | None = None
        for _ in range(5):
            inicio = time.perf_counter()
            _, detalle, estado = _get(consulta)
            if detalle is None and estado == 200:
                tiempos.append((time.perf_counter() - inicio) * 1000)
            else:
                ultimo_fallo = detalle or f"HTTP {estado}"
        if tiempos:
            ordenados = sorted(tiempos)
            p50 = statistics.median(ordenados)
            p95 = ordenados[max(0, math.ceil(0.95 * len(ordenados)) - 1)]
            comprobaciones.append(
                _comprobacion(
                    "puertas",
                    "ok",
                    f"{len(tiempos)}/5 · p50 {p50:.1f} ms · p95 {p95:.1f} ms",
                )
            )
        else:
            comprobaciones.append(
                _comprobacion("puertas", "aviso", f"sin respuesta: {ultimo_fallo or '?'}")
            )

    ok = all(c["estado"] != "error" for c in comprobaciones)

    if args.json:
        # El modelo es la única definición de la salida: el MCP publica su
        # esquema, así que `doctor` y `tools/call` no pueden separarse.
        print(
            json.dumps(
                InformeDoctor(
                    ok=ok, url=url, version=__version__, comprobaciones=comprobaciones
                ).model_dump(),
                # ASCII a propósito: un agente lo lee igual con cualquier
                # consola (cp1252 en Windows) sin pelearse con los acentos.
            )
        )
    else:
        print(f"eui {__version__} · core {url}")
        _imprimir(comprobaciones)
    return 0 if ok else 1
