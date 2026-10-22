#!/usr/bin/env bash
# Instalador de la grabadora 24/7 de athenAI para Ubuntu (22.04 / 24.04).
# Uso:  sudo bash instalar.sh [SIMBOLOS] [PUERTO]
#       sudo bash instalar.sh                      → BTCUSDT en el puerto 8080
#       sudo bash instalar.sh BTCUSDT,ETHUSDT 8080
# Se puede volver a ejecutar para actualizar o cambiar los activos: los datos grabados se conservan.
set -euo pipefail

SIMBOLOS="${1:-BTCUSDT}"
PUERTO="${2:-8080}"
APP=/opt/athenai-grabadora
DATOS=/var/lib/athenai-grabadora
AQUI="$(cd "$(dirname "$0")" && pwd)"
# Si ya se aseguró (asegurar.sh), la grabadora sigue escuchando solo en 127.0.0.1 detrás de Caddy (HTTPS).
SEGURO=/etc/athenai/seguro.conf
NOMBRE_SEGURO=""
if [ -f "$SEGURO" ]; then NOMBRE_SEGURO="$(sed -n 's/^NOMBRE=//p' "$SEGURO")"; fi

if [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo con sudo: sudo bash $0"; exit 1; fi
echo "== athenAI · instalando la grabadora 24/7 (activos: $SIMBOLOS · puerto: $PUERTO)"

# 1) Node.js 22 (si no está o es más viejo).
NECESITA_NODE=1
if command -v node >/dev/null 2>&1; then
  MAYOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$MAYOR" -ge 22 ] && NECESITA_NODE=0
fi
if [ "$NECESITA_NODE" -eq 1 ]; then
  echo "== Instalando Node.js 22…"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "   Node $(node -v)"

# 2) ¿Llega a Binance desde aquí? (Binance bloquea los servidores de EE. UU.)
CODIGO="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://fapi.binance.com/fapi/v1/ping || true)"
if [ "$CODIGO" != "200" ]; then
  echo "!! AVISO: este VPS no llega a Binance Futures (respuesta: ${CODIGO:-sin respuesta})."
  echo "!! Si el VPS está en Estados Unidos, Binance lo bloquea: usa un VPS en Europa o Asia."
fi

# 3) Archivos y usuario propio (la grabadora no corre como root).
id athenai >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin athenai
mkdir -p "$APP" "$DATOS"
cp "$AQUI/grabadora.mjs" "$APP/grabadora.mjs"
[ -f "$AQUI/importar.mjs" ] && cp "$AQUI/importar.mjs" "$APP/importar.mjs"
if [ -d "$AQUI/web" ]; then rm -rf "$APP/web"; cp -r "$AQUI/web" "$APP/web"; fi
# Python (Pyodide) para las señales de los bots de Paper 24/7.
if [ -d "$AQUI/pyodide" ]; then rm -rf "$APP/pyodide"; cp -r "$AQUI/pyodide" "$APP/pyodide"; fi
# numpy y pandas para Python (motor de código libre): se bajan del sitio oficial de Pyodide y se comprueban con la
# huella (sha256) de su lista. Si no hay internet, el resto funciona igual y solo el código con pandas avisa.
if [ -f "$APP/pyodide/pyodide-lock.json" ]; then
  echo "== Bajando numpy y pandas para Python…"
  (cd "$APP/pyodide" && node -e '
    const fs = require("fs"), crypto = require("crypto");
    const lock = JSON.parse(fs.readFileSync("pyodide-lock.json", "utf8")).packages;
    const v = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
    const quiero = new Set(["numpy", "pandas"]);
    for (const k of [...quiero]) for (const d of lock[k]?.depends ?? []) quiero.add(d);
    (async () => {
      for (const k of quiero) {
        const { file_name: f, sha256 } = lock[k];
        if (fs.existsSync(f) && crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") === sha256) continue;
        const r = await fetch(`https://cdn.jsdelivr.net/pyodide/v${v}/full/${f}`);
        const b = Buffer.from(await r.arrayBuffer());
        if (!r.ok || crypto.createHash("sha256").update(b).digest("hex") !== sha256) { console.log(`   !! ${k}: no se pudo bajar bien (${r.status})`); continue; }
        fs.writeFileSync(f, b);
        console.log(`   ${k} listo (${(b.length / 1e6).toFixed(1)} MB)`);
      }
    })();
  ') || echo "   !! No se pudieron bajar: el código con pandas/numpy avisará hasta que vuelvas a instalar."
fi
chown -R athenai:athenai "$DATOS"

# 4) Servicio de systemd: arranca solo con el VPS y se reinicia si falla.
cat > /etc/systemd/system/athenai-grabadora.service <<UNIT
[Unit]
Description=athenAI · grabadora 24/7
After=network-online.target
Wants=network-online.target

[Service]
User=athenai
Environment=SIMBOLOS=$SIMBOLOS
Environment=PUERTO=$PUERTO
$( [ -n "$NOMBRE_SEGURO" ] && echo "Environment=HOST=127.0.0.1" )
Environment=DATOS=$DATOS
Environment=WEB=$APP/web
Environment=PYODIDE=$APP/pyodide
ExecStart=$(command -v node) $APP/grabadora.mjs
Restart=always
RestartSec=5
MemoryMax=1500M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable athenai-grabadora >/dev/null
systemctl restart athenai-grabadora

# 5) Cortafuegos: abre el puerto si ufw está activo (nunca si está asegurada: entonces se entra por https).
if [ -z "$NOMBRE_SEGURO" ] && command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow "$PUERTO"/tcp >/dev/null; fi

# 6) Resultado.
for _ in $(seq 1 20); do [ -s "$DATOS/clave.txt" ] && break; sleep 1; done
IP="$(curl -s --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
if systemctl is-active --quiet athenai-grabadora; then
  echo "== LISTO: la grabadora está funcionando."
else
  echo "!! La grabadora no arrancó. Mira el registro con: journalctl -u athenai-grabadora -n 50"
fi
echo
if [ -n "$NOMBRE_SEGURO" ]; then
  echo "   Dirección:  https://$NOMBRE_SEGURO.duckdns.org   (con candado; entra con tu clave)"
  echo "   Clave:      $(cat "$DATOS/clave.txt" 2>/dev/null || echo '(aún no creada)')"
  echo "   Ver el registro:  journalctl -u athenai-grabadora -f"
  exit 0
fi
echo "   Dirección:  http://$IP:$PUERTO"
echo "   Clave:      $(cat "$DATOS/clave.txt" 2>/dev/null || echo '(aún no creada)')"
echo
echo "   Ábrela en el navegador y entra con la clave."
echo "   Para dejarla PRIVADA y con candado: sudo bash asegurar.sh <nombre-duckdns> <token-duckdns>"
echo "   Ver el registro:  journalctl -u athenai-grabadora -f"
echo "   Si tu proveedor tiene un cortafuegos en su panel, abre ahí también el puerto $PUERTO (TCP)."
