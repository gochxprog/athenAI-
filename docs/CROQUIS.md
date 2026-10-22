# Croquis de AthenAI (versión 2)

Borrador para revisar. No se toca código hasta que el usuario lo apruebe.
Fecha: 22-oct-2026.

## 1. La idea en una frase
Una plataforma donde **tú o la máquina proponen estrategias**, el **Juez** decide si hay edge de verdad o es suerte, y lo aprobado opera en **Paper** (y algún día en real). Todo sobre **tus propios datos**, que la grabadora junta 24/7.

## 2. Lo que se queda tal cual
Esto ya funciona y está probado; se lleva a la versión 2 sin reescribir sus cuentas.

| Pieza | Por qué se queda |
|---|---|
| **Grabadora 24/7 (VPS)** | Ya graba BTC y XAU. **La parte que graba no se toca.** Sus archivos son la base de todo |
| Motores de order flow | Absorción, icebergs, stop runs, OI, LHM…, con unas 300 pruebas |
| Juez | Walk-Forward, Monte Carlo, suerte, robustez, DSR, PBO y anti-futuro |
| Salidas | Stop, objetivo y gestión (fija, BE, escalonada); el mismo código en prueba y en vivo |
| Fichas de mercado | Contratos, valor del punto, tick |
| Diario | Ficha de cada operación y calendario día/semana/mes/año |

**Ojo:** la grabadora también sirve la página web y corre los bots. Esas dos partes **sí** se actualizan cuando llegue la versión nueva. Lo que graba y cómo lo guarda, no.

## 3. El dibujo general

```mermaid
flowchart LR
  F[Fuente de datos<br/>Binance hoy · la que compres mañana] --> G[Grabadora 24/7<br/>en tu VPS]
  G --> A[(Almacén<br/>barras completas + Features)]
  A --> E[Motor de estrategias<br/>código libre]
  TU[Tú: ideas] --> E
  ML1[ML: busca edge solo] --> E
  E --> J{Juez}
  J -- rechaza --> X[Archivo de ideas<br/>rechazadas]
  J -- aprueba --> B[Bot en Paper 24/7<br/>en el VPS]
  ML2[ML: filtra tus señales] --> B
  B --> D[Diario]
  B --> T[Terminal<br/>lo ves y mandas]
  B -. algún día .-> R[Broker real]
```

- **En el VPS (24/7):** la grabadora, los bots y, más adelante, el entrenamiento del ML.
- **En el navegador:** solo ver y mandar. Si cierras la página, nada se detiene.

## 4. Motor de estrategias (lo más importante de la versión 2)
Hoy una estrategia solo ve el cierre y las Features, y solo dice comprado, vendido o fuera. En la versión 2 se escribe como en cualquier plataforma seria.

```python
# Ejemplo: rompe el máximo de 20 velas de 5 minutos con absorción a favor → compra con stop en el mínimo
def en_cada_vela(v, ctx):
    velas = ctx.velas('5m')                     # apertura, máximo, mínimo, cierre, volumen, delta
    maximo = max(x.high for x in velas[-21:-1])
    if not ctx.posicion and v.close > maximo and v.f['absorcion_bid'] > 60:
        ctx.comprar(stop=v.low, rr=2, gestion='be1R')
```

- **Lo que ve tu código:**
  - velas de 1m, 5m, 15m, 1h o dollar bars;
  - en cada vela: apertura, máximo, mínimo, cierre, volumen y delta;
  - todas las Features (absorción, icebergs, OI…) como extra.
- **Lo que puede hacer:**
  - comprar o vender a mercado, en límite o en stop;
  - poner stop, objetivo o RR;
  - mover el stop y salir.
- **Sin mirar al futuro:** el motor le entrega las velas **una por una**. Tu código no puede ver la siguiente.
- **El mismo código** corre en el Juez, en Paper y, algún día, en real.

## 5. Machine learning y red neuronal (se arma ahora, se entrena con meses de datos)

| Trabajo | Qué hace | Cuándo |
|---|---|---|
| **Filtro** | Aprende cuándo tomar cada señal de tu estrategia y cuándo no | Con una estrategia aprobada y 2–3 meses de datos |
| **Buscador de edge** | Prueba combinaciones solo y propone ideas | Con varios meses de datos o la fuente comprada |
| **Red neuronal** | Lo mismo con modelos profundos (CNN, LSTM, Transformer) | Después del ML clásico |

**Reglas fijas:**
1. **El Juez cuenta cada intento.** Si la máquina prueba 5.000 ideas, exige mucho más para aprobar una.
2. **La bóveda:** una parte de los datos se guarda aparte y la máquina nunca la ve. Una idea solo se cree si también funciona ahí.
3. **Nada pasa a Paper sin el Juez y sin tu OK.** Reentrenar cada semana, sí; cambiar de modelo solo, nunca.

## 6. Enchufes (nada depende de un proveedor)
- **Datos:** Binance hoy → la fuente que compres (Rithmic, Databento…) mañana. Se cambia el enchufe y nada más.
- **Órdenes:** Paper hoy → tu broker mañana. Los bots no saben dónde operan.
- **Tamaño:** en contratos o lotes según la ficha de cada mercado.

## 7. Pantallas propuestas (menos y más completas)

| # | Pantalla | Qué tiene | Junta lo que hoy está en |
|---|---|---|---|
| 1 | **Panel** | Resumen del día: mercados, bots, alertas. Cerebro 3D | Panel General |
| 2 | **Terminal** | Gráfico, DOM, ticket, posiciones, motores de order flow | Terminal |
| 3 | **Laboratorio** | Editor de código libre, el Juez, tus estrategias y su historial | Laboratorio + Estrategias |
| 4 | **Investigación** | El buscador de edge del ML, la red de hipótesis, patrones | Investigación + Conocimiento |
| 5 | **Red neuronal** | Los modelos profundos (cuando toque) | El lugar reservado |
| 6 | **Bots** | Bots en Paper, Guardián, «¿cumple lo que prometió?» | Pestaña Bots |
| 7 | **Diario** | Calendario, métricas, cada operación con su porqué | Pestaña Diario + Decisiones |
| 8 | **Agentes** | Sala 3D: quién está trabajando en qué | Agentes |
| 9 | **Sistema** | Datos, grabadora, VPS, notificaciones, salud | Datos + Máquinas |

De 11 pantallas a 9, y ninguna vacía «de adorno»: si una no tiene motor, no aparece en el menú hasta que lo tenga.

## 8. Orden de construcción (unos 3 meses)
La plataforma actual sigue funcionando hasta que la nueva la reemplace. La grabadora graba todo el tiempo.

| Fase | Qué | Cómo se sabe que está lista |
|---|---|---|
| 0 | Este croquis | Lo apruebas |
| 1 | Esqueleto nuevo: menú, diseño, carga de datos grabados | Abre rápido y lee tus datos del VPS |
| 2 | **Motor de estrategias + Juez** | Una estrategia de ejemplo pasa por el Juez de punta a punta |
| 3 | Terminal, Bots y Diario | Un bot corre 24/7 en Paper con stop y objetivo |
| 4 | Investigación y ML (armado, sin entrenar) | Con datos de prueba, el buscador propone y el Juez filtra |
| 5 | Visual: Panel 3D, Agentes, Red neuronal | Fotos aprobadas, sin lag en celular |

## 9. Reglas de trabajo
1. **Una pantalla a la vez**: fotos y tu OK antes de seguir.
2. **Sin lag:** cada pantalla se mide en un celular lento simulado; mínimo 30 cuadros por segundo.
3. **Sin código basura:** lo que se reemplaza se borra; nada de dos versiones de lo mismo.
4. **Solo datos reales** en la plataforma; los datos de prueba, solo para probar.
5. **Ideas nuevas** a `docs/PENDIENTES.md`, no directo al código.

## 10. Lo que tienes que decidir tú
1. ¿Te gustan las 9 pantallas, o quieres juntar o separar alguna?
2. ¿Dónde hacemos la versión 2? Mi recomendación: en este mismo repositorio, en una carpeta nueva. Así se reutilizan los motores sin copiarlos.
3. ¿Qué mercados además de BTC y XAU? (Más mercados = más datos para el ML, pero más disco en el VPS.)
4. ¿Qué te gusta del diseño actual y qué no? Si tienes fotos de plataformas que te gusten, mándamelas.
