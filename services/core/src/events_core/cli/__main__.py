"""`python -m events_core.cli`: el mismo arranque que la fachada."""

from __future__ import annotations

from . import main

if __name__ == "__main__":
    raise SystemExit(main())
