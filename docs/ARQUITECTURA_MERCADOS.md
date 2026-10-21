# Arquitectura por mercado (market_id) · octubre 2026

Regla de oro: **un mercado, un juicio**. Cada mercado (BTC, XAU, …) tiene sus datos, sus etiquetas, sus veredictos,
sus bots y, en la fase de machine learning, sus modelos, siempre por separado. Un edge encontrado en un activo nunca se
prueba, se aprueba ni se usa en otro.

## 1. Identidad: `market_id`

Única definición: `src/motores/mercado/mercadoId.ts`.

| Función | Qué hace | Ejemplo |
|---|---|---|
| `mercadoId(proveedor, simbolo)` | Crea el id (y valida) | `binance:BTCUSDT` |
| `partesMercado(id)` | Lo separa | `{ proveedor: 'binance', simbolo: 'BTCUSDT' }` |
| `carpetaMercado(id)` | Nombre de su carpeta en disco | `binance_btcusdt` |
| `mercadoDeCarpeta(nombre)` | Inversa | `binance_btcusdt` → `binance:BTCUSDT` |
| `mercadoIdSeguro(p, s)` | Como `mercadoId`, pero da `null` en vez de lanzar | para feeds y datos guardados viejos |

El símbolo solo admite `A-Z0-9` (2–20): nunca puede salirse de su carpeta.

## 2. Grabación: una lógica, datos aislados

- **Una sola lógica.** La grabadora del VPS (`grabadora/`) y el navegador usan el MISMO pipeline: Vigía, dollar bars,
  39 Features y z-scores (`src/motores/nucleo/`). Lo único que cambia es el mercado que se le da.
- **Datos aislados en el VPS** (`grabadora/almacenDisco.ts`):

```
/var/lib/athenai-grabadora/
  clave.txt
  mercados/
    binance_btcusdt/  sesiones.jsonl  filas/2026-10-21.jsonl …
    binance_xauusdt/  sesiones.jsonl  filas/…
```

  - Cada fila y cada sesión llevan `mercado`.
  - La API pide el mercado: `/api/filas?mercado=binance:BTCUSDT`. También acepta `simbolo=BTCUSDT`, que equivale a Binance.
  - **Migración automática** desde el formato anterior (`filas/<SIMBOLO>/` y un `sesiones.jsonl` común):
    - mueve los archivos, sin copiar ni borrar;
    - el `sesiones.jsonl` viejo queda como `sesiones.jsonl.migrado`;
    - si algo falla, no toca nada y sigue grabando.
- **Navegador** (`src/motores/almacen/almacen.ts`):
  - una base IndexedDB por proveedor;
  - dentro, cada fila tiene la clave `[simbolo, cierre, n]`, y solo se lee por el rango de su símbolo (partición lógica);
  - toda clave de mercado de la plataforma pasa por `mercadoId`.

## 3. Todo lleva su `market_id`

| Pieza | Dónde | Campo |
|---|---|---|
| Fila grabada (VPS) | `grabadora/almacenDisco.ts` | `mercado` |
| Etiqueta / dataset para ML | `etiquetador/etiquetador.ts` → CSV | columna `market_id` |
| Resultado del Juez | `juez/juez.ts` | `ResultadoJuez.mercado` |
| Paper (informe) | `papers/paper.ts` | `mercado` |
| Veredicto de una estrategia | `components/laboratorio/plantillas.ts` | `porMercado[market_id]` |
| Bot de Paper | `paper/ejecutor.ts` | `Bot.mercado` |
| Modelo de ML (futuro) | `motores/modelos/<market_id>/` | `mercado` |

## 4. El Juez: solo el fuera de muestra del mismo mercado

- El Laboratorio pide «Mercado a probar». El worker lee solo las filas de ese mercado y se las pasa al Juez con su
  `mercado`.
- Los 10 motores se calculan con esas filas: Walk-Forward, Monte Carlo, Luck test, Robustez, DSR, PBO, Anti-futuro y
  Veredicto. Todas las métricas que deciden son fuera de muestra.
- **Se quitó la prueba «Otro mercado»** de Robustez. Probaba el edge de un activo en otro, lo que va contra esta regla.
  Robustez queda con costos ×2, parámetros vecinos y estabilidad por regímenes.
- El veredicto se guarda en `porMercado[market_id]`: probar la estrategia en XAU no pisa lo que se sabe de BTC.
- El cuadro «Dónde funciona cada estrategia» del Laboratorio muestra el veredicto por estrategia y mercado.

## 5. Paper: el bot no sale de su mercado

- **Creación del bot** (`MotorPaper.crearBot`): exige `mercadoAprobado === proveedor:simbolo`. Si el Juez aprobó la
  estrategia en `binance:XAUUSDT`, no se puede crear un bot en `binance:BTCUSDT`: da error.
- **Funcionamiento:** el bot guarda su `mercado` y solo recibe señales, precios y barras de ese mercado.
- **Pantalla de Paper:** se elige el par «estrategia + mercado» entre los aprobados. Los rechazados no aparecen.
- **Pruebas** (`paper/paper.test.ts`):
  - aprobación de XAU → no hay bot de BTC;
  - un bot de BTC no pide señal ni opera cuando solo llegan barras de XAU.

## 6. Machine learning (cuando se active; nada de esto existe todavía)

```
src/motores/modelos/
  binance_btcusdt/   entrenamiento, validación y modelo SOLO con datos de binance:BTCUSDT
  binance_xauusdt/   otro modelo, independiente
```

- Un modelo por mercado. El dataset sale del CSV del Etiquetador de ESE mercado (columna `market_id`).
- Validación cronológica con `walkForwardPurgado` (`src/motores/ml/antifuga.ts`): purga y embargo con
  `evento_inicio` / `evento_fin`, nunca barajar. Antes de entrenar, `verificarDataset` debe dar `ok`.
- El modelo lleva su `market_id`. El Juez lo valida con el fuera de muestra de ese mercado, y solo entonces puede
  tener bot de Paper en ese mercado.
