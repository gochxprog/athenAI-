# Integración de los motores de Urus en athenAI

Fecha: 20-oct-2026 · Origen: `URUS_integrado_20261018_v4.zip` (la plataforma Urus no se modificó).

## 1. Qué se trajo y cómo

Los motores de Urus se copiaron **sin cambiar su lógica** a `src/motores/urus/` junto con sus pruebas:

| Carpeta | Motores |
|---|---|
| `order-flow/` | Footprint, POC, fórmulas (imbalance diagonal, MicroPrice, OBI, índice de absorción), microestructura (imbalances, stacked, delta-POC), **AbsorptionEngine**, **ExhaustionEngine**, **SessionCVD**, **OrderBookEngine** (DOM), escaneo de liquidez, **IcebergTracker**, **StopRunSeries** |
| `open-interest/` | Motor de OI (z robusto, cuadrantes, flush, acumulación silenciosa, divergencias) |
| `big-trades/` | **BigTradeDetector** (bloques por τ, z-score y nocional mínimo) |
| `lhm/` | Historial de liquidez y **LiquidityPoolEngine** (pools de liquidez + huellas barridas) |
| `realtime/` | Protocolo SSE y backoff del servidor de Urus |

Resultado: **252 pruebas originales de Urus pasan dentro de athenAI**. A ellas se suman 14 pruebas nuevas del núcleo de athenAI.

Los únicos cambios en código de Urus están marcados con comentarios `athenAI:` y no alteran ningún resultado de las pruebas originales.

## 2. Por qué Urus se traba con las horas

| Hallazgo | Dónde | Efecto con el tiempo | Solución en athenAI |
|---|---|---|---|
| Escritura síncrona en SQLite (`node:sqlite` `DatabaseSync`) desde el mismo hilo que recibe Binance; borrados periódicos con escaneo completo | `server/order-flow/sqlite.ts`, `order-book/heat-store.ts`, `big-trades/store.ts` | Cada inserción/purga bloquea el event loop: el servidor entero se congela por momentos y acumula retraso | No aplica al frontend. **Recomendación para el servidor:** ingestión en `worker_threads`, escrituras por lotes en transacción, purgas por partición diaria (o un almacén de series temporales) |
| Tabla con el ID de cada trade (`order_flow_trade_ids`) | `server/order-flow/sqlite.ts` | Crece con cada trade; índices y WAL cada vez más pesados | Igual que arriba |
| Historial del heatmap de 21.600 columnas × hasta 4.000 niveles | `client/.../liquidity-history.ts` | Hasta ≈ 345 MB por símbolo en el navegador | Capacidad 1.800 columnas (30 min) y vista del libro acotada a 200 niveles por lado |
| Reconstrucción completa de pools cada 5 min (modo automático) | `liquidity-pools.ts` | Congelamiento periódico (reprocesa hasta 12.000 columnas) y pools que cambian hacia atrás | Solo se recalcula el umbral en el sitio; nunca se reprocesa el pasado |
| Rachas de persistencia de pools nunca se borran fuera de rango | `liquidity-pools.ts` | El `Map` crece sin límite al moverse el precio | Se purgan las rachas fuera de cobertura |
| `array.shift()` de 10.000 IDs por cada trade | `session-cvd.ts` | Coste O(n) por trade | Anillo de tamaño fijo, O(1) |
| Footprint en vivo reconstruye Map y array de velas en cada lote | `footprint.ts` (`applyAggTradesToFootprint`) | Mucha basura de memoria → pausas del recolector | Constructor **incremental** de barras con los mismos resultados (prueba de equivalencia exacta) |
| OI recalculado sobre toda la historia en cada actualización | `open-interest/engine.ts` | Coste cuadrático con la historia | Se evalúa sobre una ventana fija de 120 barras |

## 3. Para que el ML no aprenda del futuro

- **Agotamiento:** el `ExhaustionEngine` de Urus usa la **vela siguiente** para confirmar. athenAI evalúa el agotamiento de la barra *N* solo cuando cierra la *N+1*, y lo escribe en la fila de la *N+1*.
- **Cada evento lleva `disponibleEn`:** es el instante del flujo en que el motor pudo afirmarlo. Una fila de Features solo usa eventos con `disponibleEn ≤ cierre de la barra`.
- **El reloj es siempre el del flujo de datos, nunca `Date.now()`:** la misma cinta produce los mismos eventos en vivo, en DEMO y en un backtest.
- **Prueba automática:** las filas pasadas son **idénticas** aunque lleguen datos posteriores (`pipeline.test.ts`).

## 4. Arquitectura en athenAI

```
Fuente (DEMO | servidor Urus por SSE)  ──►  Web Worker del motor
                                              ├─ MotorMercado: DOM, LHM, icebergs, stop runs, big trades, CVD, OI
                                              ├─ Serie canónica: dollar bars de 10 M USD ──► Features (34) ──► CSV
                                              └─ Serie del gráfico: 1m · 5m · 15m · Dollar · Volume
                                                   (se reconstruye desde la cinta; no toca las Features)
UI (hilo principal) ◄── estado compacto a 5 Hz ── dibuja en canvas (velas / Footprint / CVD / OI / LHM / DOM)
```

- El motor corre en un **Web Worker**: la interfaz no se traba aunque se procesen miles de trades.
- **Todo está acotado:**
  - cinta tipada de 500.000 trades;
  - anillos de barras, eventos y Features;
  - LHM de 1.800 columnas.
- El motor es **único para toda la app**: sigue generando Features aunque se cambie de módulo.

## 5. Prueba de resistencia (8 h de mercado simulado)

`npm run soak` · `scripts/soak.ts`

| Hora | ms de cálculo por minuto de mercado | Memoria (MB, tras GC) |
|---|---|---|
| 1 | 78 | 51 |
| 2 | 90 | 48 |
| 3 | 106 | 57 |
| 4 | 99 | 51 |
| 5 | 100 | 61 |
| 6 | 105 | 54 |
| 7 | 96 | 64 |
| 8 | 92 | 56 |

La memoria y el tiempo se estabilizan cuando la cinta se llena (hora 3) y **no crecen después**. ≈ 100 ms por minuto de mercado equivale a ≈ 0,17 % de un núcleo.

## 6. Centro de datos (módulo Datos)

La fuente ya no se elige en el gráfico: se configura en **Datos → Centro de datos**. Hay **una fuente activa a la vez**:

| Fuente | Qué necesita | Notas |
|---|---|---|
| **Binance Futures** (por defecto) | Nada: datos públicos | aggTrades + libro L2 sincronizado (snapshot + diffs encadenados por `pu`) + Open Interest cada 5 s |
| **Rithmic** | Usuario, contraseña, sistema, gateway y la URL de un **puente R\|Protocol** | Rithmic no acepta conexiones desde un navegador. athenAI hace `POST {puente}/api/rithmic/login` y luego lee el mercado con el protocolo de Urus. Sin puente, el feed muestra el error |
| **Servidor Urus** | URL del servidor | `GET /api/realtime/stream`, `POST /api/realtime/subscriptions`, `GET /api/oi` (CORS para el origen de athenAI) |
| **Simulación** | Nada | Solo pruebas; nunca se mezcla con datos reales |

Al pulsar **Aplicar y empezar a aprender**:

1. se detiene la fuente anterior y se descarta todo su estado (**pipeline limpio**);
2. se crea **un pipeline por activo** (hasta 6);
3. cada pipeline se **calibra a su activo**:
   - tick del exchange (o tabla de futuros CME / menor salto observado si la fuente no lo publica);
   - paso del Footprint proporcional al precio;
   - dollar bar ≈ volumen de 24 h / 2.000, entre 100 mil y 10 M USD;
   - volume bar equivalente en unidades del activo.

La configuración se guarda en el navegador. La contraseña de Rithmic **no** se guarda salvo que se marque «Recordar la contraseña».

### Dónde quedan los datos

Cada fuente tiene su propia base IndexedDB (su "carpeta"): `athenai-binance`, `athenai-rithmic`, `athenai-urus`, `athenai-simulacion`.

- Cada fila lleva `simbolo` y `sesion`. La sesión cambia al reaplicar o reconectar, porque la numeración de barras se reinicia.
- Cada carpeta se exporta a CSV por activo o se borra sin tocar las demás.

### Probar sin internet

`npm run binance-simulado` levanta un Binance USD-M local (REST + WebSocket con el formato real). En **Endpoints (avanzado)** pon `http://localhost:8899` y `ws://localhost:8899`.
