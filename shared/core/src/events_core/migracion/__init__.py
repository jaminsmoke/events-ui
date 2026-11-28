"""Escaneo de Markdown y migración de documentos por etapas.

`eui migrate scan` es la mitad que no escribe: dice qué Markdown hay bajo una
carpeta del repo, con su hash y lo que se reconoce de cada uno (frontmatter
simple, títulos y tareas). Con eso el agente propone un plan JSON y un
importador determinista lo valida y aplica. Al escanear no se abre el almacén ni
se modifica ningún fichero: solo lectura.

El paquete está partido por etapa:

- `documentos`: recorrer, leer y clasificar los Markdown del repo.
- `esquema`: el JSON Schema del plan.
- `plan`: cargarlo, hashearlo y validarlo contra el esquema.
- `revision`: revisar un plan contra el repo.
- `marcadores`, `absorcion` y `confirmacion`: qué cambia al absorber un lote y cómo se cierra.
- `exportacion`: exportar documentos y leer las copias absorbidas.

Aquí queda la fachada: `events_core.migracion` expone lo de siempre.
"""

from __future__ import annotations

from ..items.base.comun import InvalidInput
from .absorcion import (
    _informe_absorcion_vacio,
    _informe_archivo,
    revisar_absorcion,
)
from .confirmacion import _ruta_en_repo, confirmar_absorcion
from .documentos import (
    DIRECTORIOS_IGNORADOS,
    EXTENSIONES,
    MAX_ARCHIVOS,
    MAX_HUECOS,
    _ficha,
    _frontmatter,
    _markdowns,
    _proponer_documento,
    _relativa,
    _tareas,
    _titulos,
    clasificar,
    escanear,
    resolver,
)
from .esquema import ESQUEMA_PLAN
from .exportacion import (
    SECCIONES_EXPORT,
    _bloque_export,
    _markdowns_en_eui,
    _uids_desconocidos,
    documentos_ajenos,
    exportar_documento,
    listar_documentos_absorbidos,
)
from .marcadores import (
    _aplicar_marcadores,
    _bloques_markdown,
    _fusionar,
    _marcadores_del_lote,
    _solapamientos,
    _texto_marcador,
)
from .plan import (
    PlanInvalido,
    _errores_de_rama,
    _igual,
    _items_del_plan,
    _nombre_tipo,
    _resolver_ref,
    _texto,
    _tipo_ok,
    _validar,
    cargar_plan,
    huella_plan,
    validar_esquema,
)
from .revision import (
    _ciclos,
    _errores_de_destino,
    _errores_de_documentos,
    _errores_de_origen,
    _resumen,
    revisar,
)

__all__ = [
    "DIRECTORIOS_IGNORADOS",
    "ESQUEMA_PLAN",
    "EXTENSIONES",
    "MAX_ARCHIVOS",
    "MAX_HUECOS",
    "SECCIONES_EXPORT",
    "InvalidInput",
    "PlanInvalido",
    "_bloque_export",
    "_aplicar_marcadores",
    "_bloques_markdown",
    "_ciclos",
    "_errores_de_destino",
    "_errores_de_documentos",
    "_errores_de_origen",
    "_errores_de_rama",
    "_ficha",
    "_frontmatter",
    "_fusionar",
    "_igual",
    "_informe_absorcion_vacio",
    "_informe_archivo",
    "_items_del_plan",
    "_marcadores_del_lote",
    "_markdowns",
    "_markdowns_en_eui",
    "_nombre_tipo",
    "_proponer_documento",
    "_relativa",
    "_resolver_ref",
    "_resumen",
    "_ruta_en_repo",
    "_solapamientos",
    "_tareas",
    "_texto",
    "_texto_marcador",
    "_tipo_ok",
    "_titulos",
    "_uids_desconocidos",
    "_validar",
    "cargar_plan",
    "clasificar",
    "confirmar_absorcion",
    "documentos_ajenos",
    "escanear",
    "exportar_documento",
    "huella_plan",
    "listar_documentos_absorbidos",
    "resolver",
    "revisar",
    "revisar_absorcion",
    "validar_esquema",
]
