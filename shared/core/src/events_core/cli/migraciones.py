"""Los comandos `eui migrate`: del Markdown al almacén de Events UI.

(Parte del paquete `cli`; la fachada está en `events_core.cli`.)

`scan` y `classify` proponen, `check` valida el plan, `apply` lo
escribe como un lote y `undo` lo deshace si nadie tocó sus ítems;
`absorb`, `export` y `guard` rematan la migración. Solo `apply`
escribe en el almacén."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import quote

from .. import config as configuracion
from .. import migracion
from ..contrato import FichaError
from ..items.base.comun import InvalidInput, escribir_atomico
from .comun import _contexto, _error, _raiz
from .http import _delete, _post


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
