#!/usr/bin/env bash
# Deja la plataforma del VPS con NOMBRE y CANDADO (HTTPS), protegida con tu clave. Sin apps extra.
#   1. DuckDNS: el nombre <nombre>.duckdns.org apunta a la IP pública de tu VPS.
#   2. Caddy: HTTPS con certificado real de Let's Encrypt (reto DNS de DuckDNS).
#   3. La grabadora escucha solo en 127.0.0.1 (detrás de Caddy) y la página pide la clave (/entrar),
#      con bloqueo tras 5 intentos malos.
#   4. Cortafuegos (ufw): SSH y HTTPS abiertos; el puerto viejo (8080) y lo demás, cerrados.
#
# Uso:       sudo bash asegurar.sh <nombre> <token>        (nombre = lo que va antes de .duckdns.org)
# Deshacer:  sudo bash asegurar.sh --deshacer               (vuelve a http://IP:PUERTO, sin borrar datos)
# Prueba:    SIMULAR=1 bash asegurar.sh <nombre> <token>    (muestra lo que haría, sin cambiar nada)
# Se puede repetir sin romper nada.
set -euo pipefail

SIMULAR="${SIMULAR:-0}"
SEGURO=/etc/athenai/seguro.conf
UNIDAD=/etc/systemd/system/athenai-grabadora.service

correr() {
  if [ "$SIMULAR" = "1" ]; then echo "+ $*"; else "$@"; fi
}
escribir() { # escribir <archivo> <permisos>  (contenido por stdin)
  if [ "$SIMULAR" = "1" ]; then
    echo "+ escribir $1 ($2):"
    sed 's/^/    | /'
  else
    install -m "$2" /dev/stdin "$1"
  fi
}

if [ "$SIMULAR" != "1" ] && [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo con sudo: sudo bash $0 ..."; exit 1; fi

PUERTO="$(sed -n 's/^Environment=PUERTO=//p' "$UNIDAD" 2>/dev/null || true)"
PUERTO="${PUERTO:-8080}"

# ---------------------------------------------------------------------------------------------------------------
if [ "${1:-}" = "--deshacer" ]; then
  echo "== Deshaciendo: la plataforma vuelve a http://IP:$PUERTO (los datos no se tocan)"
  correr rm -f "$SEGURO"
  correr sed -i '/^Environment=HOST=/d' "$UNIDAD"
  correr systemctl daemon-reload
  correr systemctl restart athenai-grabadora
  correr systemctl disable --now caddy-athenai || true
  if command -v ufw >/dev/null 2>&1; then correr ufw allow "$PUERTO"/tcp; fi
  echo "== Listo: http://IP-DE-TU-VPS:$PUERTO (sigue pidiendo la clave para entrar)."
  exit 0
fi

NOMBRE="$(printf %s "${1:-}" | tr "[:upper:]" "[:lower:]")"
TOKEN="${2:-}"
if ! [[ "$NOMBRE" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "Falta o no vale el nombre. Uso: sudo bash asegurar.sh <nombre> <token>"
  echo "  (el nombre es lo que creaste en duckdns.org, sin «.duckdns.org», en minúsculas)"
  exit 1
fi
if ! [[ "$TOKEN" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Falta o no vale el token. Está arriba en duckdns.org («token»): son 36 caracteres con guiones."
  exit 1
fi
DOMINIO="$NOMBRE.duckdns.org"
echo "== AthenAI · plataforma con candado en https://$DOMINIO (puerto interno $PUERTO)"

# 1) DuckDNS → IP pública del VPS ----------------------------------------------------------------------------------
if [ "$SIMULAR" = "1" ]; then
  IPV4="203.0.113.10"
else
  IPV4="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
fi
echo "== Apuntando $DOMINIO a $IPV4…"
if [ "$SIMULAR" = "1" ]; then
  echo "+ curl https://www.duckdns.org/update?domains=$NOMBRE&token=***&ip=$IPV4"
else
  R="$(curl -fsS --max-time 20 "https://www.duckdns.org/update?domains=$NOMBRE&token=$TOKEN&ip=$IPV4" || true)"
  if [ "$R" != "OK" ]; then echo "!! DuckDNS respondió «${R:-nada}»: revisa el nombre y el token en duckdns.org."; exit 1; fi
fi

# 2) Caddy con el módulo de DuckDNS ----------------------------------------------------------------------------
case "$(uname -m)" in
  x86_64) ARQ=amd64 ;;
  aarch64 | arm64) ARQ=arm64 ;;
  *) echo "!! Arquitectura no soportada: $(uname -m)"; exit 1 ;;
esac
if [ ! -x /usr/local/bin/caddy-athenai ] || ! /usr/local/bin/caddy-athenai list-modules 2>/dev/null | grep -q dns.providers.duckdns; then
  echo "== Descargando Caddy (con DuckDNS)…"
  correr curl -fsSL -o /usr/local/bin/caddy-athenai "https://caddyserver.com/api/download?os=linux&arch=$ARQ&p=github.com/caddy-dns/duckdns"
  correr chmod 755 /usr/local/bin/caddy-athenai
fi
id caddy-athenai >/dev/null 2>&1 || correr useradd --system --home /var/lib/caddy-athenai --create-home --shell /usr/sbin/nologin caddy-athenai
correr mkdir -p /etc/caddy-athenai /etc/athenai

# El token vive en un archivo de entorno que solo lee Caddy (no en el Caddyfile).
printf 'DUCKDNS_TOKEN=%s\n' "$TOKEN" | escribir /etc/caddy-athenai/duckdns.env 600
correr chown caddy-athenai:caddy-athenai /etc/caddy-athenai/duckdns.env
escribir /etc/caddy-athenai/Caddyfile 644 <<CADDY
{
	admin off
}

$DOMINIO {
	tls {
		dns duckdns {env.DUCKDNS_TOKEN}
		resolvers 1.1.1.1 8.8.8.8
	}
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:$PUERTO
}
CADDY
escribir /etc/systemd/system/caddy-athenai.service 644 <<UNIT
[Unit]
Description=AthenAI · HTTPS (Caddy)
After=network-online.target athenai-grabadora.service
Wants=network-online.target

[Service]
User=caddy-athenai
EnvironmentFile=/etc/caddy-athenai/duckdns.env
Environment=XDG_DATA_HOME=/var/lib/caddy-athenai
Environment=XDG_CONFIG_HOME=/var/lib/caddy-athenai
ExecStart=/usr/local/bin/caddy-athenai run --config /etc/caddy-athenai/Caddyfile --adapter caddyfile
Restart=always
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

# 3) Grabadora solo en 127.0.0.1 -----------------------------------------------------------------------------
printf 'NOMBRE=%s\n' "$NOMBRE" | escribir "$SEGURO" 644
if ! grep -q '^Environment=HOST=127.0.0.1' "$UNIDAD" 2>/dev/null; then
  correr sed -i '/^Environment=HOST=/d; /^Environment=PUERTO=/a Environment=HOST=127.0.0.1' "$UNIDAD"
fi
correr systemctl daemon-reload
correr systemctl restart athenai-grabadora
correr systemctl enable caddy-athenai
correr systemctl restart caddy-athenai

# 4) Cortafuegos -------------------------------------------------------------------------------------------------
if ! command -v ufw >/dev/null 2>&1; then correr apt-get install -y ufw; fi
SSH_PUERTO="$(sshd -T 2>/dev/null | sed -n 's/^port //p' | head -n1 || true)"
SSH_PUERTO="${SSH_PUERTO:-22}"
echo "== Cortafuegos: SSH ($SSH_PUERTO) y HTTPS (443) abiertos; el $PUERTO y lo demás, cerrados"
correr ufw allow "$SSH_PUERTO"/tcp            # primero SSH: nunca te quedas fuera del VPS
correr ufw allow 443/tcp                      # la plataforma con candado
correr ufw allow 80/tcp                       # solo redirige http → https
correr ufw delete allow "$PUERTO"/tcp || true # el puerto viejo deja de estar abierto a internet
correr ufw default deny incoming
correr ufw default allow outgoing
correr ufw --force enable

# 5) Comprobación ------------------------------------------------------------------------------------------------
if [ "$SIMULAR" = "1" ]; then
  echo "== (simulado) Listo: https://$DOMINIO"
  exit 0
fi
echo "== Esperando el certificado (puede tardar 1–2 minutos la primera vez)…"
OK=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 --resolve "$DOMINIO:443:127.0.0.1" "https://$DOMINIO/api/salud" 2>/dev/null | grep -q athenAI; then OK=1; break; fi
  sleep 5
done
echo
if [ "$OK" = "1" ]; then
  echo "== LISTO. Tu plataforma ahora tiene nombre y candado:"
  echo
  echo "   https://$DOMINIO"
  echo
  echo "   Ábrela desde el celular o la PC y entra con tu clave: $(cat /var/lib/athenai-grabadora/clave.txt 2>/dev/null || echo '(sudo cat /var/lib/athenai-grabadora/clave.txt)')"
  echo "   Si tu proveedor tiene cortafuegos en su panel web, abre ahí los puertos 443 y 80 (TCP)."
else
  echo "!! La grabadora sigue grabando normal, pero el candado aún no responde."
  echo "   Mira qué dice Caddy:  journalctl -u caddy-athenai -n 50"
fi
