"""Confirmar una absorción: marcadores, copias y el Markdown que queda."""

from __future__ import annotations

import hashlib
from contextlib import suppress
from pathlib import Path
from typing import Any

from ..items.base.comun import InvalidInput, escribir_atomico, now_iso
from .absorcion import revisar_absorcion
from .marcadores import _aplicar_marcadores


def _ruta_en_repo(raiz: Path, ruta: str) -> Path:
    destino = (raiz / ruta).resolve()
    if not destino.is_relative_to(raiz):
        raise InvalidInput(f"ruta fuera del repo: {ruta!r}")
    return destino


def confirmar_absorcion(raiz: Path, lote: str, *, parcial: bool = False) -> dict[str, Any]:
    """Copia los documentos y retira (total) o reescribe con marcadores (parcial).

    La validación es la misma que la del dry-run. Primero copia y verifica
    todos los ficheros, después escribe el manifiesto y solo entonces toca los
    originales. Si algo falla, deja los documentos como estaban. En modo total
    la vista posterior se genera con `migrate export`; en parcial el origen
    sigue en el repo con marcadores visibles `[eui:<uid>]`.
    """
    from ..items.migracion import escribir_absorcion, leer_absorcion

    raiz = raiz.resolve()
    informe = revisar_absorcion(raiz, lote, parcial=parcial)
    if not informe["ok"]:
        raise InvalidInput("; ".join(informe["errores"]) or "la absorción no está completa")
    if parcial:
        if not informe["reescribir"]:
            raise InvalidInput("no hay documentos que reescribir")
    elif not informe["retirar"]:
        raise InvalidInput("no hay documentos que absorber")
    if leer_absorcion(str(raiz), lote) is not None:
        raise InvalidInput(f"el lote {lote} ya está absorbido")

    originales: dict[str, bytes] = {}
    reescritos: dict[str, bytes] = {}
    copias: list[Path] = []
    archivos: list[dict[str, Any]] = []
    manifiesto_ruta = raiz / ".EUI" / "migracion" / lote / "absorcion.json"
    try:
        for archivo in informe["archivos"]:
            ruta = str(archivo["ruta"])
            origen = _ruta_en_repo(raiz, ruta)
            crudo = origen.read_bytes()
            sha = hashlib.sha256(crudo).hexdigest()
            if sha != archivo["hash_actual"]:
                raise InvalidInput(f"{ruta}: cambió entre la revisión y la copia")

            copia_rel = str(archivo["copia"]["destino"])
            copia = _ruta_en_repo(raiz, copia_rel)
            escribir_atomico(copia, crudo)
            if hashlib.sha256(copia.read_bytes()).hexdigest() != sha:
                raise InvalidInput(f"{ruta}: la copia no coincide con el original")

            originales[ruta] = crudo
            copias.append(copia)
            entrada: dict[str, Any] = {
                "ruta": ruta,
                "copia": copia_rel,
                "sha256_origen": sha,
                "sha256_copia": sha,
            }
            if parcial:
                texto = crudo.decode("utf-8-sig")
                reescrito = _aplicar_marcadores(texto, archivo["marcadores"])
                reescrito_bytes = reescrito.encode("utf-8")
                reescritos[ruta] = reescrito_bytes
                entrada["sha256_stub"] = hashlib.sha256(reescrito_bytes).hexdigest()
                entrada["marcadores"] = archivo["marcadores"]
                entrada["modo"] = "parcial"
            archivos.append(entrada)

        manifiesto = {
            "version": 1,
            "lote": lote,
            "modo": "parcial" if parcial else "total",
            "absorbido_at": now_iso(),
            "estado": "copiado",
            "archivos": archivos,
        }
        escribir_absorcion(str(raiz), lote, manifiesto)
        manifiesto_ruta = raiz / ".EUI" / "migracion" / lote / "absorcion.json"

        if parcial:
            for ruta, contenido in reescritos.items():
                escribir_atomico(_ruta_en_repo(raiz, ruta), contenido)
        else:
            for archivo in informe["archivos"]:
                _ruta_en_repo(raiz, str(archivo["ruta"])).unlink()

        manifiesto["estado"] = "absorbido"
        escribir_absorcion(str(raiz), lote, manifiesto)
    except Exception:
        for ruta, crudo in originales.items():
            with suppress(OSError):
                escribir_atomico(_ruta_en_repo(raiz, ruta), crudo)
        for copia in copias:
            copia.unlink(missing_ok=True)
        manifiesto_ruta.unlink(missing_ok=True)
        raise

    return {
        **informe,
        "dry_run": False,
        "absorbido": True,
        "ok": True,
        "manifest": f".EUI/migracion/{lote}/absorcion.json",
        "archivos": [
            {
                **archivo,
                "absorbido": True,
            }
            for archivo in informe["archivos"]
        ],
    }
