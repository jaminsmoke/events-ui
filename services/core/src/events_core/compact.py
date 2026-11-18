"""CLI de retención: `python -m events_core.compact <repo> [--dias N] [--max N]`.

Sin arguments de su lado, la política por defecto es la de `eventos.py`
(90 días / 5 000 eventos). Imprime qué se recortó con el mismo resumen que
devuelve `POST /eventos/compactar`.
"""

from __future__ import annotations

import argparse
import sys

from . import eventos


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recorta el log de eventos de un repo.")
    parser.add_argument("repo", help="Carpeta del repo: ruta o nombre en el laboratorio")
    parser.add_argument("--dias", type=int, default=eventos.DIAS_RETENCION)
    parser.add_argument("--max", type=int, default=eventos.MAX_EVENTOS_RETENCION)
    args = parser.parse_args(argv)

    try:
        resumen = eventos.compactar(args.repo, dias=args.dias, max_eventos=args.max)
    except FileNotFoundError as exc:
        print(f"no existe ese repo: {exc}", file=sys.stderr)
        return 1

    total = resumen["eliminados_por_edad"] + resumen["eliminados_por_conteo"]
    por_edad = resumen["eliminados_por_edad"]
    por_conteo = resumen["eliminados_por_conteo"]
    vacuum = ", fichero recompactado (VACUUM)" if resumen["vacuum"] else ""
    linea = f"{total} eventos fuera ({por_edad} por edad, {por_conteo} por conteo){vacuum}"
    print(f"{resumen['repo']}: {linea}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
