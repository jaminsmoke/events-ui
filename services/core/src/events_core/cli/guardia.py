"""Los comandos de ítems, el mapa, las puertas y el guard del repo.

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
from contextlib import closing
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .. import config as configuracion
from .. import migracion
from ..items.base.comun import InvalidInput
from ..items.base.esquema import connect, ensure_repo
from ..items.base.eui_fs import es_permitida_en_eui, relativa_bajo_eui
from ..items.base.rutas import EUI_DIR, db_file_for
from ..items.modelo import puertas as modelo_puertas
from .comun import _error, _fallo, _raiz
from .http import _get
from .items import _con_raiz


def _puertas_del_repo(raiz: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Los documentos ajenos y las puertas activas, sin pasar por el core.

    La guarda corre en CI y en el hook de Git, donde no hay servidor: lee el
    almacén en proceso, con las mismas funciones que la API, y una sola vez.
    """
    ensure_repo(str(raiz))
    ajenos = migracion.documentos_ajenos(raiz)
    with closing(connect(db_file_for(str(raiz)))) as conn:
        activas = modelo_puertas.activas(raiz, conn, documentos=len(ajenos))
    return ajenos, activas


def _guard_hook(raiz: Path) -> int:
    """Veredicto para un hook: lee `{tool, ruta}` por stdin; 0 permite, 2 deniega.

    Es el adaptador para el hook de pre-herramienta de un agente y para el
    pre-commit: la misma política que el MCP, sin protocolo que hablar. Sin
    `ruta` no se toca el almacén; sin `tool` tampoco.
    """
    try:
        evento = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return _error("el hook no recibió JSON válido")
    if not isinstance(evento, dict):
        return _error("el hook espera un objeto JSON")

    ruta = str(evento.get("ruta") or "")
    if ruta:
        destino = Path(ruta)
        if not destino.is_absolute():
            destino = raiz / destino
        relativa = relativa_bajo_eui(destino)
        if relativa is not None and not es_permitida_en_eui(relativa):
            return _error(f"ruta no permitida dentro de {EUI_DIR}: {relativa or '(raíz)'}")

    herramienta = str(evento.get("tool") or "")
    if herramienta:
        _, activas = _puertas_del_repo(raiz)
        for puerta in activas:
            if herramienta in puerta["cierra"]:
                return _error(f"puerta cerrada: {puerta['motivo']}")
    return 0


def _guard(args: argparse.Namespace) -> int:
    """La guarda del flujo: documentos fuera del flujo y puertas activas.

    Sale con 1 solo cuando hay documentos fuera del flujo: una puerta activa
    puede ser el estado normal del repo (sin ficha en roadmap, por ejemplo), así
    que informarla no puede teñir de rojo todos los commits.
    """
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    if args.hook:
        return _guard_hook(Path(raiz))

    try:
        ajenos, activas = _puertas_del_repo(Path(raiz))
    except (InvalidInput, FileNotFoundError) as exc:
        return _error(str(exc), 1)

    if args.json:
        print(
            json.dumps(
                {
                    "repo": raiz,
                    "ok": not ajenos,
                    "documentos": ajenos,
                    "puertas": activas,
                },
                ensure_ascii=False,
            )
        )
        return 1 if ajenos else 0

    if ajenos:
        print("documentos fuera del flujo:")
        for documento in ajenos:
            print(f"  {documento['ruta']}  {documento['motivo']}")
    else:
        print("sin documentos fuera del flujo")
    if activas:
        print("puertas activas:")
        for puerta in activas:
            cierra = ", ".join(puerta["cierra"]) or "informativa"
            print(f"  {puerta['id']}  {puerta['motivo']}  ({cierra})")
    return 1 if ajenos else 0


def _puertas(args: argparse.Namespace) -> int:
    """Las puertas activas del flujo, con el mismo dato que ve el MCP."""
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    datos, detalle, estado = _get(f"{url}/puertas?repo={quote(raiz, safe='')}")
    if detalle:
        return _fallo(detalle, estado)
    if args.json:
        print(json.dumps(datos))
        return 0
    if not datos:
        print("ninguna puerta activa")
        return 0
    for puerta in datos:
        cierra = ", ".join(puerta["cierra"]) or "informativa"
        print(f"{puerta['id']}  {puerta['motivo']}  ({cierra})")
    return 0
