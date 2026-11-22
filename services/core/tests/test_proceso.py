"""Los hijos de consola no deben abrir ventana en Windows (sidecar GUI)."""

from __future__ import annotations

import subprocess
import sys
from unittest.mock import patch

from events_core import proceso


def test_run_aplica_create_no_window_en_windows() -> None:
    with patch("events_core.proceso.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=["x"], returncode=0)
        proceso.run(["git", "--version"], capture_output=True, text=True)

    kwargs = mock_run.call_args.kwargs
    if sys.platform == "win32":
        assert kwargs["creationflags"] == subprocess.CREATE_NO_WINDOW
    else:
        assert "creationflags" not in kwargs


def test_run_respeta_creationflags_del_llamador() -> None:
    with patch("events_core.proceso.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=["x"], returncode=0)
        proceso.run(["git", "--version"], creationflags=0x1)

    assert mock_run.call_args.kwargs["creationflags"] == 0x1
