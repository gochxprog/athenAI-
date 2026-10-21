# Seguridad del VPS · octubre 2026

Objetivo: que solo el dueño pueda ver la plataforma y los datos grabados, con candado (HTTPS), sin perder nunca el
acceso por SSH. Script: `grabadora/asegurar.sh` (se puede repetir; `--deshacer` lo revierte y `SIMULAR=1` solo
muestra lo que haría).

## Capas

| Capa | Qué hace | Qué protege |
|---|---|---|
| **Tailscale** | Red privada entre tus aparatos y el VPS (IP 100.x.y.z) | Desde internet no se llega a la plataforma |
| **DuckDNS** | `<nombre>.duckdns.org` apunta a la IP PRIVADA de Tailscale | Un nombre fácil; fuera de Tailscale lleva a ninguna parte |
| **Caddy (HTTPS)** | Certificado real de Let's Encrypt por reto DNS (DuckDNS); escucha solo en la IP de Tailscale | Todo viaja cifrado, incluida la clave |
| **Contraseña** | `/entrar` pide la clave de la grabadora; sesión con cookie `HttpOnly`, `SameSite=Strict` y `Secure` (30 días); `/salir` la cierra | Aunque alguien llegara a la página, no ve nada sin la clave |
| **Fuerza bruta** | 5 claves malas desde una IP → 15 min bloqueada | Probar claves a lo loco |
| **Grabadora en 127.0.0.1** | Solo Caddy habla con ella | El puerto 8080 deja de existir hacia fuera |
| **Cortafuegos (ufw)** | Primero abre SSH (puerto detectado con `sshd -T`); luego entra todo lo de `tailscale0` y 41641/udp; cierra el resto | Nada más queda expuesto |

## Archivos que crea

- `/etc/athenai/seguro.conf`: nombre de DuckDNS. `instalar.sh` lo lee para no volver a abrir el 8080 al actualizar.
- `/etc/caddy-athenai/Caddyfile`
- `/etc/caddy-athenai/duckdns.env`: el token, solo lo lee Caddy (permisos 600).
- `/usr/local/bin/caddy-athenai`: Caddy con el módulo `caddy-dns/duckdns`, descargado de caddyserver.com.
- Servicio `caddy-athenai`.
- `Environment=HOST=127.0.0.1` en el servicio de la grabadora.

## Pruebas

- `grabadora/grabadora.test.ts`:
  - sin sesión no se ve la web ni los datos;
  - la cookie lleva sus banderas y caduca;
  - salir invalida la sesión;
  - una cookie inventada no sirve;
  - el bloqueo tras 5 fallos, solo para esa IP.
- `grabadora/cliente.test.ts`: con sesión, la plataforma se conecta y descarga sola, sin mandar la clave.
- `asegurar.sh`: sintaxis (`bash -n`) y simulación completa (`SIMULAR=1`). Tailscale, DuckDNS y Let's Encrypt
  reales solo se pueden probar en el VPS.

## Si algo falla

- **El candado no responde:** `journalctl -u caddy-athenai -n 50`. La grabadora sigue grabando igual.
- **Volver a como estaba:** `sudo bash asegurar.sh --deshacer`. La plataforma vuelve a `http://IP:8080`; los datos no se tocan.
