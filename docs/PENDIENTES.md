# Pendientes de athenAI

La plataforma está **congelada** desde el 22-oct-2026: nada nuevo hasta que la grabadora grabe en el VPS y se prueben estrategias con el Juez.

Las ideas nuevas se anotan aquí, no van directo al código. Se hacen **una a la vez**, cuando de verdad hagan falta, y se terminan antes de empezar la siguiente.

## Ahora (lo único activo)
1. Instalar la grabadora nueva en el VPS y grabar **BTCUSDT y XAUUSDT** de Binance 24/7 (guía: `docs/GUIA_VPS.md`).
2. Cada semana, probar 2 o 3 estrategias sencillas en el Laboratorio con lo grabado.
3. Si el Juez aprueba una: ponerle un bot en Paper (Terminal) y mirarlo en el Diario.

## En espera (en este orden, salvo que el usuario diga otra cosa)

### Enchufes (que la plataforma no dependa de ningún proveedor)
- **Fichas de mercado:** tipo, tick, valor del tick, multiplicador, contratos o lotes, costos, funding, sesiones, vencimientos y margen. Binance sería la primera ficha.
- **Contratos en el ticket:** «1R = X $ → N contratos», o contratos directos.
- **Enchufe de órdenes para el broker del usuario:** el stop y el objetivo se mandan como distancia, y el tamaño se traduce a contratos o lotes. En el Diario, el precio de la señal frente al precio del broker.
- **Enchufe de datos Rithmic (CME):** el puente ya existe en `src/motores/fuentes/rithmicPuente.ts`. Cuando el usuario compre la API.
- **Bybit:** datos, Demo Trading y comparación Paper vs Demo. El usuario decide si se hace.
- **Importador de datos históricos** (CSV o Parquet: Databento, broker…).

### Bots
- Que los bots de estrategia usen stop, objetivo y RR: la estrategia declara `GESTION` y el Juez la valida con `src/motores/juez/salidas.ts`.

### Agentes
- **Lector:** captura del gráfico marcada en cada entrada y salida; explica cada operación y cada veredicto en palabras simples.
- **Sintetizador:** manda a Telegram o Discord cada operación con su captura, el paper de cada prueba del Juez y el informe semanal.

### Pantallas con el diseño del ZIP 5 (datos reales)
- Estrategias, Decisiones y Máquinas.
- Investigación: la red de hipótesis, con las estrategias reales como puntitos.
- Conocimiento: mapa de patrones, con el aviso de «sin datos» hasta que exista el motor.

### Machine learning (cuando el usuario lo diga y haya semanas de datos)
- **ML clásico** (LightGBM, CatBoost, XGBoost): el cerebro principal del Panel General y las tarjetas en Laboratorio → Núcleo ML.
- **Deep learning** (CNN, LSTM, Transformer): su propia pantalla con la red neuronal.
- **Dónde y cómo:** se entrena en el VPS, se reentrena cada semana, el Juez valida antes de cambiar de modelo y el usuario da el OK.

### Seguridad
- Quitar la contraseña de la grabadora (lo pidió el usuario; el sistema de seguridad del entorno lo bloqueó y hace falta su permiso). DuckDNS se queda.
