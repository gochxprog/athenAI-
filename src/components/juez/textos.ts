// «Explicación simple» y «Cómo se calcula» de cada motor del Juez (los mismos textos aprobados motor por motor).
export interface TextoMotor {
  que: string;
  sirve: string;
  mirar: string;
  calculo: string[];
}

export const TEXTOS: Record<string, TextoMotor> = {
  backtest: {
    que: 'Repetir tu estrategia sobre el pasado, barra por barra, como si hubieras operado de verdad, pagando comisiones y funding.',
    sirve: 'Saber cuánto habría ganado o perdido y ver cada operación que habría hecho.',
    mirar: 'Que la curva suba de forma pareja (no por una sola operación) y que el drawdown (la caída) sea algo que aguantarías.',
    calculo: [
      'La posición que decides al cierre de una barra (p) rige en la barra siguiente: retorno = p × (cierre siguiente / cierre − 1).',
      'Cada cambio de posición paga comisión + deslizamiento por lado: abrir o cerrar es 1 lado; girar de largo a corto son 2.',
      'Retorno neto de la barra = (1 + retorno de precio) × (1 − costo)^lados − 1. Capital = producto de (1 + retorno neto).',
      'Nunca se mantiene una posición a través de un hueco de datos, y al final de cada tramo se cierra todo.',
      'Funding: si la operación sigue abierta a las 00:00, 08:00 o 16:00 UTC, se paga (largo) o cobra (corto) la tasa vigente.',
    ],
  },
  metricas: {
    que: 'Los números que resumen cómo fue el backtest: cuánto ganó, cuánto sufrió y qué tan seguido acertó.',
    sirve: 'Comparar estrategias con la misma vara y saber qué esperar, por ejemplo cuántas pérdidas seguidas te tocará aguantar.',
    mirar: 'Siempre lo de fuera de muestra (datos que la estrategia no vio): esperanza > 0, Sharpe > 1 y un drawdown que puedas soportar.',
    calculo: [
      'Barras por año = 365,25 días ÷ tiempo típico (mediana) entre barras. Los días sin grabar no lo cambian.',
      'Sharpe = media de los retornos por barra ÷ su desviación × √(barras por año). Sortino usa solo las caídas.',
      'Factor de beneficio = suma de ganancias ÷ suma de pérdidas. Esperanza = retorno medio por operación.',
      'Z-Score = media de las operaciones ÷ su desviación × √(número de operaciones): cuántas desviaciones se aleja de cero.',
    ],
  },
  wfo: {
    que: 'Entrenar la estrategia con un tramo del pasado (IS), probarla en el tramo siguiente que nunca vio (OOS) y repetirlo avanzando en el tiempo.',
    sirve: 'Descubrir si la estrategia aprendió algo real o solo memorizó el pasado. Lo que vale es cómo le va en los tramos que no vio.',
    mirar: 'La eficiencia WFE (≥ 0,5 aceptable, ≥ 0,7 excelente, < 0,3 sobreajuste) y que la mayoría de ventanas OOS ganen.',
    calculo: [
      '5 ventanas con IS:OOS = 4:1 → L_OOS = barras ÷ 9, L_IS = 4 × L_OOS. Paso = L_OOS.',
      'En cada IS: θ* = la variante con mayor objetivo, usando solo barras del IS. θ* se congela y se aplica al OOS siguiente.',
      'Embargo: las últimas barras antes de cada OOS no se usan para elegir, para que el final del IS no se filtre en el OOS.',
      'WFE = media(anualizado OOS) ÷ media(anualizado IS). Retornos compuestos (producto), no sumados.',
    ],
  },
  mc: {
    que: 'Reordenar o remuestrear miles de veces las operaciones reales fuera de muestra para ver todos los caminos posibles.',
    sirve: 'Saber el rango de resultados que puedes esperar y la probabilidad de una caída grande por mala suerte en el orden.',
    mirar: 'Probabilidad de ruina ≤ 5 % y que el P5 (escenario pesimista) sea algo que aguantarías.',
    calculo: [
      'Bootstrap (con reemplazo): se eligen N operaciones al azar; una puede repetirse. Shuffle: las mismas operaciones en otro orden.',
      'Capital(k, i) = Capital(k, i − 1) × (1 + T(k, i)). MaxDD(k) = la mayor caída desde un máximo en la simulación k.',
      'Probabilidad de ruina = simulaciones con MaxDD ≥ umbral ÷ simulaciones. Si pasa del 5 %, el Juez rechaza.',
      'Percentiles con interpolación lineal: P5 pesimista, P50 mediana, P95 optimista.',
    ],
  },
  luck: {
    que: 'Crear cientos de mercados falsos (los mismos movimientos en otro orden) o entradas al azar, y ver si tu estrategia les gana.',
    sirve: 'Separar habilidad de suerte. Si el azar consigue lo mismo con frecuencia, sus ganancias pudieron ser casualidad.',
    mirar: 'El valor p: menor que 0,05 quiere decir que el azar la iguala menos de 1 de cada 20 veces (aprobado).',
    calculo: [
      'Hipótesis nula: «la estrategia no tiene habilidad». Se usa lo que hizo fuera de muestra.',
      'Cada escenario pasa por el mismo backtest (comisiones, funding y huecos) y se mide la métrica elegida.',
      'p = (escenarios con métrica ≥ la tuya + 1) ÷ (escenarios + 1). El +1 evita decir «p = 0».',
    ],
  },
  robustez: {
    que: 'Pruebas de estrés: el doble de comisiones, cambiar un poco los parámetros y distintos momentos del mercado, todo con este mismo mercado.',
    sirve: 'Descartar estrategias que solo funcionan en condiciones perfectas o con una configuración exacta (una «isla»).',
    mirar: 'Que pase las 3 pruebas críticas. Con 1 fallo sale una alerta; con 2 o más se rechaza.',
    calculo: [
      'Costos ×2: los mismos parámetros del Walk-Forward con comisión y deslizamiento al doble. Pasa con Profit Factor > 1,2 y retorno > 0.',
      'Vecinos: cada parámetro se mueve un paso de tu rejilla; se miden fuera de muestra. Pasa si ≥ 70 % ganan.',
      'Estabilidad: el OOS se corta en 10 sub-periodos (sube/baja, volatilidad alta/baja). Pasa si gana en ≥ 60 % y ninguno aporta ≥ 90 %.',
    ],
  },
  sobreajuste: {
    que: 'Si pruebas muchas versiones de una idea, alguna sale buena por suerte. DSR descuenta eso; PBO mide si elegir «la mejor» fue una lotería.',
    sirve: 'Saber si tu Sharpe es real y si el proceso de optimizar te está engañando.',
    mirar: 'DSR ≥ 0,95 y PBO < 5 %.',
    calculo: [
      'DSR = Φ((SR_obs − SR*) ÷ σ_SR), donde SR* es el Sharpe que el azar daría con N pruebas.',
      'PBO (CSCV): la serie se corta en 16 bloques y se prueban las 12.870 formas de usar la mitad para elegir y la otra para comprobar.',
      'PBO = combinaciones donde la elegida queda por debajo de la mediana fuera ÷ 12.870.',
    ],
  },
  correlacion: {
    que: 'Cuánto se parecen entre sí los resultados fuera de muestra de tus variantes, barra por barra.',
    sirve: 'Ver si las variantes son de verdad distintas o casi la misma estrategia (y si un buen resultado depende de una sola).',
    mirar: 'Correlaciones muy altas (cerca de 1) = variantes casi iguales; probar muchas así no aporta información nueva.',
    calculo: ['Correlación de Pearson entre los retornos por barra fuera de muestra de cada par de variantes (de −1 a 1).'],
  },
  antifuturo: {
    que: 'Revisa que tu estrategia decida solo con lo que ya pasó: lee tu código y lo ejecuta quitando y cambiando los datos posteriores.',
    sirve: 'Cazar el error más peligroso: un backtest que gana porque, sin querer, «ve» el futuro.',
    mirar: 'Que diga «causal». Cualquier fuga rechaza la estrategia, gane lo que gane.',
    calculo: [
      'Regla: Señal(t) = f(Datos[0 : t − 1]). La posición decidida con la fila i rige desde la barra i + 1.',
      'Código: se buscan filas[i + k], filas[-1] y estadísticas sobre todas las filas (fuga o aviso).',
      'Ejecución: en 8 cortes se quitan y se cambian las filas posteriores; las posiciones anteriores deben ser idénticas.',
    ],
  },
  veredicto: {
    que: 'El juez central: primero las puertas de cero tolerancia (si falla una, se rechaza); si pasa todas, una nota de 0 a 100.',
    sirve: 'Una sola decisión clara con el motivo exacto: rechazada, aprobada con reserva o lista para Paper Trading.',
    mirar: 'Todas las puertas en ✓ y la nota: 75 o más = lista para Paper Trading.',
    calculo: [
      'Antes de nada: ≥ 500 barras y ≥ 30 operaciones fuera de muestra; si no, «datos insuficientes».',
      'Puertas: anti-futuro · ruina ≤ 5 % · PBO < 5 % · DSR ≥ 0,95 · Luck test p < 0,05 · robustez (menos de 2 fallos críticos).',
      'Nota: WFE (25 %), costos ×2 y vecinos (25 %), DSR y PBO (30 %), suerte, Sharpe y drawdown (20 %).',
    ],
  },
};
