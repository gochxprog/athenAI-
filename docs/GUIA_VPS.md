# Guía: poner a grabar la grabadora nueva en tu VPS

Objetivo: que tu VPS grabe **BTCUSDT y XAUUSDT** de Binance 24/7 y corra los bots de Paper. Se hace una sola vez y tarda unos 10 minutos.

Necesitas:
- el archivo `athenai-grabadora.zip` (el último que te mandé);
- la IP de tu VPS;
- poder entrar por SSH.

---

## Paso 1 · Subir el zip al VPS
Desde tu computador. En Windows se usa **PowerShell**, en la carpeta donde está el zip:

```
scp athenai-grabadora.zip root@IP-DE-TU-VPS:/root/
```

(Cambia `IP-DE-TU-VPS` por tu IP. Te pide la contraseña del VPS.)

## Paso 2 · Instalar (o actualizar)
Entra al VPS:

```
ssh root@IP-DE-TU-VPS
```

Y copia estas 4 líneas:

```
cd /root
apt-get install -y unzip
unzip -o athenai-grabadora.zip -d athenai-grabadora
sudo bash athenai-grabadora/instalar.sh BTCUSDT,XAUUSDT
```

Al terminar verás algo así:

```
== LISTO: la grabadora está funcionando.
   Dirección:  http://TU-IP:8080
   Clave:      xxxxxxxxxxxx
```

**Anota la clave.** Si ya tenías la grabadora instalada, tus datos grabados se conservan.

## Paso 3 · Comprobar que graba
En el mismo VPS:

```
journalctl -u athenai-grabadora -f
```

Debes ver líneas como `BTCUSDT: en-vivo` y `XAUUSDT: en-vivo`, y cada 10 minutos un resumen con las filas grabadas. Para salir de esa vista, aprieta `Ctrl + C`: la grabadora sigue funcionando.

## Paso 4 · Abrir la plataforma
En el navegador (PC o celular): `http://TU-IP:8080`. Escribe la clave y entra.
- **Datos → Grabadora 24/7:** debe decir «conectada» y mostrar lo grabado.
- **Terminal:** arriba debe decir **«Bots en tu VPS · 24/7»**.

## Paso 5 (opcional) · Nombre con DuckDNS y candado
Si quieres entrar con un nombre en vez de la IP:
1. En duckdns.org entra con Google, crea tu nombre y copia el **token**.
2. En el VPS:
   ```
   sudo bash athenai-grabadora/asegurar.sh TU-NOMBRE TU-TOKEN
   ```
3. Abre `https://TU-NOMBRE.duckdns.org` y entra con la misma clave.

Para volver a como estaba: `sudo bash athenai-grabadora/asegurar.sh --deshacer`

---

## Si algo falla
| Lo que ves | Qué hacer |
|---|---|
| «este VPS no llega a Binance» | Binance bloquea los VPS de Estados Unidos. Usa un VPS en Europa o Asia |
| La página `http://TU-IP:8080` no abre | Ejecuta `sudo ufw allow 8080/tcp`. Si tu proveedor tiene cortafuegos en su panel web, abre ahí también el puerto 8080 (TCP) |
| No recuerdas la clave | `sudo cat /var/lib/athenai-grabadora/clave.txt` |
| Quieres ver qué pasó | `journalctl -u athenai-grabadora -n 100` |
| Reiniciarla | `sudo systemctl restart athenai-grabadora` |

## Lo que sigue
Dejarla grabar. Cada semana, prueba 2 o 3 estrategias en el **Laboratorio** con lo grabado. Mientras más días grabe, más serio es lo que te dice el Juez.
