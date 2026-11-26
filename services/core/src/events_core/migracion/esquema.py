"""El JSON Schema del plan de migración que valida `migrate check`."""

from __future__ import annotations

from typing import Any

ESQUEMA_PLAN: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:events-ui:plan-migracion:1",
    "title": "Plan de migración de Markdown",
    "description": (
        "Lo que propone el agente antes de tocar el almacén. Cada item cita el "
        "Markdown del que sale (ruta, líneas y sha256). La v3 añade el "
        "manifiesto `documentos` (mapa / referencia / parcial). `check` añade "
        "lo que el esquema no puede comprobar (refs, dependencias, hash, "
        "clasificación y cobertura de bloques) y `apply` lo aplica como un "
        "lote reversible."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": ["version"],
    # `items` es el nombre nuevo; `ideas` el de los planes v1-v3 guardados.
    "anyOf": [{"required": ["items"]}, {"required": ["ideas"]}],
    "properties": {
        "version": {
            "enum": [1, 2, 3],
            "description": (
                "1: solo proposed; 2: destinos, fechas y motivo; "
                "3: manifiesto de documentos (allowlist del mapa)."
            ),
        },
        "items": {
            "type": "array",
            "minItems": 1,
            "items": {"$ref": "#/$defs/work_item"},
        },
        "ideas": {
            "type": "array",
            "minItems": 1,
            "description": "Nombre antiguo de `items`; se acepta al leer planes v1-v3.",
            "items": {"$ref": "#/$defs/work_item"},
        },
        "documentos": {
            "type": "array",
            "minItems": 1,
            "items": {"$ref": "#/$defs/documento"},
            "description": (
                "Obligatorio en version 3. Clasificación de cada Markdown del "
                "plan: allowlist (`mapa`/`parcial`) o `referencia`."
            ),
        },
    },
    "$defs": {
        "ref": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
            "description": "Identificador local del plan; no es un uid del almacén.",
        },
        "documento": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ruta", "clase", "motivo", "destino"],
            "properties": {
                "ruta": {
                    "type": "string",
                    "minLength": 1,
                    "pattern": "^[^\\\\]+$",
                    "description": "Ruta relativa al repo, con `/` y sin `..`.",
                },
                "clase": {
                    "enum": ["mapa", "referencia", "parcial"],
                    "description": (
                        "`mapa` alimenta el mapa entero; `referencia` no crea "
                        "ideas; `parcial` solo los rangos declarados."
                    ),
                },
                "motivo": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Por qué esta clasificación.",
                },
                "destino": {
                    "enum": ["mapa", "referencia"],
                    "description": (
                        "Dónde va el contenido: `mapa` (allowlist) o "
                        "`referencia`. Debe cuadrar con `clase`."
                    ),
                },
                "rangos": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"$ref": "#/$defs/rango"},
                    "description": "Obligatorio con clase `parcial`; 1-based inclusive.",
                },
            },
        },
        "rango": {
            "type": "object",
            "additionalProperties": False,
            "required": ["desde", "hasta"],
            "properties": {
                "desde": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Primera línea del rango (1-based).",
                },
                "hasta": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Última línea del rango (1-based, incluida).",
                },
            },
        },
        "work_item": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ref", "title", "origen"],
            "properties": {
                "ref": {
                    "$ref": "#/$defs/ref",
                    "description": "Único en el plan; `depende_de` apunta aquí.",
                },
                "title": {"type": "string", "minLength": 1},
                "description": {"type": "string", "default": ""},
                "content": {"type": "string", "default": ""},
                "kind": {"enum": ["work_item", "idea"], "default": "work_item"},
                "status": {
                    "enum": ["proposed", "draft", "historial", "rejected"],
                    "default": "proposed",
                    "description": (
                        "Carril de destino. `historial` y `rejected` no llevan fases; "
                        "`rejected` exige `motivo`."
                    ),
                },
                "fecha": {
                    "type": "string",
                    "minLength": 1,
                    "description": (
                        "Fecha de archivo o descarte (ISO 8601); solo con historial "
                        "o rejected. Sin ella se usa la de importación."
                    ),
                },
                "motivo": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Por qué se descarta; obligatorio con rejected.",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                    "default": [],
                },
                "depende_de": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/ref"},
                    "uniqueItems": True,
                    "default": [],
                    "description": "Refs de otras items de este plan, nunca uids.",
                },
                "fases": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/fase"},
                    "default": [],
                    "description": "Solo con status proposed.",
                },
                "origen": {"$ref": "#/$defs/origen"},
            },
        },
        "fase": {
            "type": "object",
            "additionalProperties": False,
            "required": ["titulo"],
            "properties": {
                "titulo": {"type": "string", "minLength": 1},
                "nota": {"type": "string", "default": ""},
                "estado": {
                    "enum": ["pendiente"],
                    "default": "pendiente",
                    "description": "Una migración no trae fases hechas ni fallidas.",
                },
                "requisitos": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"$ref": "#/$defs/requisito"},
                    "description": "Una fase sin criterio de hecho no se puede cerrar.",
                },
            },
        },
        "requisito": {
            "type": "object",
            "additionalProperties": False,
            "required": ["titulo"],
            "properties": {
                "titulo": {"type": "string", "minLength": 1},
                "hecho": {
                    "const": False,
                    "default": False,
                    "description": "Marcar un requisito es una decisión del usuario.",
                },
            },
        },
        "origen": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ruta", "desde_linea", "hasta_linea", "sha256"],
            "properties": {
                "ruta": {
                    "type": "string",
                    "minLength": 1,
                    "pattern": "^[^\\\\]+$",
                    "description": "Ruta relativa al repo, con `/` y sin `..`.",
                },
                "desde_linea": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Primera línea del elemento (1-based).",
                },
                "hasta_linea": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Última línea del elemento (1-based, incluida).",
                },
                "sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                    "description": "El sha256 que dio `migrate scan` para ese fichero.",
                },
            },
        },
    },
}
