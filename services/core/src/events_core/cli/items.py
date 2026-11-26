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
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from ..items.base.comun import InvalidInput
from .comun import _contexto, _error, _fallo, _raiz
from .http import _get, _patch, _post


def _imprimir_item(item: dict[str, Any]) -> None:
    print(item.get("title", ""))
    print(f"uid: {item.get('uid', '')}")
    print(f"estado: {item.get('status', '')}")
    if item.get("tags"):
        print(f"etiquetas: {', '.join(item['tags'])}")
    if item.get("depende_de"):
        print(f"depende de: {', '.join(item['depende_de'])}")
    print(f"fases: {len(item.get('fases') or [])}")
    if item.get("description"):
        print()
        print(item["description"])


def _item(args: argparse.Namespace) -> int:
    ajustes, url = _contexto(args)
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    if args.accion == "get":
        ruta = f"{url}/items/{quote(args.uid, safe='')}?repo={quote(raiz, safe='')}"
        datos, detalle, estado = _get(ruta)
        if detalle:
            return _fallo(detalle, estado)
        if args.json:
            print(json.dumps(datos))
        else:
            _imprimir_item(datos)
        return 0

    parametros = {"repo": raiz, "limit": str(args.limit), "offset": str(args.offset)}
    if args.status:
        parametros["status"] = args.status
    if args.kind:
        parametros["kind"] = args.kind
    # El listado es un resumen; el cuerpo se pide a propósito, como en la API.
    if getattr(args, "incluir", None):
        parametros["incluir"] = args.incluir
    datos, detalle, estado = _get(f"{url}/items?{urlencode(parametros)}")
    if detalle:
        return _fallo(detalle, estado)
    if args.json:
        print(json.dumps(datos))
        return 0
    if not datos:
        print("(ningún ítem)")
        return 0
    ancho_uid = max(len(item["uid"]) for item in datos)
    ancho_estado = max(len(item["status"]) for item in datos)
    for item in datos:
        print(f"{item['uid']:<{ancho_uid}}  {item['status']:<{ancho_estado}}  {item['title']}")
    return 0


def _mapa(args: argparse.Namespace) -> int:
    """El mapa entero tal como lo lee la UI: una sola lectura del almacén."""
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    datos, detalle, estado = _get(f"{url}/mapa?repo={quote(raiz, safe='')}")
    if detalle:
        return _fallo(detalle, estado)
    if args.json:
        print(json.dumps(datos))
        return 0
    items = datos.get("items") or []
    if not items:
        print("(mapa vacío)")
        return 0
    # El core ya entrega los carriles en su orden: se cuentan sin reordenar.
    por_carril: dict[str, int] = {}
    for item in items:
        por_carril[item["status"]] = por_carril.get(item["status"], 0) + 1
    for carril, total in por_carril.items():
        print(f"{carril}: {total}")
    print(f"{len(items)} ítems")
    return 0


def _con_raiz(args: argparse.Namespace) -> tuple[str | None, str]:
    """La raíz y la URL del core, o `(None, "")` con el error ya impreso."""
    ajustes, url = _contexto(args)
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        _error(str(exc))
        return None, ""
    if raiz is None:
        _error("no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`")
        return None, ""
    return raiz, url


def _url_item(url: str, raiz: str, uid: str | None = None) -> str:
    ruta = f"{url}/items/{quote(uid, safe='')}" if uid else f"{url}/items"
    return f"{ruta}?repo={quote(raiz, safe='')}"


def _mostrar(item: dict[str, Any], como_json: bool) -> int:
    if como_json:
        print(json.dumps(item))
    else:
        print(f"{item['uid']}  {item['status']}  {item['title']}")
    return 0


def _fases_de_fichero(fichero: str) -> tuple[list[Any] | None, tuple[str, int] | None]:
    """La lista de fases del JSON, o el error que la hace ilegible.

    Vale una lista o `{"fases": [...]}`: es el mismo fichero que acepta
    `item fases`, así que sirve para crear y para reemplazar.
    """
    try:
        contenido = json.loads(Path(fichero).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, (f"no existe {fichero}", 1)
    except (OSError, ValueError) as exc:
        return None, (f"fases ilegibles: {exc}", 2)
    if isinstance(contenido, dict):
        contenido = contenido.get("fases")
    if not isinstance(contenido, list):
        return None, ('el fichero debe ser una lista de fases o {"fases": [...]}', 2)
    return contenido, None


def _item_create(args: argparse.Namespace) -> int:
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    cuerpo: dict[str, Any] = {
        "title": args.title,
        "description": args.description,
        "content": args.content,
        "kind": args.kind,
        "status": args.status,
        "tags": args.tag,
        "depende_de": args.dep,
    }
    # Sin `--fases` el cuerpo va como siempre: el desglose solo viaja si se pide.
    if args.fases:
        fases, fallo = _fases_de_fichero(args.fases)
        if fallo is not None:
            return _error(*fallo)
        cuerpo["fases"] = fases
    datos, detalle, estado = _post(_url_item(url, raiz), cuerpo)
    if detalle:
        return _fallo(detalle, estado)
    return _mostrar(datos, args.json)


def _item_edit(args: argparse.Namespace) -> int:
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    if args.sin_etiquetas and args.tag:
        return _error("--tag y --sin-etiquetas no se combinan", 2)
    if args.sin_dependencias and args.dep:
        return _error("--dep y --sin-dependencias no se combinan", 2)
    cambios: dict[str, Any] = {}
    if args.title is not None:
        cambios["title"] = args.title
    if args.description is not None:
        cambios["description"] = args.description
    if args.content is not None:
        cambios["content"] = args.content
    if args.sin_etiquetas:
        cambios["tags"] = []
    elif args.tag:
        cambios["tags"] = args.tag
    if args.sin_dependencias:
        cambios["depende_de"] = []
    elif args.dep:
        cambios["depende_de"] = args.dep
    if not cambios:
        return _error("nada que editar: da al menos un campo", 2)
    datos, detalle, estado = _patch(_url_item(url, raiz, args.uid), cambios)
    if detalle:
        return _fallo(detalle, estado)
    return _mostrar(datos, args.json)


def _item_move(args: argparse.Namespace) -> int:
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    cambios: dict[str, Any] = {"status": args.status}
    campos = (
        ("resultado", "roadmap_resultado"),
        ("referencia", "roadmap_referencia"),
        ("verificacion_resultado", "verificacion_resultado"),
        ("verificacion_comentario", "verificacion_comentario"),
        ("aprobado_por", "approved_by"),
        ("nota", "revision_nota"),
        ("motivo", "rejected_description"),
        ("descartado_por", "rejected_by"),
        ("sustituye_a", "superseded_by_uid"),
    )
    for atributo, clave in campos:
        valor = getattr(args, atributo, None)
        if valor is not None:
            cambios[clave] = valor
    datos, detalle, estado = _patch(_url_item(url, raiz, args.uid), cambios)
    if detalle:
        return _fallo(detalle, estado)
    return _mostrar(datos, args.json)


def _item_fases(args: argparse.Namespace) -> int:
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    contenido, fallo = _fases_de_fichero(args.fichero)
    if fallo is not None:
        return _error(*fallo)
    datos, detalle, estado = _patch(_url_item(url, raiz, args.uid), {"fases": contenido})
    if detalle:
        return _fallo(detalle, estado)
    return _mostrar(datos, args.json)


def _item_requisito(args: argparse.Namespace) -> int:
    raiz, url = _con_raiz(args)
    if raiz is None:
        return 2
    destino = _url_item(url, raiz, args.uid)
    item, detalle, estado = _get(destino)
    if detalle:
        return _fallo(detalle, estado)
    fases = item.get("fases") or []
    fase = next((f for f in fases if int(f.get("orden", 0)) == args.fase), None)
    if fase is None:
        return _error(f"el ítem {args.uid} no tiene la fase {args.fase}", 1)
    requisito = next(
        (r for r in fase.get("requisitos") or [] if int(r.get("orden", 0)) == args.requisito),
        None,
    )
    if requisito is None:
        return _error(f"la fase {args.fase} no tiene el requisito {args.requisito}", 1)
    # El PATCH reemplaza la lista entera: se manda tal cual, cambiando solo el
    # requisito pedido y conservando estados, notas y el resto de marcas.
    nuevas = [
        {
            "orden": f["orden"],
            "titulo": f["titulo"],
            "estado": f["estado"],
            "nota": f.get("nota") or "",
            "requisitos": [
                {
                    "orden": r["orden"],
                    "titulo": r["titulo"],
                    "hecho": (
                        args.hecho
                        if f["orden"] == args.fase and r["orden"] == args.requisito
                        else bool(r.get("hecho"))
                    ),
                }
                for r in f.get("requisitos") or []
            ],
        }
        for f in fases
    ]
    datos, detalle, estado = _patch(destino, {"fases": nuevas})
    if detalle:
        return _fallo(detalle, estado)
    if args.json:
        print(json.dumps(datos))
        return 0
    print(
        f"fase {args.fase}.{args.requisito} de {args.uid}: {'hecho' if args.hecho else 'pendiente'}"
    )
    return 0
