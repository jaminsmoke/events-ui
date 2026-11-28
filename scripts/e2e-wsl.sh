#!/usr/bin/env bash
# e2e bajo WSL: el único sitio donde la rama POSIX de los scripts se ejecuta de
# verdad. En Windows el e2e solo pasa por `taskkill`; aquí pasa por
# `process.kill(-pid)` y por los hijos `detached`.
#
# Medido el 28 de noviembre de 2026 (Ubuntu 26.04, WSL 2.7.12): `prueba-1-limpieza`
# en verde en 31,5 s y los tres puertos libres al terminar.
#
# Uso desde Windows (Git Bash convierte los argumentos que empiezan por `/`):
#   MSYS2_ARG_CONV_EXCL='*' wsl.exe -e bash /mnt/c/.../scripts/e2e-wsl.sh [filtro]
#
# Clona el repo en `~/eui-wsl` en vez de correr sobre `/mnt/c`: así no pisa el
# `node_modules` de Windows (los binarios nativos no son los mismos) ni ensucia
# el árbol de trabajo.
#
# Por qué el navegador se prepara a mano: el repo solo trae `playwright-core`,
# que no descarga binarios, y en WSL no hay root para `apt install`. Se baja el
# headless shell con el `playwright` completo y las dos librerías que le faltan
# (`libnspr4`, `libnss3`) se extraen de sus `.deb` en `~/libs`.
set -u
export PATH="$HOME/.local/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RAIZ_REPO="${EUI_REPO:-$(cd "$AQUI/.." && pwd)}"
CLON="${EUI_CLON:-$HOME/eui-wsl}"
LIBS="$HOME/libs/usr/lib/x86_64-linux-gnu"
FILTRO="${1:-}"

echo "== clon =="
if [ -d "$CLON/.git" ]; then
  git -C "$CLON" fetch -q origin main && git -C "$CLON" reset -q --hard FETCH_HEAD ||
    echo "aviso: no se pudo actualizar el clon, uso lo que hay"
else
  git clone -q "$RAIZ_REPO" "$CLON"
fi
git -C "$CLON" log --oneline -1
cd "$CLON" || exit 1

echo "== dependencias =="
corepack pnpm install --frozen-lockfile --reporter=append-only 2>&1 | tail -3
uv run --directory shared/core python -c "import events_core; print('core', events_core.__version__)" 2>&1 | tail -2

echo "== navegador =="
if [ ! -f "$LIBS/libnss3.so" ]; then
  corepack pnpm dlx playwright@1.65.1 install chromium-headless-shell 2>&1 | tail -2
  mkdir -p "$HOME/pkg" && cd "$HOME/pkg" || exit 1
  apt-get download libnspr4 libnss3 2>&1 | tail -2
  for d in libnspr4_*.deb libnss3_*.deb; do [ -f "$d" ] && dpkg-deb -x "$d" "$HOME/libs"; done
  cd "$CLON" || exit 1
fi
export LD_LIBRARY_PATH="$LIBS"

echo "== e2e ${FILTRO:-(batería completa)} =="
INICIO=$(date +%s)
node e2e/run.mjs $FILTRO
CODIGO=$?
echo "codigo=$CODIGO en $(( $(date +%s) - INICIO ))s"

echo "== restos =="
ss -ltnp 2>/dev/null | grep -E ':18765|:15174|:15175' || echo "(puertos libres)"
exit $CODIGO
