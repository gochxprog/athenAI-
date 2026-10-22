# Croquis · Agentes, machine learning y red neuronal (todo en el VPS)

> Fecha: 22-oct-2026. Mercados para empezar: **BTCUSDT y XAUUSDT de Binance** (historia importada + lo que se graba).
> Cuando la máquina encuentre edge real aquí, se abren más mercados.

## 1. La idea en una frase
Diez agentes viven en el VPS, cada uno con un trabajo real. Juntos **graban, etiquetan, aprenden, proponen y prueban**
ideas solos, las 24 horas. Nada pasa a Paper sin el Juez y sin tu OK.

## 2. Los 10 agentes y lo que hacen en el VPS

| Agente | Trabajo | Hoy | Qué falta |
|---|---|---|---|
| **Vigía** | Conexiones, cortes, huecos, avisos de fallos | Vive en el VPS | Reportar su estado al tablero de agentes |
| **Flujo** | Motores de Order Flow → 39 Features por fila | Vive en el VPS | Igual |
| **Rastreador** | Régimen (rango/tendencia/raro), día gemelo, «hoy es distinto» | Solo en el navegador | **Moverlo al VPS** (cada 15 min por mercado) |
| **Programador** | Corre tus estrategias en Python | Vive en el VPS | Igual |
| **Juez** | WF, Monte Carlo, Suerte, robustez, DSR, PBO | Vive en el VPS | Revisar contra la **bóveda** (§4) |
| **Etiquetador** | Marca qué pasó después de cada movimiento (CUSUM + triple barrera) | Solo en el navegador | **Moverlo al VPS**: etiqueta la historia cada noche |
| **Lector** | Entrena los modelos y separa Features útiles del ruido | No existe | **Nuevo** (§3) |
| **Sintetizador** | Convierte lo aprendido en hipótesis legibles + informe semanal | No existe | **Nuevo** |
| **Guardián** | Riesgo de los bots, apagado de emergencia | Vive en el VPS | Igual |
| **Ejecutor** | Ejecuta en Paper | Vive en el VPS | Igual |

**Cómo viven (el «orquestador»):** un solo coordinador dentro de la grabadora.
- Cada agente tiene **estado** (trabajando · esperando · pausado · error), su **último trabajo**, el **siguiente** y su **bitácora**.
- Los trabajos pesados (Juez, Etiquetador, Lector) van **en fila, de uno en uno**, en un proceso aparte. La grabadora nunca se frena.
- Todo queda en disco: `{datos}/agentes/` (estado + bitácora). Si el VPS se reinicia, siguen donde iban.
- API: `GET /api/agentes` (todos), `GET /api/agentes/{id}` (bitácora), `POST /api/agentes/{id}/{pausar|reanudar|correr}`.
- En el Panel, cada punto del anillo se enciende con el color del agente **solo si de verdad está trabajando** (ya hecho).

## 3. El Lector: cómo aprende la máquina (por etapas)

1. **Dataset:** cada fila = las 39 Features en ese momento (sin mirar al futuro) + su **etiqueta** (qué pasó después: tocó objetivo, stop o se acabó el tiempo). Por mercado.
2. **Etapa 1 · ML clásico (LightGBM):** ligero, corre en el CPU del VPS en minutos.
   - **Filtro:** aprende cuándo SÍ tomar las señales de una estrategia aprobada y cuándo no (meta-etiquetado).
   - **Importancia:** qué Features sirven y cuáles son ruido (permutación, con validación purgada).
3. **Etapa 2 · Buscador de edge:** el modelo mismo propone reglas («cuando absorción en el bid + stop run abajo + OI bajando → largo»). Cada idea se convierte en estrategia y va **al Juez**, que cuenta **cada intento**.
4. **Etapa 3 · Red neuronal (deep learning):** modelos de secuencia (LSTM / TCN / Transformer pequeño) con PyTorch en CPU. Se comparan contra el ML clásico: si no le ganan fuera de muestra, no se usan.
5. **Cadencia:** reentrena cada semana con los datos nuevos. **Nunca** cambia de modelo ni pasa a Paper solo.

**Python real en el VPS:** Pyodide sirve para tus estrategias, pero no para entrenar. El instalador creará un entorno de Python aparte (LightGBM, scikit-learn; PyTorch en la etapa 3). Ocupa unos 300 MB (más ~800 MB con PyTorch).

## 4. Las reglas que no se rompen
1. **La bóveda:** el último 20 % del tiempo de cada mercado se guarda aparte. **Ningún modelo lo ve** al entrenar. Una idea solo vale si también funciona ahí, y la bóveda solo se abre una vez por idea.
2. **El Juez cuenta todo:** si la máquina prueba 5.000 ideas, el Deflated Sharpe y el PBO lo saben y exigen mucho más.
3. **Validación purgada con embargo:** nunca se entrena con datos que se tocan en el tiempo con los de prueba.
4. **Anti-futuro:** las Features de una fila solo usan lo que se sabía al cerrarla (ya probado en la grabadora).
5. **Nada a Paper sin el Juez y sin tu OK.** Nada a dinero real sin pasar semanas en Paper.

## 5. Pantallas nuevas en la v2
- **Agentes:** la sala. Cada agente con su color, qué hace ahora, su último resultado, su bitácora y botones (pausar, correr ya).
- **Red neuronal:** datasets por mercado (filas, etiquetas, bóveda), modelos entrenados (resultado fuera de muestra vs. tirar una moneda), Features más útiles, ideas propuestas y lo que dijo el Juez de cada una.
- **Investigación:** las hipótesis del Sintetizador en palabras, con su evidencia, y el informe semanal.

## 6. Orden de construcción
| Fase | Qué | Resultado |
|---|---|---|
| **A1** | Orquestador + estado de los 10 agentes + pantalla **Agentes** | Ves a los agentes trabajar de verdad |
| **A2** | Rastreador y Etiquetador viviendo en el VPS | Régimen y etiquetas cada noche, con historia |
| **A3** | Dataset + bóveda + Python real + Lector (ML clásico) + pantalla **Red neuronal** | Primeros modelos y Features útiles |
| **A4** | Buscador de edge → Juez · Sintetizador + **Investigación** | La máquina propone ideas y el Juez las juzga |
| **A5** | Red neuronal (PyTorch) comparada con el ML | Solo se queda si gana |
| **A6** | Pruebas de punta a punta con BTC y oro | Si hay edge, se abren más mercados |

## 7. Lo que tienes que decidir tú
1. **La bóveda:** ¿último **20 %** del tiempo? (recomendado)
2. **Etiquetas por defecto:** objetivo 2 ATR, stop 1,5 ATR, máximo 60 velas de 5 min. (Se pueden cambiar.)
3. ~~El VPS~~ **Respondido: 4 GB de RAM.** Plan para que alcance:
   - Un solo trabajo pesado a la vez (Juez **o** entrenamiento), en fila.
   - Cada entrenamiento con tope de memoria (~1,5 GB, systemd `MemoryMax`); si se pasa, se corta y la grabadora sigue.
   - ML clásico (LightGBM) en float32: ~150 MB por millón de filas. Va bien.
   - Red neuronal: solo modelos pequeños en el VPS; las grandes, en una GPU alquilada por horas o en tu PC.
   - El instalador agrega 2 GB de swap como colchón.
