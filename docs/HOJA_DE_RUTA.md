# Hoja de ruta de athenAI

Notas de trabajo del proyecto: qué hay, qué falta, en qué orden y por qué.
Marca de progreso: ✅ hecho · 🔶 en curso · ⬜ pendiente.

---

## 1. Estado real hoy

**Funciona de verdad**

- ✅ **Centro de datos** (módulo Datos):
  - fuentes: Binance Futures (por defecto, sin API key), Rithmic (por puente), servidor Urus y Simulación;
  - hasta 6 activos a la vez;
  - al aplicar una configuración, el pipeline se limpia y empieza de cero.
- ✅ **Motores de Urus** en vivo por activo:
  - CVD, absorción, agotamiento e imbalances;
  - big trades, icebergs y stop runs;
  - pools de liquidez (LHM), Open Interest y DOM.
- ✅ **Features para el ML**:
  - 38 datos por cada dollar bar, sin mirar al futuro;
  - se guardan en una "carpeta" por fuente: `athenai-binance`, `athenai-rithmic`, `athenai-urus` y `athenai-simulacion`;
  - se exportan a CSV.
- ✅ **Gráfico de Order Flow**: velas o Footprint, 1m/5m/15m/Dollar/Volume, CVD, OI, LHM y DOM.
- ✅ **Bloque B completo**: régimen, "hoy es distinto", día gemelo, cruce entre mercados, heatmap y calendario.
- ✅ **Bloque A completo**: toda la plataforma lee del mismo chorro, panel de mercados, liquidaciones, huecos, fuentes mezcladas, Vigía y Flujo con motor real.

**Todavía es DEMO (pantallas sin motor detrás)**

- Bots, Juez, Walk-Forward, Monte Carlo, Luck test y modelos (LightGBM, red neuronal). Los contadores de hipótesis/épocas del Panel General y del Laboratorio siguen siendo DEMO hasta los bloques C y D.
- De los agentes 3D, Vigía, Flujo y Rastreador tienen motor; los otros 7 dicen «Sin motor · Bloque X».

**Regla:** ningún agente aparece "trabajando" si no tiene un motor real detrás. Mientras su motor no exista, se muestra como «Sin motor · próximamente».

---

## 2. Agentes y bots no son lo mismo

| | Agentes | Bots |
|---|---|---|
| Qué son | El equipo que investiga, entrena, prueba y vigila | Las estrategias que operan |
| ¿Operan dinero? | **Nunca** | **Sí** (primero en Paper) |
| Dónde se ven | Módulo Agentes (3D) | Paper Trading |
| Cuántos | Un equipo fijo | Uno por estrategia aprobada y por mercado |

Ejemplo: una escudería de Fórmula 1. Los agentes son ingenieros, mecánicos y comisario; los bots son los coches.

**Cómo nace un bot**

1. Tú escribes una estrategia, o los agentes la descubren en los datos.
2. El **Juez** la prueba.
3. Si la aprueba, se convierte en bot (por ejemplo, "Absorción-Bid en BTCUSDT").
4. El bot opera en Paper y el **Guardián** lo vigila.

---

## 3. Equipo de agentes (3 capas, cada uno con su motor)

| Capa | Agente | Qué hace | Motor | Bloque |
|---|---|---|---|---|
| 1 · Detectores | **Vigía** | Vigila conexiones, latencia y huecos en los datos | Centro de datos / feeds | A |
| | **Flujo** | Lee el Order Flow: imbalances, stacking/pulling, absorción, agotamiento, CVD, liquidaciones | Motores de Urus | A |
| | **Rastreador** | Régimen del mercado y memoria (día gemelo, "hoy es distinto") | Memoria del mercado (HMM + similitud) | B ✅ |
| 2 · Contexto y decisión | **Programador** | Corre las estrategias que escribes en Python | Editor + Pyodide | C |
| | **Juez** | Prueba todo y da el veredicto | Motor de validación | C |
| | **Etiquetador** | Marca en el pasado "qué pasó después" | Triple barrera | D |
| | **Lector** | Entrena los modelos y separa Features útiles del ruido | LightGBM / red neuronal | D |
| | **Sintetizador** | Resume lo aprendido; informe semanal | Informes | E |
| 3 · Ejecución y gestión | **Guardián** | Riesgo de los bots: límites, correlación, apagado de emergencia | Supervisor de riesgo | E |
| | **Ejecutor** | Envía órdenes limit (pasivas) | Ejecución | E |

**Recorrido:**

1. **Vigía** cuida los datos.
2. **Flujo** calcula las Features.
3. **Etiquetador** anota qué pasó después.
4. **Rastreador** y **Lector** aprenden; **Programador** corre tus estrategias.
5. **Juez** decide qué sirve.
6. **Guardián** vigila a los bots.
7. **Sintetizador** te lo explica.

No hay un agente por cada detector, porque un solo motor ya calcula todos a la vez.

---

## 4. Bloques de trabajo (en orden)

### Bloque A — Todo conectado y los mercados de un vistazo ✅

- ✅ **Un solo "chorro" de datos.** Toda la plataforma lee de la fuente elegida en el Centro de datos:
  - Panel General, Paper, Agentes, Laboratorio, barra lateral y barra superior;
  - al cerrar una fuente se limpia todo; al abrir otra, todo vuelve a fluir hacia su carpeta.
- ✅ **Binance arreglado y resistente.** Desde el 23-abr-2026 Binance separó sus WebSockets de futuros: el libro va por `/public` y los trades y liquidaciones por `/market`. La ruta antigua `/stream` solo entrega el libro: por eso "conectaba" pero los gráficos no se llenaban. Ahora se usan las dos rutas nuevas, se vuelve sola a la antigua si un servidor propio no las tiene, y avisa si llega el libro pero no los trades. Botón «Probar conexión» con diagnóstico (REST, libro y trades por separado).
- ✅ **Panel Multi-Asset Overview** (Panel General y Order Flow). Una tarjeta por mercado con:
  - estado y precio;
  - CVD y ΔOI;
  - absorción, agotamiento e imbalances;
  - big trades, pools cercanos y filas;
  - régimen y veredicto del Juez.
  
  Al tocar una tarjeta, el gráfico muestra ese mercado. Régimen y veredicto dicen «Sin motor» hasta los bloques B y C.
- ✅ **Widgets:** CVD Velocity, Delta Ratio, Absorption Spike (dentro de cada tarjeta).
- ✅ **Liquidaciones** de Binance (stream `forceOrder`): evento y Features `liq_largos_usd` / `liq_cortos_usd`.
- ✅ **Huecos marcados** (Feature `hueco`). Las filas de datos tras un corte quedan marcadas para no aprender de datos rotos.
- ✅ **Fuentes mezcladas por activo:** BTC/ETH de Binance + NQ/XAU de Rithmic a la vez. Cada fuente guarda en su carpeta.
- ✅ **Todo el equipo de agentes en el 3D** (10 agentes en 3 filas, una por capa). Vigía y Flujo trabajando de verdad; el resto «Sin motor · se activa en el Bloque X».

### Bloque B — Memoria del mercado (no predice: recuerda) ✅

Dónde verlo: **Order Flow → pestaña «Memoria del mercado»**, las tarjetas de cada mercado y la barra superior.

- ✅ **Detector de régimen** (agente Rastreador): modelo HMM de 3 estados (rango / tendencia / día raro).
  - Entradas por dollar bar: eficiencia de 10 barras, rango/ATR, duración y |delta/volumen|.
  - Aprende **solo de tu data grabada** (la carpeta de la fuente). Necesita **600 barras**.
  - En vivo usa solo el pasado (filtro forward, sin mirar al futuro).
  - **Validación fuera de muestra**: entrena con el 70 % más antiguo y prueba en el 30 % siguiente. Dice si "tendencia" anticipa más dirección que "rango" y si "raro" anticipa más volatilidad. Si no, lo dice: «no concluyente».
  - Se recalcula cada 2 minutos (o con «Recalcular ahora»).
- ✅ **Aviso "hoy es distinto"**: compara la ventana de las últimas 20 barras con todo lo grabado. Si está más lejos que el 98 % de lo normal, salta el aviso (tarjeta y barra superior) y dice qué es lo raro (volatilidad, liquidaciones, big trades…). Necesita **320 barras**.
- ✅ **Día gemelo**: los 8 momentos más parecidos a ahora y qué pasó en las 20 barras siguientes (retorno, máxima subida y bajada). Es memoria, no predicción.
- ✅ **BTC vs XAU (cruce entre mercados)**: correlación de los retornos de 5 min en las últimas 24 h para cada par de mercados y si coinciden en régimen. XAUUSDT y PAXGUSDT (Binance) y GC/MGC (Rithmic) están entre los sugeridos.
  - ⬜ La prueba "un patrón que aparece en los dos mercados" la hará el Juez (Bloque C).
- ✅ **Heatmap de liquidez** tipo Bookmap: botón «Heatmap» en el gráfico. Últimos 30 min del libro; solo brillan los muros (lo normal queda oscuro).
- ✅ **Calendario de eventos fuertes** (Centro de datos): FOMC 2026 precargado, se añaden CPI, nóminas, etc. Ventana de no operar en la barra superior y Feature `ventana_evento`.

### Bloque C — Tus estrategias y el Juez real ⬜

- ⬜ **Editor de estrategias en Python** (Pyodide, dentro del navegador) que lee las Features guardadas.
- ⬜ **Batería de pruebas del Juez:**
  - **Backtest con costos y slippage** reales;
  - **Walk-Forward purgado con embargo**: entrenar en un tramo, probar en el siguiente que el modelo nunca vio, sin solaparse;
  - **Monte Carlo** de la secuencia de operaciones: el peor escenario razonable;
  - **Luck test**: contra miles de estrategias al azar;
  - **Robustez**: variar parámetros ±, otros periodos y otro mercado (XAU);
  - **Número mínimo de operaciones**;
  - **Deflated Sharpe y PBO**: descuentan la suerte de haber probado muchas ideas.
- ⬜ **Métricas que entrega:** ganancia, drawdown máximo, Sharpe, % de aciertos, factor de beneficio, nº de operaciones y veredicto (Aprobada / Rechazada y por qué).
- ⬜ **Aviso** cuando los datos no alcanzan para que la prueba signifique algo.
- ⬜ Opcional: describir la estrategia en español y que una IA (Claude) escriba el código en Python. Necesita una API key de Anthropic, con costo por uso.

### Bloque D — Los motores de inteligencia artificial ⬜

- ⬜ **Etiquetador (triple barrera):** toma de ganancia, stop y tiempo máximo, con el ATR del momento.
- ⬜ **Selección de Features contra el ruido:** quitar las correlacionadas e importancia por permutación con validación purgada (probablemente queden 8–15 de 34).
- ⬜ **Machine learning:** LightGBM, uno por mercado. Se entrena en Python (VPS) y la predicción corre en el motor.
- ⬜ **Deep learning:** red neuronal sobre secuencias de barras / footprint. Solo se usa si supera a LightGBM en el Juez.
- ⬜ Cada modelo pasa por el Juez antes de convertirse en bot.

### Bloque E — Bots en Paper y supervisión ⬜

- ⬜ **Bots** por estrategia y mercado, en Paper.
- ⬜ **Guardián:** límites de pérdida, correlación entre mercados (BTC y ETH no son 2 apuestas independientes), apagado de emergencia, pausa si el bot se desvía de lo que esperaba el Juez.
- ⬜ **Bitácora:** "foto" del mercado (footprint, CVD) de cada operación.
- ⬜ **Informe semanal automático:** régimen, patrones repetidos, horas con más acción.
- ⬜ **Ejecutor** con órdenes limit (pasivas) para reducir el slippage.

### Bloque F — VPS 24/7 ⬜

- ⬜ Los mismos motores en Node (sin reescribirlos), grabando 24/7 aunque apagues tu PC.
- ⬜ Datos en **DuckDB + Parquet**.
- ⬜ Puente Rithmic (R|Protocol).
- ⬜ Python para investigar y entrenar.
- ⬜ Redis o colas de mensajes solo si hay varios procesos.

---

## 5. Ideas descartadas o cambiadas (y por qué)

- **Agente que ajusta parámetros solo después de perder** → ❌. Es la receta del sobreajuste. Se guarda la bitácora, pero cualquier ajuste vuelve a pasar por el Juez.
- **Failover a otra fuente si la latencia pasa de 100 ms** → cambiado. 100 ms es irreal para internet hacia Binance (lo normal es 50–300 ms), y cambiar de fuente mezcla datos. Se reconecta y se marcan los huecos.
- **"80 % de acuerdo entre bots" para entrar** → solo informativo. Bots correlacionados no son evidencia independiente.
- **Noticias clasificadas por IA** → más adelante. Aporta poco al Order Flow para su costo; antes, el calendario de eventos.
- **Reescribir los motores en Python** → no. Ya funcionan y están probados en TypeScript, y corren igual en el VPS con Node.

---

## 6. Datos mínimos

| Para… | Hace falta |
|---|---|
| Una dollar bar | ≈ volumen de 24 h / 2.000 (≈ 2.000 barras al día por activo) |
| Detector de régimen, día gemelo | 1–2 semanas grabadas |
| Juez con resultados fiables | Semanas, con un mínimo de operaciones |
| Machine learning serio | 4–8 semanas |
| Grabar sin cortes | VPS (el navegador solo graba con la pestaña abierta) |

---

## 7. Lecturas

- Marcos López de Prado — *Advances in Financial Machine Learning* (dollar bars, triple barrera, validación purgada, Deflated Sharpe).
- Stefan Jansen — *Machine Learning for Algorithmic Trading* (práctico, en Python).
- Larry Harris — *Trading and Exchanges* (cómo funciona el mercado por dentro).
- Álvaro Cartea — *Algorithmic and High-Frequency Trading* (microestructura y ejecución).

---

## 8. Diccionario

**Los datos**

- **Dollar bar:** vela que se cierra cada vez que se negocia una cantidad fija de dinero, no cada minuto.
- **Features:** los datos que mira el bot en cada barra (como la ficha de un paciente).
- **CVD:** compras agresivas menos ventas agresivas, acumulado. Dice quién empuja.
- **Absorción:** venden (o compran) fuerte y el precio no se mueve, porque alguien grande se lo come todo.
- **Agotamiento:** el empuje se queda sin gasolina.
- **Imbalance:** en un nivel hay muchas más compras que ventas, o al revés (por ejemplo 3 a 1).
- **Stacking / pulling:** órdenes que se acumulan o se retiran del libro.
- **Big trades:** operaciones enormes, normalmente de jugadores grandes.
- **Open Interest (OI):** contratos abiertos. Si sube, entra dinero nuevo; si baja, la gente cierra.
- **Liquidaciones:** posiciones cerradas a la fuerza por el exchange; empujan el precio.
- **Pools de liquidez:** zonas con muchas órdenes esperando; el precio suele ir a barrerlas.

**El aprendizaje y las pruebas**

- **Régimen:** el "tipo de día": rango, tendencia o raro.
- **Etiquetas / triple barrera:** lo que pasó después de cada barra; es la respuesta de la que aprende el bot.
- **Sobreajuste:** memorizar el pasado en vez de aprender. Es el enemigo número 1.
- **Walk-Forward:** entrenar con un tramo y probar con el siguiente, que el modelo nunca vio.
- **Monte Carlo:** barajar las operaciones miles de veces para ver el peor escenario razonable.
- **Luck test:** comparar contra estrategias al azar. Si el azar te gana, fue suerte.
- **Sharpe:** ganancia dividida por sobresaltos. Más alto = más estable.
- **Deflated Sharpe / PBO:** correcciones por haber probado muchas ideas.
- **Drawdown:** la peor caída desde un máximo de la cuenta.
- **Machine learning (ML):** modelos que aprenden reglas de los datos (por ejemplo LightGBM).
- **Deep learning (DL):** redes neuronales; más potentes, pero necesitan más datos y se sobreajustan más fácil.

**Dónde se opera y dónde corre**

- **Paper trading:** operar con dinero simulado sobre el mercado real.
- **VPS:** computadora en internet encendida 24/7.
