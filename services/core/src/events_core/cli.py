"""CLI `eui`: lo que un agente usa en vez de la API cruda.

Por ahora la puerta del plan: lee la configuración compartida (raíz y puerto) y
comprueba que el core responde, con qué versión y con qué raíz. Los comandos de
lectura (`repo`, `idea`, `schema`) y la migración llegan después, sobre este
mismo cliente.

    uv run --directory services/core python -m events_core.cli doctor
    uv run --directory services/core python -m events_core.cli config --json

Códigos de salida: 0 bien, 1 algo no cuadra, 2 uso o valor inválido (argparse
sale con 2 por su cuenta).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from . import __version__
from . import config as configuracion
from .ideas.base.comun import InvalidInput
from .ideas.base.rutas import resolve_repo

TIMEOUT_S = 2.0


def _url(argumento: str | None, puerto: int) -> str:
    """La base del core: `--url` manda; si no, el puerto configurado."""
    if argumento:
        return argumento.rstrip("/")
    return f"http://127.0.0.1:{puerto}"


def _health(url: str) -> tuple[dict[str, Any] | None, str | None]:
    """GET /health sin dependencias: el CLI no arrastra un cliente HTTP."""
    try:
        with urlopen(f"{url}/health", timeout=TIMEOUT_S) as respuesta:
            return json.loads(respuesta.read().decode("utf-8")), None
    except HTTPError as exc:
        return None, f"HTTP {exc.code}"
    except (URLError, OSError, ValueError) as exc:
        return None, str(getattr(exc, "reason", exc))


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
    health, fallo = _health(url)

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
    ok = all(c["estado"] != "error" for c in comprobaciones)

    if args.json:
        print(
            json.dumps(
                {
                    "ok": ok,
                    "url": url,
                    "version": __version__,
                    "comprobaciones": comprobaciones,
                },
                # ASCII a propósito: un agente lo lee igual con cualquier
                # consola (cp1252 en Windows) sin pelearse con los acentos.
            )
        )
    else:
        print(f"eui {__version__} · core {url}")
        _imprimir(comprobaciones)
    return 0 if ok else 1


def _config(args: argparse.Namespace) -> int:
    if args.accion == "set":
        try:
            if args.clave == "repo":
                ajustes = configuracion.guardar(repo=args.valor)
            else:
                try:
                    puerto = int(args.valor)
                except ValueError:
                    print(f"error: puerto inválido: {args.valor!r}", file=sys.stderr)
                    return 2
                ajustes = configuracion.guardar(port=puerto)
        except InvalidInput as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    else:
        try:
            ajustes = configuracion.leer()
        except configuracion.ConfigInvalida as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1

    if args.json:
        print(json.dumps(ajustes.como_dict()))
    else:
        print(f"fichero: {configuracion.ruta()}")
        print(f"repo: {ajustes.repo or '(sin definir)'}")
        print(f"puerto: {ajustes.port}")
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eui", description="Cliente de Events UI para agentes.")
    parser.add_argument("--version", action="version", version=f"eui {__version__}")
    comandos = parser.add_subparsers(dest="comando", required=True)

    doctor = comandos.add_parser("doctor", help="Comprueba configuración, core, versión y raíz")
    doctor.add_argument("--url", help="Base del core (por defecto, el puerto configurado)")
    doctor.add_argument("--port", type=int, help="Puerto del core si no se da --url")
    doctor.add_argument("--repo", help="Raíz a comprobar en vez de la configurada")
    doctor.add_argument("--json", action="store_true", help="Una línea JSON para agentes")
    doctor.set_defaults(func=_doctor)

    ajustes = comandos.add_parser("config", help="Lee o cambia la configuración compartida")
    ajustes.add_argument("--json", action="store_true")
    acciones = ajustes.add_subparsers(dest="accion")
    fijar = acciones.add_parser("set", help="Cambia la raíz o el puerto")
    fijar.add_argument("clave", choices=["repo", "port"])
    fijar.add_argument("valor")
    ajustes.set_defaults(func=_config)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
