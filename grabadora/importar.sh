#!/usr/bin/env bash
# Importa la historia gratis de Binance (data.binance.vision) en el VPS, de fondo: sigue aunque cierres el SSH y no
# molesta a la grabadora (prioridad baja). Lo importado va a /var/lib/athenai-grabadora/historia (aparte de lo grabado).
# Uso:
#   sudo bash importar.sh BTCUSDT 2026-04-01 2026-10-20   importa esos días (los ya importados se saltan)
#   sudo bash importar.sh --ver                           cómo va
#   sudo bash importar.sh --parar                         la detiene (después se puede seguir donde quedó)
set -euo pipefail
APP=/opt/athenai-grabadora
DATOS=/var/lib/athenai-grabadora
UNIDAD=athenai-importar
AQUI="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo con sudo: sudo bash $0 ..."; exit 1; fi

case "${1:-}" in
  --ver)
    journalctl -u "$UNIDAD" -n 30 --no-pager -o cat
    exit 0
    ;;
  --parar)
    systemctl stop "$UNIDAD" 2>/dev/null || true
    echo "== Importación detenida. Para seguir donde quedó, vuelve a correr el mismo comando."
    exit 0
    ;;
  "")
    echo "Uso: sudo bash $0 SIMBOLO DESDE [HASTA]   (fechas AAAA-MM-DD; ejemplo: BTCUSDT 2026-04-01 2026-10-20)"
    exit 1
    ;;
esac

if [ -f "$AQUI/importar.mjs" ]; then mkdir -p "$APP" && cp "$AQUI/importar.mjs" "$APP/importar.mjs"; fi
if [ ! -f "$APP/importar.mjs" ]; then echo "!! Falta importar.mjs: instala primero la grabadora (instalar.sh)."; exit 1; fi
if systemctl is-active --quiet "$UNIDAD"; then
  echo "!! Ya hay una importación corriendo. Mírala con: sudo bash $0 --ver"
  exit 1
fi
systemctl reset-failed "$UNIDAD" 2>/dev/null || true
mkdir -p "$DATOS"
chown athenai:athenai "$DATOS"

systemd-run --quiet --unit="$UNIDAD" --uid=athenai --gid=athenai \
  -p Nice=10 -p IOSchedulingClass=idle -p MemoryMax=1G \
  --setenv=DATOS="$DATOS" \
  "$(command -v node)" "$APP/importar.mjs" "$@"

echo "== Importando la historia de Binance de fondo: $*"
echo "   Tarda ~1-2 minutos por día de BTC. Puedes cerrar el SSH: sigue sola."
echo "   Ver cómo va:  sudo bash $0 --ver"
echo "   Detenerla:    sudo bash $0 --parar"
