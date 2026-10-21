# Inventario de athenAI (QUANT-AGENTIC)

Todo lo que tiene la plataforma hoy, pantalla por pantalla y motor por motor.

**Estado:**
- ✅ real y verificado: tiene motor, fórmulas y pruebas;
- 🟢 real: funciona con datos reales, falta pasarlo por el proceso de verificación;
- ⏸ sin motor todavía: la pantalla lo dice y no muestra datos de ejemplo;
- ⬜ por hacer.

---

## 1. Pantallas

| Sección | Pantalla | Qué hace | Estado |
|---|---|---|---|
| Panel General | **Panel General** | Cerebro 3D que reacciona a los eventos reales. 8 carteles: pulso del flujo, señales en vivo, Features fuera de lo normal, contexto, lectura del momento, día gemelo, tus estrategias ahora y alertas. Mercados de un vistazo y registro del día | 🟢 |
| Panel General | **Order Flow** | Gráfico de velas, Footprint, heatmap de liquidez (tipo Bookmap), DOM, eventos, memoria del mercado y tabla de Features con exportación a CSV | 🟢 |
| Cerebro | **Laboratorio** | Editor de estrategias en Python, plantillas, el Juez completo (10 motores), papers y el Etiquetador | ✅ |
| Cerebro | **Investigación** | Red de hipótesis (aplazada a propósito) | ⏸ |
| Cerebro | **Estrategias** | Tus estrategias con el veredicto, la nota y la curva de su última prueba del Juez | 🟢 |
| Cerebro | **Conocimiento** | Patrones encontrados (llega con el bloque de machine learning) | ⏸ |
| Cerebro | **Agentes** | Sala 3D con los 10 agentes. Vigía, Flujo, Rastreador, Programador y Juez trabajan de verdad | 🟢 (5 de 10) |
| Dinero | **Paper Trading** | Bots en Paper con el Guardián (siguiente motor) | ⏸ |
| Dinero | **Decisiones** | Bitácora real: pruebas del Juez, avisos y registro del motor | 🟢 |
| Sistema | **Máquinas** | Telemetría real del navegador (memoria, núcleos, workers) | 🟢 |
| Sistema | **Datos (Centro de datos)** | Fuentes y activos, grabación, almacenamiento, calendario de eventos fuertes, notificaciones y diagnóstico de Binance | 🟢 |

Barra superior: reloj, estado de la conexión, «no operar» (eventos fuertes) y «hoy es distinto». 🟢
Barra lateral: números y estados reales. 🟢

---

## 2. Datos (de dónde sale todo)

| Elemento | Qué hace | Estado |
|---|---|---|
| Fuente **Binance USD-M Futures** | Trades, libro de órdenes, Open Interest, liquidaciones y funding. Gratis, sin clave. Rutas /public y /market (abril de 2026); se reconecta sola y sigue funcionando aunque falle el REST | 🟢 |
| Fuente **Rithmic** (puente) | Futuros CME (NQ, ES, GC…) a través de un puente | 🟢 código listo, pendiente de cuenta |
| Fuente **Urus** (servidor) | Datos desde un servidor propio | 🟢 |
| **Vigía** | Marca los cortes de conexión como «hueco»: no se aprende de datos rotos | 🟢 |
| **Barras** | Dollar bars (canónicas), 1m / 5m / 15m y por volumen | 🟢 |
| **Almacén** | Una «carpeta» por fuente (IndexedDB del navegador), con exportación a CSV y borrado | 🟢 |
| **Calendario** | FOMC 2026 precargado; añades CPI, nóminas… Marca la ventana de «no operar» | 🟢 |

---

## 3. Motores de Order Flow (de Urus)

| Motor | Qué detecta | Estado |
|---|---|---|
| Footprint y Microestructura | Volumen por precio, imbalances, stacked imbalances, POC, delta-POC | 🟢 |
| Absorción | Grandes órdenes que frenan a los agresivos (score 0–100) | 🟢 |
| Agotamiento | Fin de un empuje comprador o vendedor | 🟢 |
| Big trades | Bloques grandes | 🟢 |
| Icebergs | Órdenes ocultas que se recargan | 🟢 |
| Stop runs | Barridos de máximos y mínimos | 🟢 |
| Open Interest | ΔOI, cuadrante precio/OI, flush | 🟢 |
| Libro (DOM) | OBI, MicroPrice | 🟢 |
| Liquidez (LHM) | Pools de liquidez, barridos, heatmap | 🟢 |
| CVD de sesión | Delta acumulado por sesión | 🟢 |
| Liquidaciones | Largos y cortos liquidados (Binance) | 🟢 |
| Funding | Tasa que pagan o cobran los perpetuos cada 8 h | 🟢 |

---

## 4. Features (los 40 datos por barra que aprende la plataforma)

Se calculan al cierre de cada dollar bar solo con información pasada (sin mirar el futuro).

| Grupo | Features |
|---|---|
| Precio | Retorno, Rango / ATR, Distancia al VWAP |
| Flujo | Delta, Delta / volumen, Trades relativos, Duración, CVD de sesión, Pendiente del CVD |
| Footprint | Imbalances compradores y vendedores, Stacked compradores y vendedores, Posición del POC, Posición del delta-POC |
| Absorción / Agotamiento | Absorción en el ask y en el bid; Agotamiento alcista y bajista (barra previa) |
| Big trades | Big trades compradores y vendedores (USD) |
| Icebergs / Stop runs | Icebergs en el bid y en el ask; Stop run de máximos y de mínimos |
| Open Interest | Liquidaciones de largos y de cortos, Funding, ΔOI %, ΔOI z robusto, Cuadrante precio/OI, Flush de OI |
| Libro (DOM) | OBI (10 niveles), MicroPrice − mid |
| Liquidez (LHM) | Pool ask y pool bid más cercanos, Pools barridos |
| Contexto | Ventana de evento fuerte |
| Calidad de datos | Hueco de datos |

---

## 5. Memoria del mercado (no predice: recuerda)

| Motor | Qué hace | Estado |
|---|---|---|
| Régimen (HMM) | Rango / tendencia / día raro, aprendido de tus datos | 🟢 |
| Día gemelo | Los momentos del pasado más parecidos a hoy y qué pasó después | 🟢 |
| «Hoy es distinto» | Aviso si la data actual no se parece a nada grabado | 🟢 |
| Cruce entre mercados | Correlación BTC frente a XAU, etc. | 🟢 |
| Lectura del momento | Frase por reglas sobre quién manda en el mercado | 🟢 |
| Features fuera de lo normal | z y percentil de la última barra | 🟢 |

---

## 6. El Juez (Laboratorio): los 10 motores ✅

Todos verificados con tus especificaciones, con pruebas de valores calculados a mano. Cada uno se ve en el
Laboratorio con «Explicación simple» y «Cómo se calcula».

| # | Motor | Pregunta que responde | Para pasar |
|---|---|---|---|
| 1 | Backtest | ¿Cuánto habría ganado o perdido? (comisiones, deslizamiento y funding incluidos) | — |
| 2 | Métricas | ¿Ganó de forma estable? (Sharpe, Sortino, CAGR, Calmar, drawdown, rachas…) | — |
| 3 | Walk-Forward | ¿Sigue ganando con datos que no vio? | WFE ≥ 0,5 |
| 4 | Monte Carlo | Si las pérdidas llegan seguidas, ¿cuánto puedo perder? | Ruina ≤ 5 % |
| 5 | Luck test | ¿Habilidad o suerte? | p < 0,05 |
| 6 | Robustez | ¿Aguanta costos ×2, cambios de parámetros, otro mercado y regímenes? | Menos de 2 fallos |
| 7 | Deflated Sharpe | ¿Gané solo por probar muchas versiones? | DSR ≥ 0,95 |
| 8 | PBO | ¿Elegir «la mejor» fue una lotería? | PBO < 5 % |
| 9 | Anti-futuro | ¿El código hace trampa mirando el futuro? | Sin fugas |
| 10 | Veredicto | Puertas de cero tolerancia + nota de 0 a 100 | ≥ 75: lista para Paper |

**Laboratorio, además:**
- Python en el navegador (Pyodide, funciona sin internet);
- 3 plantillas de estrategia;
- costos automáticos de Binance;
- opciones «Avanzado» (Walk-Forward, Monte Carlo, Luck test);
- señal en vivo de tus estrategias juzgadas.

---

## 7. Salida y avisos

| Elemento | Qué hace | Estado |
|---|---|---|
| Notificaciones | Discord, Telegram y ntfy. Avisa de mercado caído y recuperado, «hoy es distinto», eventos fuertes, cambio de régimen y decisiones del Juez. Anti-spam; no avisa con la pestaña en pausa | 🟢 |
| Papers | Un informe por cada prueba del Juez. Se ve, se descarga, se imprime en PDF y se envía por Discord / Telegram / ntfy (se guardan los últimos 50) | 🟢 |

---

## 8. Agentes (equipo de 10)

| Capa | Agente | Qué hace | Estado |
|---|---|---|---|
| 1 · Detectores | Vigía | Conexiones, latencia, huecos | 🟢 |
| | Flujo | Lee el Order Flow | 🟢 |
| | Rastreador | Régimen y memoria del mercado | 🟢 |
| 2 · Decisión | Programador | Corre tus estrategias en Python | 🟢 |
| | Juez | Los 10 motores | ✅ |
| | Etiquetador | Marca en el pasado qué pasó después | ⬜ |
| | Lector | Entrena los modelos de machine learning | ⬜ |
| | Sintetizador | Informes y resúmenes | ⬜ |
| 3 · Ejecución | Guardián | Riesgo de los bots, apagado de emergencia | ⬜ |
| | Ejecutor | Envía las órdenes | ⬜ |

---

## 9. Lo que falta (en orden)

1. **La plataforma busca estrategias sola:**
   - Etiquetador;
   - Patrones;
   - Selección de Features;
   - machine learning (LightGBM);
   - generador de hipótesis.
   
   Todo lo que encuentren pasa por el mismo Juez.
2. **Pantallas que aún no tienen motor** (dicen «sin motor» y no muestran datos de ejemplo):
   - Paper Trading (bots + Guardián): es el siguiente;
   - Conocimiento;
   - Investigación, con la Red de hipótesis (aplazada a propósito).
3. **VPS 24/7:** grabar y avisar aunque el computador esté apagado.
4. **Datos de calidad** (Databento o Rithmic) con descarga de históricos.

---

## 10. Reglas de trabajo
1. Un cálculo existe una sola vez.
2. Una sola entrada al Juez.
3. Nada manual: los costos y el funding salen de los datos.
4. Solo Binance por ahora.

Cada motor sigue el mismo proceso:
1. qué mide;
2. su matemática;
3. pruebas;
4. conectado a su pantalla;
5. tu visto bueno.

Detalle de cada motor: `docs/MOTORES.md`. Historia y bloques: `docs/HOJA_DE_RUTA.md`.
