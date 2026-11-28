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


def test_run_lee_el_texto_en_utf8() -> None:
    """Git emite UTF-8: en modo texto no se hereda la codificación del sistema."""
    with patch("events_core.proceso.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=["x"], returncode=0)
        proceso.run(["git", "--version"], capture_output=True, text=True)

    kwargs = mock_run.call_args.kwargs
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["errors"] == "replace"


def test_run_respeta_la_codificacion_del_llamador() -> None:
    with patch("events_core.proceso.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=["x"], returncode=0)
        proceso.run(["git", "--version"], text=True, encoding="latin-1", errors="strict")

    kwargs = mock_run.call_args.kwargs
    assert kwargs["encoding"] == "latin-1"
    assert kwargs["errors"] == "strict"


def test_run_sin_texto_no_fija_codificacion() -> None:
    with patch("events_core.proceso.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=["x"], returncode=0)
        proceso.run(["git", "--version"], capture_output=True)

    assert "encoding" not in mock_run.call_args.kwargs
