"""Revisar un plan contra el repo: refs, ciclos, origen y documentos."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from ..contrato import (
    InformeRevision,
    ResumenRevision,
)
from ..items.base.comun import InvalidInput, fecha_iso
from .documentos import resolver
from .marcadores import _bloques_markdown, _fusionar
from .plan import _items_del_plan, validar_esquema


def revisar(raiz: Path, plan: dict[str, Any], *, plan_ruta: str = "plan.json") -> InformeRevision:
    """Valida el plan y enseña lo que se crearía, sin escribir nada.

    Primero el esquema; solo si pasa se miran los refs, las dependencias, los
    ciclos y cada origen contra el fichero de verdad. Un error de esquema corta
    aquí: seguir con un plan mal formado solo añadiría ruido.
    """
    raiz = raiz.resolve()
    items = _items_del_plan(plan)
    resumen = _resumen(items)
    errores = validar_esquema(plan)
    if errores:
        return InformeRevision(
            ok=False,
            repo=str(raiz),
            plan=plan_ruta,
            crear=[],
            documentos=[],
            errores=errores,
            resumen=ResumenRevision.model_validate(resumen),
        )

    errores = _errores_de_destino(plan)
    vistos: dict[str, int] = {}
    for indice, item in enumerate(items):
        ref = item["ref"]
        if ref in vistos:
            errores.append(
                f"ideas[{indice}].ref: repetida ({ref!r}); ya estaba en items[{vistos[ref]}]"
            )
        else:
            vistos[ref] = indice

    for indice, item in enumerate(items):
        for posicion, dependencia in enumerate(item.get("depende_de") or []):
            ruta_dep = f"ideas[{indice}].depende_de[{posicion}]"
            if dependencia == item["ref"]:
                errores.append(f"{ruta_dep}: se apunta a sí misma ({dependencia!r})")
            elif dependencia not in vistos:
                errores.append(f"{ruta_dep}: no existe el ítem {dependencia!r}")

    grafo = {
        item["ref"]: [dep for dep in item.get("depende_de") or [] if dep in vistos]
        for item in items
    }
    for ciclo in _ciclos(grafo):
        errores.append(f"dependencia circular: {' → '.join(ciclo)}")

    errores.extend(_errores_de_origen(raiz, items))
    errores.extend(_errores_de_documentos(raiz, plan, items))

    titulos: dict[tuple[str, str], int] = {}
    for indice, item in enumerate(items):
        clave = (item["title"].strip().casefold(), item["origen"]["ruta"])
        if clave in titulos:
            errores.append(
                f"ideas[{indice}]: «{item['title']}» ya sale en items[{titulos[clave]}] "
                "del mismo fichero"
            )
        else:
            titulos[clave] = indice

    crear = [
        {
            "ref": item["ref"],
            "title": item["title"],
            "status": item.get("status") or "proposed",
            "origen": item["origen"],
        }
        for item in items
    ]
    return InformeRevision(
        ok=not errores,
        repo=str(raiz),
        plan=plan_ruta,
        crear=crear,
        documentos=[
            {
                "ruta": doc["ruta"],
                "clase": doc["clase"],
                "destino": doc["destino"],
            }
            for doc in (plan.get("documentos") or [])
            if isinstance(doc, dict) and "ruta" in doc and "clase" in doc
        ],
        errores=errores,
        resumen=ResumenRevision.model_validate(resumen),
    )


def _errores_de_destino(plan: dict[str, Any]) -> list[str]:
    """Lo que el esquema no puede decir de los carriles y sus datos."""
    errores: list[str] = []
    version = plan.get("version")
    documentos = plan.get("documentos")
    if version == 3:
        if not isinstance(documentos, list) or not documentos:
            errores.append("documentos: la versión 3 exige el manifiesto de documentos")
    elif documentos is not None:
        errores.append("documentos: solo vale con version 3")
    for indice, item in enumerate(_items_del_plan(plan)):
        if not isinstance(item, dict):
            continue
        estado = item.get("status") or "proposed"
        if version == 1 and estado != "proposed":
            errores.append(
                f"ideas[{indice}].status: la versión 1 solo admite proposed; usa version 2"
            )
        if estado != "proposed" and item.get("fases"):
            errores.append(f"ideas[{indice}].fases: solo valen con status proposed")
        if estado == "rejected" and not str(item.get("motivo") or "").strip():
            errores.append(f"ideas[{indice}].motivo: rejected exige un motivo")
        fecha = item.get("fecha")
        if fecha is not None:
            if estado not in ("historial", "rejected"):
                errores.append(f"ideas[{indice}].fecha: solo vale para historial o rejected")
                continue
            try:
                fecha_iso(str(fecha))
            except InvalidInput as exc:
                errores.append(f"ideas[{indice}].fecha: {exc}")
    return errores


def _errores_de_documentos(
    raiz: Path, plan: dict[str, Any], items: list[dict[str, Any]]
) -> list[str]:
    """Allowlist del mapa, cobertura de bloques y rangos de los parciales.

    Solo corre con version 3 (el manifiesto ya pasó el esquema). Las items solo
    pueden salir de `mapa`/`parcial`; en `mapa` todos los bloques accionables
    tienen que estar cubiertos; en `parcial` hace falta `rangos` y los ítems
    (y los bloques dentro de esos rangos) tienen que caer dentro.
    """
    if plan.get("version") != 3:
        return []
    documentos = plan.get("documentos")
    if not isinstance(documentos, list):
        return []

    errores: list[str] = []
    por_ruta: dict[str, dict[str, Any]] = {}
    for indice, documento in enumerate(documentos):
        if not isinstance(documento, dict):
            continue
        prefijo = f"documentos[{indice}]"
        ruta = str(documento.get("ruta") or "")
        clase = documento.get("clase")
        destino = documento.get("destino")
        if ruta in por_ruta:
            errores.append(f"{prefijo}.ruta: repetida ({ruta!r})")
            continue
        por_ruta[ruta] = documento

        if clase == "referencia" and destino != "referencia":
            errores.append(f"{prefijo}.destino: clase referencia exige destino referencia")
        if clase in ("mapa", "parcial") and destino != "mapa":
            errores.append(f"{prefijo}.destino: clase {clase} exige destino mapa")

        rangos = documento.get("rangos")
        if clase == "parcial":
            if not isinstance(rangos, list) or not rangos:
                errores.append(f"{prefijo}.rangos: parcial exige al menos un rango")
            else:
                for posicion, rango in enumerate(rangos):
                    if not isinstance(rango, dict):
                        continue
                    desde = rango.get("desde")
                    hasta = rango.get("hasta")
                    if isinstance(desde, int) and isinstance(hasta, int) and desde > hasta:
                        errores.append(
                            f"{prefijo}.rangos[{posicion}]: desde {desde} va después "
                            f"de hasta {hasta}"
                        )
        elif rangos is not None:
            errores.append(f"{prefijo}.rangos: solo vale con clase parcial")

        try:
            archivo = resolver(raiz, ruta)
        except (InvalidInput, FileNotFoundError) as exc:
            errores.append(f"{prefijo}.ruta: {exc}")
            continue
        if archivo.is_dir():
            errores.append(f"{prefijo}.ruta: {ruta!r} es una carpeta")

    allowlist = {
        ruta
        for ruta, documento in por_ruta.items()
        if documento.get("clase") in ("mapa", "parcial")
    }
    ideas_por_ruta: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for indice, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("origen"), dict):
            continue
        ruta = str(item["origen"].get("ruta") or "")
        ideas_por_ruta.setdefault(ruta, []).append((indice, item))
        if ruta not in por_ruta:
            errores.append(
                f"ideas[{indice}].origen.ruta: {ruta!r} no está en documentos "
                "(hay que clasificarla)"
            )
        elif ruta not in allowlist:
            errores.append(
                f"ideas[{indice}].origen.ruta: {ruta!r} es referencia; no puede alimentar el mapa"
            )

    for ruta, documento in por_ruta.items():
        clase = documento.get("clase")
        if clase not in ("mapa", "parcial"):
            continue
        try:
            archivo = resolver(raiz, ruta)
        except (InvalidInput, FileNotFoundError):
            continue
        if not archivo.is_file():
            continue
        try:
            texto = archivo.read_text(encoding="utf-8")
        except OSError as exc:
            errores.append(f"documentos ({ruta!r}): no se pudo leer: {exc}")
            continue
        bloques = _bloques_markdown(texto)
        origenes = [
            (
                int(item["origen"]["desde_linea"]),
                int(item["origen"]["hasta_linea"]),
            )
            for _indice, item in ideas_por_ruta.get(ruta, [])
            if isinstance(item.get("origen"), dict)
        ]
        if clase == "parcial":
            rangos = [
                (int(rango["desde"]), int(rango["hasta"]))
                for rango in (documento.get("rangos") or [])
                if isinstance(rango, dict)
                and isinstance(rango.get("desde"), int)
                and isinstance(rango.get("hasta"), int)
            ]
            fusion = _fusionar(sorted(rangos))
            for indice, item in ideas_por_ruta.get(ruta, []):
                desde = int(item["origen"]["desde_linea"])
                hasta = int(item["origen"]["hasta_linea"])
                if not any(r_desde <= desde and hasta <= r_hasta for r_desde, r_hasta in fusion):
                    errores.append(
                        f"ideas[{indice}].origen: fuera de los rangos parciales de {ruta!r}"
                    )
            bloques = [
                bloque
                for bloque in bloques
                if any(desde <= bloque["linea"] <= hasta for desde, hasta in fusion)
            ]

        sin_clasificar = [
            bloque
            for bloque in bloques
            if not any(desde <= bloque["linea"] <= hasta for desde, hasta in origenes)
        ]
        if sin_clasificar:
            muestra = ", ".join(
                f"L{bloque['linea']} «{bloque['texto']}»" for bloque in sin_clasificar[:5]
            )
            errores.append(
                f"documentos ({ruta!r}): quedan {len(sin_clasificar)} bloques sin "
                f"clasificar: {muestra}"
            )
    return errores


def _resumen(items: list[Any]) -> dict[str, int]:
    archivos = {
        item["origen"]["ruta"]
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("origen"), dict)
        and isinstance(item["origen"].get("ruta"), str)
    }
    return {"items": len(items), "archivos": len(archivos), "refs": len(items)}


def _errores_de_origen(raiz: Path, items: list[dict[str, Any]]) -> list[str]:
    """Cada origen tiene que seguir siendo el fichero del scan."""
    errores: list[str] = []
    for indice, item in enumerate(items):
        origen = item["origen"]
        prefijo = f"ideas[{indice}].origen"
        try:
            archivo = resolver(raiz, origen["ruta"])
        except InvalidInput as exc:
            errores.append(f"{prefijo}: {exc}")
            continue
        except FileNotFoundError:
            errores.append(f"{prefijo}: no existe {origen['ruta']!r}")
            continue
        if archivo.is_dir():
            errores.append(f"{prefijo}: {origen['ruta']!r} es una carpeta")
            continue
        try:
            crudo = archivo.read_bytes()
        except OSError as exc:
            errores.append(f"{prefijo}: no se pudo leer {origen['ruta']!r}: {exc}")
            continue

        if hashlib.sha256(crudo).hexdigest() != origen["sha256"]:
            errores.append(f"{prefijo}: {origen['ruta']!r} cambió desde el scan (sha256 no cuadra)")
        lineas = len(crudo.decode("utf-8", errors="replace").splitlines())
        if origen["desde_linea"] > origen["hasta_linea"]:
            errores.append(
                f"{prefijo}: desde_linea {origen['desde_linea']} va después de "
                f"hasta_linea {origen['hasta_linea']}"
            )
        elif origen["hasta_linea"] > lineas:
            errores.append(
                f"{prefijo}: hasta_linea {origen['hasta_linea']} supera las "
                f"{lineas} líneas del fichero"
            )
    return errores


def _ciclos(grafo: dict[str, list[str]]) -> list[list[str]]:
    """Los ciclos del grafo de dependencias, cada uno con su recorrido."""
    colores: dict[str, int] = {}
    pila: list[str] = []
    encontrados: list[list[str]] = []
    vistos: set[tuple[str, ...]] = set()

    def visitar(nodo: str) -> None:
        colores[nodo] = 1
        pila.append(nodo)
        for vecino in grafo.get(nodo, []):
            if colores.get(vecino, 0) == 0:
                visitar(vecino)
            elif colores.get(vecino) == 1:
                ciclo = pila[pila.index(vecino) :] + [vecino]
                clave = tuple(sorted(ciclo[:-1]))
                if clave not in vistos:
                    vistos.add(clave)
                    encontrados.append(ciclo)
        pila.pop()
        colores[nodo] = 2

    for nodo in grafo:
        if colores.get(nodo, 0) == 0:
            visitar(nodo)
    return encontrados
