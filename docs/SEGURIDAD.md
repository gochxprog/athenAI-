# Seguridad del VPS · octubre 2026

Objetivo: que solo el dueño pueda ver la plataforma y los datos grabados, con nombre y candado (HTTPS), sin
instalar apps y sin perder nunca el acceso por SSH. Script: `grabadora/asegurar.sh`:
- se puede repetir;
- `--deshacer` lo revierte;
- `SIMULAR=1` solo muestra lo que haría.

## Capas

| Capa | Qué hace | Qué protege |
|---|---|---|
| **DuckDNS** | `<nombre>.duckdns.org` apunta a la IP pública del VPS | Un nombre fácil en vez de la IP |
| **Caddy (HTTPS)** | Certificado real de Let's Encrypt por reto DNS (DuckDNS) | Todo viaja cifrado, incluida la clave |
| **Contraseña** | `/entrar` pide la clave de la grabadora. Sesión con cookie `HttpOnly`, `SameSite=Strict` y `Secure` (30 días); `/salir` la cierra | Sin la clave no se ve nada: ni la plataforma ni los datos |
| **Fuerza bruta** | 5 claves malas desde una IP → 15 min bloqueada | Probar claves a lo loco |
| **Grabadora en 127.0.0.1** | Solo Caddy habla con ella | El puerto 8080 deja de existir hacia fuera |
| **Cortafuegos (ufw)** | Primero abre SSH (puerto detectado con `sshd -T`), luego 443 y 80; cierra el resto | Nada más queda expuesto |

Tailscale se probó en la versión anterior y se quitó, porque hacía más lento el acceso. Si quedó instalado,
`asegurar.sh` lo apaga y lo desinstala.

## Archivos que crea

- `/etc/athenai/seguro.conf`: nombre de DuckDNS. `instalar.sh` lo lee para no volver a abrir el 8080.
- `/etc/caddy-athenai/Caddyfile` y `/etc/caddy-athenai/duckdns.env` (el token, permisos 600, solo lo lee Caddy).
- `/usr/local/bin/caddy-athenai` (Caddy con el módulo `caddy-dns/duckdns`) y el servicio `caddy-athenai`.
- `Environment=HOST=127.0.0.1` en el servicio de la grabadora.

## Si algo falla

- **El candado no responde:** `journalctl -u caddy-athenai -n 50`. Si tu proveedor tiene cortafuegos en su panel, abre ahí los puertos 443 y 80.
- **Volver a como estaba:** `sudo bash asegurar.sh --deshacer`. La plataforma vuelve a `http://IP:8080`; sigue pidiendo la clave y los datos no se tocan.
