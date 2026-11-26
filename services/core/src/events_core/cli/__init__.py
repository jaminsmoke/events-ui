"""CLI `eui`: lo que un agente usa en vez de la API cruda.

Comandos: `doctor` (la puerta), `config`, y la lectura `repo`, `item` y
`schema`, todos sobre el mismo cliente HTTP. La migración llega después.
Los dos clientes se abren con `--webapp` (la web en el navegador) y
`--desktop`; si no están instalados, el CLI ofrece instalarlos.

    uv run --directory services/core python -m events_core.cli doctor
    uv run --directory services/core python -m events_core.cli config --json

Códigos de salida: 0 bien, 1 algo no cuadra, 2 uso o valor inválido (argparse
sale con 2 por su cuenta).

El paquete está partido por comando: `cliente` (HTTP y doctor), `comun`
(ajustes, raíz y errores), `items`, `migraciones`, `web` (lanzadores) y
`parser`. Aquí quedan `main` y la superficie que consultan el CLI y las
pruebas.
"""

from __future__ import annotations

from ..items.modelo.estados import ESTADOS
from .cliente import (
    _comprobacion,
    _delete,
    _detalle,
    _doctor,
    _enviar,
    _get,
    _health,
    _imprimir,
    _patch,
    _post,
    _url,
    evaluar,
)
from .comun import _config, _contexto, _error, _fallo, _raiz, _repo
from .escritorio import _webapp
from .guardia import _guard, _guard_hook, _puertas, _puertas_del_repo
from .items import (
    _con_raiz,
    _fases_de_fichero,
    _imprimir_item,
    _item,
    _item_create,
    _item_edit,
    _item_fases,
    _item_move,
    _item_requisito,
    _mapa,
    _mostrar,
    _url_item,
)
from .migraciones import (
    _migrar_absorb,
    _migrar_apply,
    _migrar_check,
    _migrar_classify,
    _migrar_export,
    _migrar_guard,
    _migrar_scan,
    _migrar_undo,
)
from .parser import _parser
from .web import _desktop, _estado, _mcp, _schema, _serve, _web


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


__all__ = [
    "ESTADOS",
    "_comprobacion",
    "_delete",
    "_detalle",
    "_enviar",
    "_health",
    "_imprimir",
    "_patch",
    "_url",
    "_config",
    "_con_raiz",
    "_contexto",
    "_desktop",
    "_doctor",
    "_error",
    "_estado",
    "_fallo",
    "_fases_de_fichero",
    "_get",
    "_guard",
    "_guard_hook",
    "_imprimir_item",
    "_item",
    "_item_create",
    "_item_edit",
    "_item_fases",
    "_item_move",
    "_item_requisito",
    "_mapa",
    "_mcp",
    "_migrar_absorb",
    "_migrar_apply",
    "_migrar_check",
    "_migrar_classify",
    "_migrar_export",
    "_migrar_guard",
    "_migrar_scan",
    "_migrar_undo",
    "_mostrar",
    "_parser",
    "_post",
    "_puertas",
    "_puertas_del_repo",
    "_raiz",
    "_repo",
    "_schema",
    "_serve",
    "_url_item",
    "_web",
    "_webapp",
    "evaluar",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
