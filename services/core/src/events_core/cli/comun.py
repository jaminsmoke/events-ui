"""Lo común a los comandos del CLI: contexto, raíz, errores y ajustes.

(Parte del paquete `cli`; la fachada está en `events_core.cli`.)

Original: CLI `eui`: lo que un agente usa en vez de la API cruda.

Comandos: `doctor` (la puerta), `config`, y la lectura `repo`, `item` y
`schema`, todos sobre el mismo cliente HTTP. La migración llega después.
Los dos clientes se abren con `--webapp` (la web en el navegador) y
`--desktop`; si no están instalados, el CLI ofrece instalarlos.

    uv run --directory services/core python -m events_core.cli doctor
    uv run --directory services/core python -m events_core.cli config --json

Códigos de salida: 0 bien, 1 algo no cuadra, 2 uso o valor inválido (argparse
sale con 2 por su cuenta).
"""

from __future__ import annotations

import argparse
import json
import sys

from .. import config as configuracion
from ..contrato import RepoActual
from ..items.base.comun import InvalidInput
from ..items.base.rutas import resolve_repo
from .cliente import _url
from .http import _get


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


def _contexto(args: argparse.Namespace) -> tuple[configuracion.Config, str]:
    ajustes = configuracion.leer_segura()
    return ajustes, _url(args.url, getattr(args, "port", None) or ajustes.port)


def _raiz(args: argparse.Namespace, ajustes: configuracion.Config) -> str | None:
    """La raíz sobre la que preguntar: `--repo`, o la de la configuración."""
    if getattr(args, "repo", None):
        return str(resolve_repo(args.repo))
    return str(ajustes.repo) if ajustes.repo else None


def _error(mensaje: str, codigo: int = 2) -> int:
    print(f"error: {mensaje}", file=sys.stderr)
    return codigo


def _fallo(detalle: str, estado: int) -> int:
    """Un 404 es «no encontrado» (1); cualquier otra cosa es fallo (2)."""
    return _error(detalle, 1 if estado == 404 else 2)


def _repo(args: argparse.Namespace) -> int:
    ajustes, url = _contexto(args)

    if args.accion == "list":
        datos, detalle, estado = _get(f"{url}/repos")
        if detalle:
            return _fallo(detalle, estado)
        if args.json:
            print(json.dumps(datos))
        else:
            for item in datos:
                print(f"{item['repo']}  {item['db_path']}")
        return 0

    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if args.json:
        print(json.dumps(RepoActual(repo=raiz, url=url).model_dump()))
    else:
        print(raiz or "(sin definir: elige una carpeta en la app o `eui config set repo <ruta>`)")
    return 0 if raiz else 1
