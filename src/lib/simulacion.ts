// Motor de simulación DEMO: mercado BTCUSDT + contadores del motor + registro de eventos.
// Todo es local y determinista a partir de una semilla; no hay red ni dinero real.
import { CONTADORES_INICIALES, PRECIO_REFERENCIA, BOTS, POSICIONES, type ModeloId } from '@/data/mock';
import { crearAleatorio, normal, elegir } from '@/lib/random';
import { num, conSigno } from '@/lib/format';

export interface BarraFlujo {
  compra: number;
  venta: number;
}

export interface EstadoMercado {
  precio: number;
  apertura24h: number;
  vwap: number;
  cvd: number;
  atr: number;
  oi: number;
  latenciaMs: number;
  barras: BarraFlujo[];
  dollarBars: number;
  gaps: number;
  historial: number[];
  ritmo: number[]; // dollar bars por minuto, ventanas de 10 s
  conectado: boolean;
  grabando: boolean;
}

export interface EstadoMotor {
  hipotesis: number;
  aprobadas: number;
  rechazadas: number;
  pruebas: number;
  cola: number;
  epoca: number;
  loss: number;
  valLoss: number;
  idsPrueba: number[];
}

export type TipoEvento = 'datos' | 'modelo' | 'juez' | 'bot' | 'patron';

export interface Evento {
  id: number;
  hora: Date;
  tipo: TipoEvento;
  texto: string;
}

const UMBRAL_DOLLAR_BAR = 1_000_000;
const VOLUMEN_SESION_INICIAL = 96_400;
const MAX_EVENTOS = 80;

const DESCRIPTORES = [
  'Absorción en el bid tras delta negativo sostenido',
  'Expansión de ATR posterior a compresión en Asia',
  'Reversión al VWAP tras agotamiento comprador',
  'Continuación con aumento de Open Interest y delta a favor',
  'Desequilibrio del libro previo a ruptura de mínimo',
  'Retorno al POC tras apertura desplazada',
  'Agotamiento con volumen decreciente en extremo de rango',
  'Ruptura de rango con absorción previa del vendedor',
  'Delta divergente con OI decreciente en máximo de 1 h',
  'Reversión de exceso de basis con CVD plano',
];

const MODELOS_PROPONEN: ModeloId[] = ['DL-Net-01', 'LGBM-Flow-02', 'RF-Alpha-01'];

const MOTIVOS = [
  (r: () => number) => `win rate ${num(44 + r() * 7, 1)}% (mínimo 55%)`,
  (r: () => number) => `R:R neto ${num(0.7 + r() * 0.25, 2)} (mínimo 1,10)`,
  (r: () => number) => `costos de comisión + slippage consumen el ${num(105 + r() * 60, 0)}% del edge`,
  (r: () => number) => `Max Drawdown ${num(12.5 + r() * 6, 1)}% (límite 12%)`,
  (r: () => number) => `luck test p = ${num(0.08 + r() * 0.3, 2)} (máximo 0,05)`,
  (r: () => number) => `PBO ${num(28 + r() * 30, 0)}% (límite 25%)`,
];

export class SimuladorDemo {
  mercado: EstadoMercado;
  motor: EstadoMotor;
  eventos: Evento[] = [];

  private rand: () => number;
  private notionalBarra = 0;
  private barrasVentana = 0;
  private segundosVentana = 0;
  private volumenSesion = VOLUMEN_SESION_INICIAL;
  private siguienteHipotesis = CONTADORES_INICIALES.hipotesis + 1;
  private colaIds: number[];
  private pruebaIds: number[];
  private siguienteEvento = 0;
  private reloj: number;
  private ancla = PRECIO_REFERENCIA;

  constructor(semilla = 20261020) {
    this.rand = crearAleatorio(semilla);
    const ahora = Date.now();
    const minutosDia = new Date().getHours() * 60 + new Date().getMinutes();

    // Las hipótesis detalladas en Investigación conservan su estado; la simulación mueve el resto.
    this.colaIds = [1284, 1282, 1278, 1276, 1274, 1272, 1270, 1268, 1267, 1265, 1264, 1262, 1261, 1260, 1258, 1257, 1256, 1255, 1253, 1252, 1251, 1250, 1249, 1247, 1246, 1245, 1243, 1241, 1240, 1238, 1236, 1234, 1233, 1232, 1230];
    this.pruebaIds = [1229, 1228, 1227, 1225, 1224, 1223, 1221, 1220, 1218, 1216, 1215, 1214];

    this.mercado = {
      precio: PRECIO_REFERENCIA,
      apertura24h: 84_105,
      vwap: 84_655,
      cvd: 1_284,
      atr: 186,
      oi: 81_240,
      latenciaMs: 38,
      barras: Array.from({ length: 28 }, () => this.barraAleatoria()),
      dollarBars: Math.round(minutosDia * 13.4),
      gaps: 0,
      historial: [],
      ritmo: Array.from({ length: 30 }, () => 13 + normal(this.rand) * 1.6),
      conectado: true,
      grabando: true,
    };
    this.motor = { ...CONTADORES_INICIALES, epoca: 47.2, loss: 0, valLoss: 0, idsPrueba: this.pruebaIds };
    this.actualizarLoss();

    // Historia del día: simula los últimos 45 minutos para que el log arranque con contenido coherente.
    this.reloj = ahora - 45 * 60_000;
    for (let s = 0; s < 45 * 60; s++) {
      this.pasoMercado();
      this.reloj += 1000;
      if (s % 170 === 0) this.emitirEvento();
    }
    this.reloj = ahora;
    this.mercado.historial = this.mercado.historial.slice(-180);
    this.siguienteEvento = 3;
  }

  /** Avanza 1 segundo de simulación. */
  tick() {
    this.reloj = Date.now();
    this.pasoMercado();
    const epocaAntes = Math.floor(this.motor.epoca);
    this.motor.epoca = Math.min(119.99, this.motor.epoca + 0.025);
    this.actualizarLoss();
    if (Math.floor(this.motor.epoca) > epocaAntes) {
      this.agregar('modelo', `DL-Net-01 completó la época ${Math.floor(this.motor.epoca)}/120 · loss ${num(this.motor.loss, 3)} · val_loss ${num(this.motor.valLoss, 3)}`);
    }
    this.siguienteEvento -= 1;
    if (this.siguienteEvento <= 0) {
      this.emitirEvento();
      this.siguienteEvento = 4 + Math.floor(this.rand() * 4);
    }
  }

  private barraAleatoria(): BarraFlujo {
    const total = 11.8 * Math.exp(normal(this.rand) * 0.25);
    const fc = Math.min(0.85, Math.max(0.15, 0.5 + normal(this.rand) * 0.14));
    return { compra: total * fc, venta: total * (1 - fc) };
  }

  private actualizarLoss() {
    const e = this.motor.epoca;
    this.motor.loss = 0.6931 - 0.0372 * (1 - Math.exp(-e / 34));
    this.motor.valLoss = this.motor.loss + 0.0041 + 0.0018 * Math.sin(e * 1.7);
  }

  private pasoMercado() {
    const m = this.mercado;
    const vol = 2.6 * Math.exp(normal(this.rand) * 0.55);
    const fc = Math.min(0.9, Math.max(0.1, 0.5 + normal(this.rand) * 0.16));
    const compra = vol * fc;
    const venta = vol - compra;
    const delta = compra - venta;

    // Paseo aleatorio con reversión suave al ancla (que a su vez deriva lentamente).
    this.ancla += normal(this.rand) * 1.2;
    const cambio = normal(this.rand) * 8.5 + (this.ancla - m.precio) * 0.004 + delta * 1.4;
    m.precio = Math.round((m.precio + cambio) * 10) / 10;

    this.volumenSesion += vol;
    m.vwap += ((m.precio - m.vwap) * vol) / this.volumenSesion;
    m.cvd += delta;
    m.atr += (186 + Math.sin(this.reloj / 900_000) * 22 - m.atr) * 0.01 + normal(this.rand) * 0.6;
    m.oi += normal(this.rand) * 6 + delta * 0.4;
    m.latenciaMs = Math.max(24, Math.round(38 + normal(this.rand) * 4));
    m.historial.push(m.precio);
    if (m.historial.length > 600) m.historial.splice(0, m.historial.length - 180);

    // Agregación en dollar bars de 1 M USD.
    const ultima = m.barras[m.barras.length - 1];
    ultima.compra += compra;
    ultima.venta += venta;
    this.notionalBarra += vol * m.precio;
    while (this.notionalBarra >= UMBRAL_DOLLAR_BAR) {
      this.notionalBarra -= UMBRAL_DOLLAR_BAR;
      m.dollarBars += 1;
      this.barrasVentana += 1;
      m.barras = [...m.barras.slice(1), { compra: 0, venta: 0 }];
    }

    this.segundosVentana += 1;
    if (this.segundosVentana >= 10) {
      const previo = m.ritmo[m.ritmo.length - 1];
      m.ritmo = [...m.ritmo.slice(1), previo * 0.65 + this.barrasVentana * 6 * 0.35];
      this.segundosVentana = 0;
      this.barrasVentana = 0;
    }
  }

  private agregar(tipo: TipoEvento, texto: string) {
    const ultimo = this.eventos[0];
    if (ultimo && ultimo.texto === texto) return; // nunca líneas duplicadas
    this.eventos = [{ id: this.reloj + this.eventos.length, hora: new Date(this.reloj), tipo, texto }, ...this.eventos].slice(0, MAX_EVENTOS);
  }

  private emitirEvento() {
    const r = this.rand();
    const m = this.mercado;
    const motor = this.motor;

    if (r < 0.22 && this.colaIds.length < 60) {
      const id = this.siguienteHipotesis++;
      this.colaIds.push(id);
      motor.hipotesis += 1;
      motor.cola += 1;
      const modelo = elegir(this.rand, MODELOS_PROPONEN);
      this.agregar('modelo', `${modelo} propuso H-${id}: «${elegir(this.rand, DESCRIPTORES)}» · ${40 + Math.floor(this.rand() * 360)} ocurrencias en los datos`);
    } else if (r < 0.36 && this.colaIds.length > 0) {
      const id = this.colaIds.shift()!;
      this.pruebaIds.push(id);
      motor.cola -= 1;
      motor.pruebas += 1;
      this.agregar('juez', `Juez inició Walk-Forward de H-${id} · 12 ventanas · costos 0,04% + 1 tick`);
    } else if (r < 0.52 && this.pruebaIds.length > 0) {
      const id = this.pruebaIds.shift()!;
      motor.pruebas -= 1;
      if (this.rand() < 0.1) {
        motor.aprobadas += 1;
        this.agregar('juez', `Juez: H-${id} APROBADA · Sharpe OOS ${num(1.05 + this.rand() * 0.8, 2)} · PBO ${num(6 + this.rand() * 15, 0)}% · p = ${num(0.004 + this.rand() * 0.04, 3)}`);
      } else {
        motor.rechazadas += 1;
        this.agregar('juez', `Juez: H-${id} RECHAZADA · ${elegir(this.rand, MOTIVOS)(this.rand)}`);
      }
    } else if (r < 0.62 && this.pruebaIds.length > 0) {
      const id = elegir(this.rand, this.pruebaIds);
      const p5 = -2 - this.rand() * 6;
      const p95 = 8 + this.rand() * 22;
      this.agregar('juez', `Monte Carlo de H-${id}: 2.000 trayectorias · P5 ${conSigno(p5, 1, '%')} · P95 ${conSigno(p95, 1, '%')}`);
    } else if (r < 0.74) {
      this.agregar('datos', `Features recalculadas · VWAP ${num(m.vwap, 1)} · CVD Delta ${conSigno(m.cvd, 0)} BTC · ATR ${num(m.atr, 0)} USD`);
    } else if (r < 0.84) {
      this.agregar('datos', `Recorder: ${num(m.dollarBars)} dollar bars en la sesión · ${m.gaps} gaps · latencia ${m.latenciaMs} ms`);
    } else if (r < 0.93) {
      const pos = elegir(this.rand, POSICIONES);
      const bot = BOTS.find((b) => b.id === pos.bot)!;
      const pnl = (m.precio - pos.entrada) * pos.tamaño * (pos.lado === 'Long' ? 1 : -1);
      this.agregar('bot', `${bot.id} mantiene ${pos.lado.toUpperCase()} ${num(pos.tamaño, 3)} BTC · P&L no realizado ${conSigno(pnl, 2)} USD · modelo congelado ${bot.hashModelo}`);
    } else {
      const pd = elegir(this.rand, ['PD-011', 'PD-014', 'PD-019', 'PD-022', 'PD-031']);
      const n = 1 + Math.floor(this.rand() * 4);
      this.agregar('patron', `Lector confirmó ${n} ${n === 1 ? 'nueva ocurrencia' : 'nuevas ocurrencias'} de ${pd} en las últimas 500 dollar bars`);
    }
  }
}
