# Guía de la plataforma

Las explicaciones que antes salían en las pantallas, ordenadas por pantalla. La plataforma queda limpia y aquí está el «por qué» y el «cómo» de cada cosa.

## Panel

- El Panel muestra lo que está pasando ahora, con datos reales de la grabadora del VPS. En el centro está el cerebro (machine learning) con el ojo: cada fila nueva que graba el VPS es un golpe. Alrededor, el anillo de agentes (cada punto late si el agente trabaja, está encendido si está listo y hueco si está dormido) y los hilos hacia las tarjetas (los destellos entran desde los mercados y salen hacia las métricas).
- La historia de Binance se importa en el VPS con importar.sh (ver Datos).
- «Paper hoy» es el resultado de hoy de los bots y tus operaciones en Paper: sin dinero real.
- El Juez trabaja dentro del Laboratorio: cada estrategia pasa por él antes de poder tener un bot.

## Terminal

- Terminal y Mercado son una sola pantalla: las velas del VPS (historia + lo grabado + cada tick en vivo, cada 100 ms) con las entradas y salidas de los bots y las tuyas, el ticket para operar a mano en Paper al lado, debajo lo que lee cada motor ahora mismo (un mercado al lado del otro) y tus posiciones.
- Gráfico: rueda del ratón o dos dedos = zoom; arrastrar = moverse; arrastrar el eje de precio = estirarlo. ▲ = entrada en largo, ▼ = entrada en corto, círculo = salida (verde gana, rojo pierde). Las líneas son la entrada, el stop (rojo punteado) y el objetivo (verde punteado) de cada posición abierta. Tocar una tarjeta de motor muestra sus últimos eventos.

## Terminal · ticket

- Si los costos (comisión + deslizamiento de entrar y salir) pasan de 0,3 R, la línea de costos sale en rojo: esa parte se la lleva el exchange en cada operación. Con objetivo 1:RR, si llega al objetivo ganas RR − costos en R; si toca el stop pierdes 1 + costos en R. Con un stop más lejos los costos pesan menos.
- Riesgo por operación: en % de la cuenta o en dólares (1, 0,5…). Por dentro siempre es una fracción de la cuenta; máximo 5 %.
- Stop: k × ATR de las velas que estás viendo (ATR de 14 velas de esa temporalidad) o un precio exacto.
- «Recortado»: el tamaño que pide tu riesgo no cabe en lo libre de la cuenta con ese apalancamiento; se abre lo que cabe y 1R queda menor.
- El tamaño sale del riesgo y la distancia al stop. Con apalancamiento, el stop tiene que quedar antes de la liquidación (si no, la orden no se abre). Hasta 5 posiciones a la vez por mercado, todas con la misma cuenta (las extra pasan lo ganado o pagado a la cuenta). El VPS vigila stop y objetivo a cada tick (100 ms) aunque cierres la página, y mueve el stop según la gestión: fija, BE a 1R (a break-even al ir +1R) o escalonada.

## Terminal · operaciones

- Cada operación se lee: resultado del precio − costos (comisiones y funding) = resultado neto en USD, y R de precio. Todas quedan en el Diario.

## Terminal · motores (debajo del gráfico)

- **Flujo**: Quién está agrediendo en las últimas 5 barras: compras a mercado contra ventas a mercado. Más de 15 % hacia un lado ya es dominio.
- **CVD de la sesión**: Delta acumulado de la sesión sobre el volumen: si en toda la sesión mandan los compradores o los vendedores.
- **Absorción**: Alguien grande se come las agresiones sin dejar mover el precio. En el bid = absorben ventas (soporte); en el ask = absorben compras (techo). Score 0–100.
- **Big trades**: Bloques grandes a mercado: qué parte del volumen reciente fue de órdenes gordas compradoras o vendedoras.
- **Icebergs**: Órdenes escondidas que se recargan en el mismo precio. Muchos en el bid = alguien defiende comprando; en el ask = defiende vendiendo.
- **Stop runs**: Barridos de stops: el precio pasa un máximo o mínimo, salta los stops y vuelve. Barrer mínimos suele preceder rebotes; barrer máximos, caídas.
- **Agotamiento**: El lado que empujaba se queda sin fuerza: mucho volumen y el precio ya no avanza. Agotamiento vendedor apunta arriba; comprador, abajo.
- **Open Interest**: Posiciones abiertas en futuros. Sube con el precio = largos nuevos; sube con precio bajando = cortos nuevos; baja = se cierran posiciones.
- **Liquidaciones**: Posiciones cerradas a la fuerza. Liquidan largos = ventas forzadas (presión abajo); liquidan cortos = compras forzadas (presión arriba).
- **Libro (DOM)**: Desequilibrio de las 10 primeras filas del libro: más órdenes de compra esperando (soporte) o de venta (resistencia).
- **Funding**: Lo que pagan los largos a los cortos cada 8 h. Muy positivo = muchos largos apalancados (riesgo de barrido abajo); negativo = al revés.
- **Eventos fuertes**: FOMC, CPI, NFP… En la ventana de un evento fuerte los bots no deberían abrir: el mercado se vuelve loco.

## Paper

- Los bots de Paper operan en el VPS las 24 horas, aunque cierres la plataforma, sin dinero real. Usan el mismo motor que la Terminal: llenado con deslizamiento, comisión, funding, stop y objetivo de su GESTION.
- Los bots nacen en la Biblioteca: pruebas una idea en el Laboratorio y, si el Juez la aprueba, «Mandar a Paper».

## Paper · tarjeta del bot

- «Hoy» es la caída desde el máximo de capital del día (UTC).
- «Banda del Juez»: tras k operaciones, el resultado acumulado del bot se compara con la banda P5–P95 del Monte Carlo del Juez. Se juzga desde 5 operaciones; por debajo del P5 el Guardián lo pausa.

## Paper · Guardián

- Si un bot cae más de la caída máxima del día, pierde demasiadas operaciones seguidas o se sale de lo que esperaba el Juez (por debajo del P5 de su banda de Monte Carlo), el Guardián lo para solo.
- Si hay un corte de datos con una posición abierta (también al reinstalar la grabadora), la posición se cierra al volver: nunca se mantiene a través de un hueco, igual que en el Juez.

## Riesgo

- Riesgo muestra lo que vigila el Guardián en el VPS: reglas, exposición abierta, recursos del VPS, cada cuenta frente a sus límites y cuándo actuó.
- Sin datos en vivo, nadie abre. Un bot por debajo del P5 de la banda del Juez se pausa. Exposición máxima de un bot: aprobada 1×, aprobada con reserva 0,5×. El apagado de emergencia cierra todas las posiciones y apaga todos los bots; «Rearmar» lo quita (los bots siguen apagados hasta reanudar cada uno).
- Caída máxima del día: si una cuenta cae eso desde su máximo del día (UTC), el Guardián cierra y la pausa hasta el día siguiente. Pérdidas seguidas: al llegar, cuarentena hasta que la reanudes.

## Diario

- El Diario guarda cada operación cerrada de Paper (bots y a mano), en tu hora: resultado neto, R de precio, lo máximo a favor (MFE) y en contra (MAE), duración, motivo de salida, movimientos del stop y los costos. Verde = ganancia, morado = pérdida.

## Laboratorio

- En el Laboratorio escribes una estrategia en Python y el Juez decide si tiene edge o es suerte: Walk-Forward, Monte Carlo, Luck test, robustez (costos ×2, vecinos, regímenes), Deflated Sharpe, PBO y la prueba anti-futuro. Corre en el VPS.
- Código libre: la estrategia se pega como la tengas: una función con todas las velas, una función por vela, una clase de backtesting.py o un script con pandas. El motor la reconoce y la corre sobre los datos del VPS (si el código lee un CSV o yfinance, recibe esos datos). Las señales pueden ser 1 / -1 / 0, True/False o buy · sell · exit.
- GESTION (opcional): stop en ATR, objetivo en R y manejo (fija · be1R · escalonada). El Juez la prueba con el mismo motor de salidas de la Terminal. Con listas ("rr": [2, 3]) prueba cada valor como otra variante y el bot usa la que gane. PARAMETROS (opcional): variantes para el Walk-Forward; cada variante cuenta como un intento (el Deflated Sharpe y el PBO lo descuentan). Máximo 48 variantes en total.

## Laboratorio · resultado

- El Monte Carlo necesita al menos 5 operaciones fuera de muestra.

## Biblioteca

- La Biblioteca guarda todo lo que probó el Juez (cada prueba cuenta como intento, aunque se borre). Lo aprobado puede pasar a Paper como bot, con las mismas velas y la misma GESTION con las que el Juez lo aprobó, sin dinero real.

## Agentes

- Los agentes viven en el VPS: el orquestador lee cada 5 s lo que hacen los motores (grabadora, Juez, bots, historia) y cada agente tiene su estado (trabajando, esperando, dormido, pausado), sus notas y sus trabajos programados (Rastreador cada 15 min, Etiquetador cada 24 h). La sala 3D se puede recorrer en primera persona: zoom hasta entrar o el botón; arrastrar = mirar, rueda / ▲▼ / WASD = caminar, Esc = salir.

## Datos

- Datos muestra lo que graba el VPS ahora, lo grabado en disco y la historia importada de Binance.
- Un corte = se cayó la conexión con Binance y se marcó un hueco en los datos (los bots no mantienen posición a través de un hueco; los trades perdidos se recuperan por REST si son menos de 5.000).
- Importar historia: en el VPS, en la carpeta del ZIP, `sudo bash importar.sh BTCUSDT 2026-07-01 2026-10-21`. Va de fondo; los días ya importados se saltan.
- Son datos reales de Binance. Lo grabado y lo importado van en carpetas separadas: el Juez usa la historia y luego lo grabado desde donde ella termina, sin repetir filas.

## Calendario

- Cada barra que cae entre 30 min antes y 90 min después de un evento de alto impacto lleva la Feature ventana_evento = 1: tus estrategias pueden leerla en el Laboratorio para no abrir ahí. Por ahora están cargadas las decisiones de tipos de la Fed (fechas oficiales del FOMC). Otros eventos (IPC, nóminas) se agregan solo con su fecha confirmada: un evento con fecha inventada metería ruido en las Features.

## Sistema · avisos

- Los avisos salen del VPS: llegan aunque cierres la plataforma o bloquees el teléfono. Las claves se guardan solo en el VPS (avisos.json, permisos 600) y aquí se ven tapadas.
- **Telegram**: 1) En Telegram, @BotFather → /newbot y copia el token. 2) Abre tu bot y escríbele «hola». 3) «Buscar mi chat ID».
- **Discord**: Tu canal → Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL.
- **WhatsApp (CallMeBot)**: Servicio externo gratis (los avisos pasan por él). En callmebot.com/blog/free-api-whatsapp-messages se pide la apikey por WhatsApp; aquí van tu número con +código de país y esa apikey. Solo manda texto.
- **ntfy (push)**: App ntfy en el teléfono, suscrita al mismo tema. El tema es público: usa un nombre difícil.
