"""CLI `eui`: lo que un agente usa en vez de la API cruda.

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
import os
import shutil
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from . import __version__, migracion
from . import config as configuracion
from .contrato import FichaError, InformeDoctor, RepoActual
from .items.base.comun import InvalidInput, escribir_atomico
from .items.base.esquema import connect, ensure_repo
from .items.base.eui_fs import es_permitida_en_eui, relativa_bajo_eui
from .items.base.rutas import EUI_DIR, db_file_for, resolve_repo
from .items.modelo import puertas as modelo_puertas

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
        from .items.base.eui_fs import inventariar_ajenos
        from .items.base.rutas import EUI_DIR

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


ESTADOS = (
    "draft",
    "proposed",
    "roadmap",
    "verificacion",
    "revision_aprobada",
    "historial",
    "rejected",
    "superseded",
)


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


def _migrar_scan(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    try:
        informe = migracion.escanear(Path(raiz), args.ruta)
    except InvalidInput as exc:
        return _error(str(exc))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)

    if args.json:
        print(json.dumps(informe.model_dump()))
        return 0

    print(f"repo: {informe.repo}")
    print(f"ruta: {informe.ruta}")
    if not informe.archivos:
        print("(no hay Markdown)")
        return 0
    for ficha in informe.archivos:
        if isinstance(ficha, FichaError):
            print(f"{ficha.ruta}  error: {ficha.error}")
            continue
        tareas = ficha.tareas
        print(
            f"{ficha.ruta}  {ficha.secciones} secciones · "
            f"{tareas.total} tareas ({tareas.hechas} hechas) · "
            f"{ficha.bytes} B"
        )
    resumen = informe.resumen
    print()
    print(f"{resumen.archivos} archivos · {resumen.secciones} secciones · {resumen.tareas} tareas")
    if informe.recortado:
        print(f"(recortado a {migracion.MAX_ARCHIVOS} archivos)")
    return 0


def _migrar_classify(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    try:
        informe = migracion.clasificar(Path(raiz), args.ruta)
    except InvalidInput as exc:
        return _error(str(exc))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)

    if args.json:
        print(json.dumps(informe.model_dump()))
        return 0

    print(f"repo: {informe.repo}")
    print(f"ruta: {informe.ruta}")
    if not informe.documentos:
        print("(no hay Markdown que clasificar)")
        return 0
    for documento in informe.documentos:
        print(f"{documento.ruta}  {documento.clase} → {documento.destino}  {documento.motivo}")
    resumen = informe.resumen
    print()
    print(
        f"{resumen.documentos} documentos · {resumen.mapa} mapa · {resumen.referencia} referencia"
    )
    if informe.recortado:
        print(f"(recortado a {migracion.MAX_ARCHIVOS} archivos)")
    return 0


def _migrar_check(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    try:
        plan = migracion.cargar_plan(Path(args.plan))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)
    except migracion.PlanInvalido as exc:
        return _error(str(exc), 2)

    informe = migracion.revisar(Path(raiz), plan, plan_ruta=str(args.plan))

    if args.json:
        print(json.dumps(informe.model_dump()))
        return 0 if informe.ok else 1

    print(f"plan: {informe.plan}")
    print(f"repo: {informe.repo}")
    for documento in informe.documentos:
        print(f"· {documento.ruta}  {documento.clase} → {documento.destino}")
    for item in informe.crear:
        origen = item.origen
        print(
            f"+ {item.title}  [{item.ref}]  {item.status}  "
            f"{origen.ruta}:{origen.desde_linea}-{origen.hasta_linea}"
        )
    resumen = informe.resumen
    print(f"{resumen.items} items · {resumen.archivos} archivos · {resumen.refs} refs")
    if informe.ok:
        print("plan válido: se aplicaría como un lote")
        return 0
    for error in informe.errores:
        print(f"error  {error}", file=sys.stderr)
    print(f"{len(informe.errores)} problemas: no se aplicaría", file=sys.stderr)
    return 1


def _migrar_apply(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    try:
        plan = migracion.cargar_plan(Path(args.plan))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)
    except migracion.PlanInvalido as exc:
        return _error(str(exc), 2)

    # Validar aquí falla rápido y no manda al core un plan que no va a entrar.
    informe = migracion.revisar(Path(raiz), plan, plan_ruta=str(args.plan))
    if not informe.ok:
        for error in informe.errores:
            print(f"error  {error}", file=sys.stderr)
        return _error(f"{len(informe.errores)} problemas: no se aplica nada", 1)

    _, url = _contexto(args)
    destino = f"{url}/migracion/aplicar?repo={quote(raiz, safe='')}"
    datos, detalle, estado = _post(destino, plan)
    if detalle:
        return _error(detalle, 1 if estado in (400, 404) else 2)

    if args.json:
        print(json.dumps(datos))
        return 0
    if datos["repetido"]:
        print(f"el plan ya se aplicó como lote {datos['lote']}: no se crea nada")
        return 0
    print(f"lote {datos['lote']}: {datos['items']} items creadas")
    for creada in datos["creadas"]:
        print(f"  {creada['ref']}  {creada['uid']}")
    return 0


def _migrar_undo(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    _, url = _contexto(args)
    destino = f"{url}/migracion/lotes/{quote(args.lote, safe='')}?repo={quote(raiz, safe='')}"
    datos, detalle, estado = _delete(destino)
    if detalle:
        return _error(detalle, 1 if estado in (400, 404, 409) else 2)

    if args.json:
        print(json.dumps(datos))
        return 0
    print(f"lote {datos['lote']} deshecho: {datos['borradas']} items borradas", end="")
    if datos["ausentes"]:
        print(f" ({datos['ausentes']} ya no estaban)", end="")
    print()
    return 0


def _migrar_absorb(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )

    parcial = bool(getattr(args, "parcial", False))
    try:
        if args.confirmar:
            informe = migracion.confirmar_absorcion(Path(raiz), args.lote, parcial=parcial)
        else:
            informe = migracion.revisar_absorcion(Path(raiz), args.lote, parcial=parcial)
    except KeyError:
        return _error(f"no existe el lote {args.lote}", 1)
    except InvalidInput as exc:
        return _error(str(exc))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)

    if args.json:
        print(json.dumps(informe))
        return 0 if informe["ok"] else 1

    print(f"repo: {informe['repo']}")
    modo = informe.get("modo", "total")
    print(f"lote: {informe['lote']} · {informe['plan_sha256']} · modo {modo}")
    for archivo in informe["archivos"]:
        print(
            f"{archivo['ruta']}  {archivo['cubiertos']}/{archivo['bloques']} bloques · "
            f"{archivo['items_lote']} del lote · {archivo['items_fichero']} en total"
        )
        print(f"  hash: {'ok' if archivo['hash_ok'] else 'no cuadra'}")
        if archivo["copia"]:
            print(f"  copia: {archivo['copia']['destino']}")
        if parcial:
            print("  reescritura: marcadores [eui:<uid>] por cada rango del lote")
            for marcador in archivo.get("marcadores", [])[:10]:
                print(f"  L{marcador['desde']}-{marcador['hasta']}: {marcador['marcador']}")
        else:
            print("  retirada: se elimina el original")
        for hueco in archivo["sin_migrar"][:10]:
            print(f"  sin migrar L{hueco['linea']}: {hueco['texto']}")
        if archivo["recortado"]:
            print(f"  (huecos recortados a {migracion.MAX_HUECOS})")

    resumen = informe["resumen"]
    print(
        f"{resumen['archivos']} archivos · {resumen['items_lote']} items del lote · "
        f"{resumen['cubiertos']}/{resumen['bloques']} bloques cubiertos"
    )
    if informe["ok"] and args.confirmar:
        print(f"absorbido: {informe['manifest']}")
        if parcial:
            print("rangos del lote sustituidos por marcadores; la copia queda en .EUI/migracion/")
        else:
            print("documentos retirados; `eui migrate export <ruta>` genera su Markdown actual")
        return 0
    if informe["ok"]:
        if parcial:
            print(
                "absorción parcial posible: se copiaría el origen y se dejarían marcadores;"
                " no se ha escrito nada"
            )
        else:
            print("absorción posible: se copiaría y se retiraría el origen; no se ha escrito nada")
        return 0
    for error in informe["errores"]:
        print(f"error  {error}", file=sys.stderr)
    if not parcial and resumen["sin_migrar"]:
        print(f"{resumen['sin_migrar']} bloques sin migrar: no se absorbe", file=sys.stderr)
    return 1


def _migrar_export(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )
    try:
        texto = migracion.exportar_documento(Path(raiz), args.ruta)
    except KeyError:
        return _error(f"no hay ítems migrados de {args.ruta}", 1)
    except InvalidInput as exc:
        return _error(str(exc))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)

    if args.salida:
        destino = Path(args.salida).expanduser()
        if not destino.is_absolute():
            destino = Path(raiz) / destino
        # Por `escribir_atomico`, como el resto: `--salida .EUI/x.md` no escribe.
        try:
            escribir_atomico(destino, texto.encode("utf-8"))
        except InvalidInput as exc:
            return _error(str(exc))
        print(destino)
    else:
        sys.stdout.write(texto)
    return 0


def _migrar_guard(args: argparse.Namespace) -> int:
    ajustes = configuracion.leer_segura()
    try:
        raiz = _raiz(args, ajustes)
    except InvalidInput as exc:
        return _error(str(exc))
    if raiz is None:
        return _error(
            "no hay raíz: elige una carpeta en la app, usa --repo o `eui config set repo`"
        )
    try:
        ajenos = migracion.documentos_ajenos(Path(raiz))
    except InvalidInput as exc:
        return _error(str(exc))
    except FileNotFoundError as exc:
        return _error(str(exc), 1)

    if args.json:
        print(
            json.dumps({"repo": raiz, "ajenos": ajenos, "total": len(ajenos)}, ensure_ascii=False)
        )
    elif not ajenos:
        print("sin documentos fuera del flujo")
    else:
        for documento in ajenos:
            print(f"{documento['ruta']}  {documento['motivo']}")
    return 1 if ajenos else 0


def _web(args: argparse.Namespace) -> int:
    """Enciende el core si no responde, y abre la web servida por él.

    El core se lanza como proceso aparte con `EUI_IDLE_MINUTES`, así se apaga solo
    cuando nadie lo usa. Si ya responde (otra app o un `eui web` anterior), no se
    toca. El binario es el de la máquina si el envoltorio lo encontró
    (`EUI_CORE_BIN`: el `events-core` que publicó el desktop, sin consola); si
    no, `eui` se sirve a sí mismo, y en desarrollo se usa
    `python -m events_core.serve`.
    """
    import subprocess  # noqa: PLC0415
    import time  # noqa: PLC0415
    import webbrowser  # noqa: PLC0415

    puerto = args.port or configuracion.leer_segura().port
    url = f"http://127.0.0.1:{puerto}"
    datos, _, _ = _get(f"{url}/health")
    if datos is None:
        # Sin las `_PYI_*`: el hijo reutilizaría la carpeta temporal del padre
        # (onefile) y moriría cuando el padre la borre al salir.
        entorno = {
            **{k: v for k, v in os.environ.items() if not k.startswith("_PYI_")},
            "EUI_PORT": str(puerto),
            "EUI_IDLE_MINUTES": str(args.idle_minutes),
        }
        # El core de la máquina si el envoltorio encontró uno (el del desktop,
        # que no trae CLI); si no, `eui` se sirve a sí mismo (`eui serve`), y
        # en desarrollo se arranca el módulo.
        core_compartido = os.environ.get("EUI_CORE_BIN", "").strip()
        if core_compartido:
            orden = [core_compartido]
        elif getattr(sys, "frozen", False):
            orden = [sys.executable, "serve"]
        else:
            orden = [sys.executable, "-m", "events_core.serve"]
        # Sin heredar la terminal: `eui web` ya volvió y uvicorn escribiría sus
        # líneas encima del prompt. Lo útil del core va al registro (SQLite).
        subprocess.Popen(
            orden,
            env=entorno,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_SIN_CONSOLA,
        )
        limite = time.monotonic() + 15
        while time.monotonic() < limite:
            datos, _, _ = _get(f"{url}/health")
            if datos is not None:
                break
            time.sleep(0.25)
        if datos is None:
            print(f"El core no respondió en {url}. Revisa el registro de eventos.", file=sys.stderr)
            return 1
    print(f"Core en {url} (se apaga tras {args.idle_minutes:g} min sin uso)")
    if not args.no_open:
        webbrowser.open(url)
    return 0


_SIN_CONSOLA = 0x08000000 if os.name == "nt" else 0

# Los dos clientes de Events UI. El core llega con cualquiera de ellos: si hay
# CLI es que hay core, y el cliente que falte se ofrece instalar.
PAQUETE_WEBAPP = "@jaminsmoke/events-ui-webapp"
RELEASES = "https://github.com/jaminsmoke/events-ui/releases"


def _confirmar(pregunta: str) -> bool:
    """Sí o no por consola. Sin terminal —un agente, una tubería— es que no."""
    if not sys.stdin.isatty():
        print(f"{pregunta} (sin terminal: no)", file=sys.stderr)
        return False
    try:
        return input(pregunta).strip().lower() in {"s", "si", "sí", "y", "yes"}
    except EOFError:
        return False


def _ejecutar(orden: list[str]) -> int:
    """Un proceso externo que usa nuestra consola (npm tiene que verse)."""
    import subprocess  # noqa: PLC0415

    try:
        return subprocess.call(orden, shell=os.name == "nt", creationflags=_SIN_CONSOLA)
    except OSError as error:
        print(f"No pude ejecutar {orden[0]}: {error}", file=sys.stderr)
        return 1


def _raiz_npm_global() -> Path | None:
    """`npm root -g`, o None si no hay npm instalado."""
    import subprocess  # noqa: PLC0415

    if shutil.which("npm") is None:
        return None
    try:
        salida = subprocess.run(
            ["npm", "root", "-g"],
            capture_output=True,
            text=True,
            timeout=30,
            shell=os.name == "nt",
            creationflags=_SIN_CONSOLA,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if salida.returncode != 0:
        return None
    ruta = Path(salida.stdout.strip())
    return ruta if ruta.is_dir() else None


def _dist_de_la_webapp() -> Path | None:
    """El `dist` del paquete npm de la web, si está instalado.

    Es lo único que el core no trae: el desktop publica el core, pero la web es
    su propio paquete npm. `EUI_WEBAPP_DIST` lo fija para pruebas.
    """
    fijado = os.environ.get("EUI_WEBAPP_DIST", "").strip()
    if fijado:
        return Path(fijado) if Path(fijado).is_dir() else None
    raiz = _raiz_npm_global()
    if raiz is None:
        return None
    dist = raiz / "@jaminsmoke" / "events-ui-webapp" / "dist"
    return dist if dist.is_dir() else None


def _desktop_instalado() -> Path | None:
    """El ejecutable del desktop, si está instalado en esta máquina."""
    fijado = os.environ.get("EUI_DESKTOP_EXE", "").strip()
    if fijado:
        return Path(fijado) if Path(fijado).exists() else None
    if os.name == "nt":
        candidatos = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Events UI" / "Events UI.exe",
            Path(os.environ.get("PROGRAMFILES", "")) / "Events UI" / "Events UI.exe",
        ]
    elif sys.platform == "darwin":
        candidatos = [Path("/Applications/Events UI.app")]
    else:
        candidatos = [
            Path.home() / ".local" / "bin" / "events-ui",
            Path("/usr/bin/events-ui"),
        ]
    return next((ruta for ruta in candidatos if ruta.exists()), None)


def _abrir(ruta: Path) -> None:
    """Abre un ejecutable o un documento con lo que tenga el sistema."""
    import subprocess  # noqa: PLC0415

    if os.name == "nt":
        os.startfile(str(ruta))  # type: ignore[attr-defined]  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(ruta)])  # noqa: S603
    else:
        subprocess.Popen([str(ruta)])  # noqa: S603


def _sha256_de(ruta: Path) -> str:
    """sha256 de un fichero, por bloques (los instaladores pesan)."""
    import hashlib  # noqa: PLC0415

    resumen = hashlib.sha256()
    with ruta.open("rb") as fichero:
        for bloque in iter(lambda: fichero.read(1 << 20), b""):
            resumen.update(bloque)
    return resumen.hexdigest()


def _es_sha256(texto: str) -> bool:
    return len(texto) == 64 and all(caracter in "0123456789abcdefABCDEF" for caracter in texto)


def _sha256_del_release(nombre: str, adjuntos: list[dict]) -> str | None:
    """El sha256 que publica el release para `nombre`: su `.sha256`, o el digest.

    El `.sha256` viaja como adjunto del release (lo genera el CI con
    `sha256sum`). `digest` es el que calcula GitHub al subir el activo, y vale
    como respaldo si el adjunto no está.
    """
    for adjunto in adjuntos:
        if str(adjunto.get("name", "")) != f"{nombre}.sha256":
            continue
        url = str(adjunto.get("browser_download_url", ""))
        if not url:
            break
        try:
            with urlopen(url, timeout=30) as respuesta:  # noqa: S310
                texto = respuesta.read().decode("utf-8", "replace")
        except (URLError, HTTPError, OSError) as error:
            print(f"No pude leer {nombre}.sha256: {error}", file=sys.stderr)
            break
        partes = texto.split()
        primero = partes[0] if partes else ""
        return primero.lower() if _es_sha256(primero) else None
    for adjunto in adjuntos:
        if str(adjunto.get("name", "")) != nombre:
            continue
        digest = str(adjunto.get("digest") or "")
        if digest.lower().startswith("sha256:"):
            valor = digest.split(":", 1)[1].lower()
            return valor if _es_sha256(valor) else None
    return None


def _verificar_instalador(destino: Path, nombre: str, adjuntos: list[dict]) -> bool:
    """Comprueba el sha256 del instalador antes de ejecutarlo.

    Sin hash publicado no se ejecuta: el core se baja con su `.sha256` y el
    instalador no puede ir con menos garantía que el core.
    """
    esperado = _sha256_del_release(nombre, adjuntos)
    if esperado is None:
        print(f"El release no publica el sha256 de {nombre}: no lo ejecuto.", file=sys.stderr)
        return False
    obtenido = _sha256_de(destino)
    if obtenido != esperado:
        print(
            f"El sha256 de {nombre} no coincide.\n  esperado: {esperado}\n  obtenido: {obtenido}",
            file=sys.stderr,
        )
        return False
    print(f"sha256 verificado: {obtenido}")
    return True


def _instalador_del_release() -> tuple[str, str, list[dict]] | None:
    """(nombre, url, adjuntos) del instalador de este sistema en el último release."""
    peticion = Request(
        "https://api.github.com/repos/jaminsmoke/events-ui/releases/latest",
        headers={"Accept": "application/vnd.github+json"},
    )
    try:
        with urlopen(peticion, timeout=20) as respuesta:  # noqa: S310
            datos = json.loads(respuesta.read())
    except (URLError, HTTPError, ValueError) as error:
        print(f"No pude consultar el último release: {error}", file=sys.stderr)
        return None
    if os.name == "nt":
        sufijos = ("-setup.exe", ".msi")
    elif sys.platform == "darwin":
        sufijos = (".dmg",)
    else:
        sufijos = (".appimage", ".deb")
    adjuntos = list(datos.get("assets", []))
    for adjunto in adjuntos:
        nombre = str(adjunto.get("name", ""))
        url = str(adjunto.get("browser_download_url", ""))
        if url and nombre.lower().endswith(sufijos):
            return nombre, url, adjuntos
    return None


def _instalar_desktop() -> int:
    """Baja el instalador del último release y lo lanza."""
    elegido = _instalador_del_release()
    if elegido is None:
        print(
            f"No encontré instalador para este sistema: {RELEASES}/latest",
            file=sys.stderr,
        )
        return 1
    nombre, url, adjuntos = elegido
    destino = Path(tempfile.gettempdir()) / nombre
    print(f"Descargando {nombre}…")
    try:
        with urlopen(url, timeout=300) as origen, destino.open("wb") as salida:  # noqa: S310
            shutil.copyfileobj(origen, salida)
    except (URLError, HTTPError, OSError) as error:
        print(f"No pude descargar el instalador: {error}", file=sys.stderr)
        return 1
    if not _verificar_instalador(destino, nombre, adjuntos):
        destino.unlink(missing_ok=True)
        return 1
    print(f"Instalador en {destino}")
    _abrir(destino)
    return 0


def _webapp(args: argparse.Namespace) -> int:
    """`eui --webapp`: la web en el navegador, instalándola si falta.

    El CLI viene con el core (lo trae la web app o el desktop), pero el `dist`
    de la web es su propio paquete npm: sin él no hay nada que abrir, así que
    se ofrece instalarlo y no se abre nada más.
    """
    dist = _dist_de_la_webapp()
    if dist is None:
        print(f"No tienes instalada la web app de Events UI ({PAQUETE_WEBAPP}).")
        if not _confirmar(f"¿Instalarla ahora con `npm install -g {PAQUETE_WEBAPP}`? [s/N] "):
            print(f"Cuando quieras: npm install -g {PAQUETE_WEBAPP}", file=sys.stderr)
            return 1
        if _ejecutar(["npm", "install", "-g", PAQUETE_WEBAPP]) != 0:
            print("La instalación de la web app falló.", file=sys.stderr)
            return 1
        dist = _dist_de_la_webapp()
        if dist is None:
            print(
                "Se instaló, pero no encuentro su `dist` (revisa `npm root -g`).",
                file=sys.stderr,
            )
            return 1
    os.environ["EUI_WEB_DIST"] = str(dist)
    resultado = _web(
        argparse.Namespace(port=args.port, idle_minutes=args.idle_minutes, no_open=True)
    )
    if resultado != 0:
        return resultado
    puerto = args.port or configuracion.leer_segura().port
    url = f"http://127.0.0.1:{puerto}"
    if _estado(f"{url}/") != 200:
        print(
            f"El core que ya estaba en marcha en {url} no sirve la web app\n"
            "(lo encendió el desktop, que no trae la web). Ciérralo o espera a que\n"
            "se apague y vuelve a lanzar `eui --webapp`.",
            file=sys.stderr,
        )
        return 1
    import webbrowser  # noqa: PLC0415

    webbrowser.open(url)
    return 0


def _estado(url: str) -> int:
    """Código HTTP de un GET aunque la respuesta no sea JSON; 0 sin respuesta."""
    try:
        with urlopen(url, timeout=TIMEOUT_S) as respuesta:  # noqa: S310
            return int(respuesta.status)
    except HTTPError as exc:
        return exc.code
    except (URLError, OSError):
        return 0


def _desktop(args: argparse.Namespace) -> int:
    """`eui --desktop`: abre el desktop, instalándolo si falta."""
    ruta = _desktop_instalado()
    if ruta is not None:
        _abrir(ruta)
        return 0
    print("No tienes instalado el desktop de Events UI.")
    sistema = {"nt": "Windows", "darwin": "macOS"}.get(os.name, "Linux")
    if not _confirmar(f"¿Descargar e instalar el instalador de {sistema}? [s/N] "):
        print(f"Instaladores: {RELEASES}/latest", file=sys.stderr)
        return 1
    return _instalar_desktop()


def _serve(args: argparse.Namespace) -> int:
    """El core en primer plano (`eui serve`), que es el modo que usa `eui web`.

    Los imports son explícitos porque PyInstaller solo empaqueta lo que ve: el
    `uvicorn.run("events_core.main:app")` de `serve` llega por cadena.
    """
    # El entorno va antes de importar: `serve.PORT` se calcula al importarse.
    if args.port:
        os.environ["EUI_PORT"] = str(args.port)
    if args.idle_minutes is not None:
        os.environ["EUI_IDLE_MINUTES"] = str(args.idle_minutes)

    from . import main as _app  # noqa: F401, PLC0415
    from . import serve  # noqa: PLC0415

    return serve.main()


def _mcp(args: argparse.Namespace) -> int:
    # Import perezoso: el CLI normal no carga el servidor ni su protocolo.
    from .mcp_servidor import permite_escritura, servir

    return servir(permitir_escritura=permite_escritura(args.permitir_escritura))


def _schema(args: argparse.Namespace) -> int:
    if args.tema == "puertas":
        # El esquema del archivo es local: no hace falta core ni raíz.
        from .items.modelo.puertas import ESQUEMA_PUERTAS

        print(json.dumps(ESQUEMA_PUERTAS, indent=2 if args.pretty else None))
        return 0
    if args.tema == "migrate":
        # El esquema del plan es local: no hace falta core ni raíz.
        print(json.dumps(migracion.ESQUEMA_PLAN, indent=2 if args.pretty else None))
        return 0

    _, url = _contexto(args)
    datos, detalle, estado = _get(f"{url}/openapi.json")
    if detalle:
        return _fallo(detalle, estado)
    print(json.dumps(datos, indent=2 if args.pretty else None))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eui", description="Cliente de Events UI para agentes.")
    parser.add_argument("--version", action="version", version=f"eui {__version__}")
    parser.add_argument(
        "--webapp",
        action="store_true",
        help="Abre la web app en el navegador (la instala si falta)",
    )
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="Abre el desktop (lo instala si falta)",
    )
    parser.add_argument("--port", type=int, help="Puerto del core (con --webapp)")
    parser.add_argument(
        "--idle-minutes",
        type=float,
        default=10.0,
        help="Minutos sin uso antes de apagar el core (con --webapp)",
    )
    comandos = parser.add_subparsers(dest="comando")

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

    def conexion(p: argparse.ArgumentParser, *, con_repo: bool = True) -> None:
        p.add_argument("--url", help="Base del core (por defecto, el puerto configurado)")
        p.add_argument("--port", type=int, help="Puerto del core si no se da --url")
        if con_repo:
            p.add_argument("--repo", help="Raíz a usar en vez de la configurada")

    repos = comandos.add_parser("repo", help="La raíz configurada o las del laboratorio")
    repos.add_argument(
        "accion", nargs="?", choices=["list"], help="`list`: carpetas del laboratorio"
    )
    repos.add_argument("--json", action="store_true")
    conexion(repos)
    repos.set_defaults(func=_repo)

    mapa = comandos.add_parser(
        "mapa", help="El mapa entero en una lectura: carriles, dependencias y fases"
    )
    mapa.add_argument("--json", action="store_true")
    conexion(mapa)
    mapa.set_defaults(func=_mapa)

    puertas = comandos.add_parser("puertas", help="Las puertas activas del flujo")
    puertas.add_argument("--json", action="store_true")
    conexion(puertas)
    puertas.set_defaults(func=_puertas)

    guardia = comandos.add_parser(
        "guard", help="Documentos fuera del flujo y puertas; o el veredicto de un hook"
    )
    guardia.add_argument(
        "--hook",
        action="store_true",
        help="Lee {tool, ruta} por stdin: sale 0 si permite y 2 si deniega",
    )
    guardia.add_argument("--json", action="store_true")
    conexion(guardia)
    guardia.set_defaults(func=_guard)

    items = comandos.add_parser("item", help="Lee y escribe los ítems del repo")
    acciones_item = items.add_subparsers(dest="accion", required=True)
    listar = acciones_item.add_parser("list", help="Lista los ítems del mapa")
    listar.add_argument("--status")
    listar.add_argument("--kind", choices=["work_item", "adr", "note"])
    listar.add_argument(
        "--incluir",
        choices=["contenido"],
        help="El cuerpo Markdown de cada fila; por defecto, el listado es un resumen",
    )
    listar.add_argument("--limit", type=int, default=100)
    listar.add_argument("--offset", type=int, default=0)
    listar.add_argument("--json", action="store_true")
    conexion(listar)
    listar.set_defaults(func=_item)
    ver = acciones_item.add_parser("get", help="La ficha completa de un ítem")
    ver.add_argument("uid")
    ver.add_argument("--json", action="store_true")
    conexion(ver)
    ver.set_defaults(func=_item)

    crear = acciones_item.add_parser("create", help="Crea un ítem en la cola de entrada")
    crear.add_argument("--title", required=True)
    crear.add_argument("--description", default="")
    crear.add_argument("--content", default="")
    crear.add_argument("--kind", choices=["work_item"], default="work_item")
    crear.add_argument("--status", choices=ESTADOS, default="draft")
    crear.add_argument("--tag", action="append", default=[], help="Etiqueta (repetible)")
    crear.add_argument("--dep", action="append", default=[], help="uid del que depende")
    crear.add_argument(
        "--fases", metavar="FICHERO", help='Lista de fases o {"fases": [...]} para el alta'
    )
    crear.add_argument("--json", action="store_true")
    conexion(crear)
    crear.set_defaults(func=_item_create)

    editar = acciones_item.add_parser("edit", help="Edita los campos dados de un ítem")
    editar.add_argument("uid")
    editar.add_argument("--title")
    editar.add_argument("--description")
    editar.add_argument("--content")
    editar.add_argument("--tag", action="append", default=[], help="Reemplaza las etiquetas")
    editar.add_argument("--sin-etiquetas", action="store_true", help="Deja la lista vacía")
    editar.add_argument("--dep", action="append", default=[], help="Reemplaza las dependencias")
    editar.add_argument("--sin-dependencias", action="store_true", help="Deja la lista vacía")
    editar.add_argument("--json", action="store_true")
    conexion(editar)
    editar.set_defaults(func=_item_edit)

    mover = acciones_item.add_parser(
        "move", help="Mueve un ítem de carril con los datos de su ficha"
    )
    mover.add_argument("uid")
    mover.add_argument("status", choices=ESTADOS)
    mover.add_argument("--resultado", help="Resultado de roadmap")
    mover.add_argument("--referencia", help="Referencia del trabajo en roadmap")
    mover.add_argument("--verificacion-resultado")
    mover.add_argument("--verificacion-comentario")
    mover.add_argument("--aprobado-por", choices=["usuario", "agente", "sistema"])
    mover.add_argument("--nota", help="Nota de la aprobación")
    mover.add_argument("--motivo", help="Motivo del descarte")
    mover.add_argument("--descartado-por", choices=["usuario", "agente", "sistema"])
    mover.add_argument("--sustituye-a", help="uid del ítem que releva")
    mover.add_argument("--json", action="store_true")
    conexion(mover)
    mover.set_defaults(func=_item_move)

    fases = acciones_item.add_parser("fases", help="Reemplaza las fases desde un JSON")
    fases.add_argument("uid")
    fases.add_argument("fichero", help='Lista de fases o {"fases": [...]}')
    fases.add_argument("--json", action="store_true")
    conexion(fases)
    fases.set_defaults(func=_item_fases)

    requisito = acciones_item.add_parser("requisito", help="Marca o desmarca un requisito")
    requisito.add_argument("uid")
    requisito.add_argument("fase", type=int)
    requisito.add_argument("requisito", type=int)
    marca = requisito.add_mutually_exclusive_group(required=True)
    marca.add_argument("--hecho", dest="hecho", action="store_true")
    marca.add_argument("--pendiente", dest="hecho", action="store_false")
    requisito.add_argument("--json", action="store_true")
    conexion(requisito)
    requisito.set_defaults(func=_item_requisito)

    esquema = comandos.add_parser(
        "schema", help="El OpenAPI del core o el esquema del plan de migración"
    )
    esquema.add_argument(
        "tema",
        nargs="?",
        choices=["migrate", "puertas"],
        help="`migrate`: el plan de migración; `puertas`: `.EUI/protocolos.json`",
    )
    esquema.add_argument("--pretty", action="store_true", help="Indentado para leerlo")
    conexion(esquema, con_repo=False)
    esquema.set_defaults(func=_schema)

    migrar = comandos.add_parser("migrate", help="Migración de Markdown (empieza por scan)")
    acciones_migrar = migrar.add_subparsers(dest="accion", required=True)
    escanear = acciones_migrar.add_parser(
        "scan", help="Lista los Markdown y lo que reconoce; no escribe"
    )
    escanear.add_argument("ruta", nargs="?", help="Carpeta o archivo; por defecto, la raíz")
    escanear.add_argument("--json", action="store_true")
    conexion(escanear)
    escanear.set_defaults(func=_migrar_scan)

    clasificar = acciones_migrar.add_parser(
        "classify",
        help="Propone el manifiesto documentos (mapa/referencia); no escribe",
        aliases=["plan"],
    )
    clasificar.add_argument("ruta", nargs="?", help="Carpeta o archivo; por defecto, la raíz")
    clasificar.add_argument("--json", action="store_true")
    conexion(clasificar)
    clasificar.set_defaults(func=_migrar_classify)

    comprobar = acciones_migrar.add_parser(
        "check", help="Valida el plan y enseña lo que se crearía; no escribe"
    )
    comprobar.add_argument("plan", help="Ruta del plan.json")
    comprobar.add_argument("--json", action="store_true")
    conexion(comprobar)
    comprobar.set_defaults(func=_migrar_check)

    aplicar = acciones_migrar.add_parser("apply", help="Aplica el plan como un lote; todo o nada")
    aplicar.add_argument("plan", help="Ruta del plan.json")
    aplicar.add_argument("--json", action="store_true")
    conexion(aplicar)
    aplicar.set_defaults(func=_migrar_apply)

    deshacer = acciones_migrar.add_parser(
        "undo", help="Deshace un lote si nadie tocó sus items después"
    )
    deshacer.add_argument("lote", help="Identificador del lote que devolvió apply")
    deshacer.add_argument("--json", action="store_true")
    conexion(deshacer)
    deshacer.set_defaults(func=_migrar_undo)

    absorber = acciones_migrar.add_parser("absorb", help="Copia y retira un lote ya migrado")
    absorber.add_argument("lote", help="Identificador del lote que devolvió apply")
    modo = absorber.add_mutually_exclusive_group()
    modo.add_argument(
        "--dry-run",
        action="store_true",
        help="Informe sin escribir (por defecto)",
    )
    modo.add_argument(
        "--confirmar",
        action="store_true",
        help="Copia el origen y lo elimina (o reescribe con --parcial)",
    )
    absorber.add_argument(
        "--parcial",
        action="store_true",
        help=(
            "Absorción parcial: exige rangos sin solapar, deja marcadores "
            "[eui:<uid>] y no es el comportamiento por defecto"
        ),
    )
    absorber.add_argument("--json", action="store_true")
    conexion(absorber)
    absorber.set_defaults(func=_migrar_absorb)

    exportar = acciones_migrar.add_parser(
        "export", help="Genera el Markdown actual de un documento desde SQLite"
    )
    exportar.add_argument("ruta", help="Ruta del documento tal como la guardó la migración")
    exportar.add_argument("--salida", help="Fichero de salida; por defecto, stdout")
    conexion(exportar)
    exportar.set_defaults(func=_migrar_export)

    guarda = acciones_migrar.add_parser(
        "guard", help="Lista los documentos creados fuera del flujo; no escribe"
    )
    guarda.add_argument("--json", action="store_true")
    conexion(guarda)
    guarda.set_defaults(func=_migrar_guard)

    web = comandos.add_parser("web", help="Enciende el core y abre la web")
    web.add_argument("--port", type=int, help="Puerto del core si no es el configurado")
    web.add_argument(
        "--idle-minutes",
        type=float,
        default=10.0,
        help="Minutos sin peticiones antes de que el core se apague (0 = no apagar)",
    )
    web.add_argument("--no-open", action="store_true", help="No abrir el navegador")
    web.set_defaults(func=_web)

    servir = comandos.add_parser("serve", help="Arranca el core en primer plano")
    servir.add_argument("--port", type=int, help="Puerto del core si no es el configurado")
    servir.add_argument(
        "--idle-minutes",
        type=float,
        help="Minutos sin peticiones antes de apagarse (0 = no apagar)",
    )
    servir.set_defaults(func=_serve)

    mcp = comandos.add_parser("mcp", help="Servidor MCP por stdio para agentes")
    mcp.add_argument(
        "--permitir-escritura",
        action="store_true",
        help="Anuncia y permite las herramientas que escriben",
    )
    mcp.set_defaults(func=_mcp)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.webapp and args.desktop:
        parser.error("--webapp y --desktop son excluyentes")
    if (args.webapp or args.desktop) and args.comando:
        parser.error("--webapp y --desktop no se combinan con un comando")
    if args.webapp:
        return _webapp(args)
    if args.desktop:
        return _desktop(args)
    if not args.comando:
        parser.error("hace falta un comando (o --webapp / --desktop)")
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
