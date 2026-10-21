import TarjetaMotor, { type FichaMotor } from '@/components/ui/TarjetaMotor';
import type { EstadoFeed } from '@/motores/worker/protocolo';
import type { EstadoGrafico } from '@/motores/nucleo/pipeline';
import { conSigno, num } from '@/lib/format';

interface Motor extends FichaMotor {
  vivo: (f: EstadoFeed, e: EstadoGrafico | null) => [string, string][];
}

const usd = (v: number) => (Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} M USD` : `${num(v / 1e3, 0)} k USD`);
const o = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : num(v, d));

/** Los motores de Order Flow, en el mismo orden en que se construyen (del libro hacia arriba). */
const MOTORES: Motor[] = [
  {
    id: 'libro',
    nombre: '1 · Libro de órdenes (DOM)',
    que: 'las órdenes que esperan comprar (bid) y vender (ask) a cada precio.',
    sirve: 'ver de qué lado hay más gente esperando y dónde están las órdenes grandes.',
    mirar: 'el OBI: cerca de +1 hay mucha más compra esperando; cerca de −1, mucha más venta.',
    formulas: [
      'Precio medio = (mejor bid + mejor ask) / 2 · spread = ask − bid.',
      'OBI(10) = (Σ bid − Σ ask) / (Σ bid + Σ ask) en los 10 primeros niveles del libro agrupado (≈ 1 USD por nivel en BTC).',
      'MicroPrice = (Q_bid × P_ask + Q_ask × P_bid) / (Q_bid + Q_ask) con el mejor bid y ask REALES (sin agrupar).',
      'Stacking / pulling: un nivel que crece (o se vacía) ≥ 25 % sin retroceder durante 6 fotos seguidas.',
    ],
    vivo: (f, e) => [
      // Del mismo instante que el OBI y el MicroPrice (el resumen del feed llega 1 vez por segundo).
      e?.libro?.mid != null && e.libro.spread != null
        ? ['Bid / Ask', `${o(e.libro.mid - e.libro.spread / 2, 1)} / ${o(e.libro.mid + e.libro.spread / 2, 1)}`]
        : ['Bid / Ask', `${o(f.resumen.bid, 1)} / ${o(f.resumen.ask, 1)}`],
      ['OBI 10', o(e?.libro?.obi10, 3)],
      ['MicroPrice', o(e?.libro?.microPrice, 2)],
    ],
  },
  {
    id: 'footprint',
    nombre: '2 · Footprint e imbalances',
    que: 'cuánto se compró y vendió a mercado en cada precio de cada barra.',
    sirve: 'ver dónde atacaron los compradores o los vendedores con fuerza.',
    mirar: 'los stacked imbalances (3 o más niveles seguidos): suelen marcar zonas de apoyo o de rechazo.',
    formulas: [
      'Venta agresiva (bid) = trades con buyerIsMaker; compra agresiva (ask) = el resto. Delta = ask − bid.',
      'Imbalance comprador en P: Ask(P) / Bid(P − 1 nivel) ≥ 3. Vendedor en P: Bid(P) / Ask(P + 1 nivel) ≥ 3 (diagonal, como ATAS).',
      'Stacked = 3 o más imbalances del mismo lado en niveles seguidos.',
      'POC = nivel con más volumen (empate: el más cercano al cierre). Delta-POC = nivel con mayor |delta|.',
    ],
    vivo: (f) => [
      ['Imbalances C / V (5 barras)', `${f.resumen.imbCompra} / ${f.resumen.imbVenta}`],
      ['Stacked C / V', `${f.resumen.stackedCompra} / ${f.resumen.stackedVenta}`],
    ],
  },
  {
    id: 'cvd',
    nombre: '3 · CVD y VWAP',
    que: 'el CVD suma compras agresivas menos ventas agresivas desde que empezó la sesión. El VWAP es el precio medio pagado en el día.',
    sirve: 'saber quién manda en la sesión y si el precio está caro o barato frente a lo negociado hoy.',
    mirar: 'que el precio suba con el CVD subiendo (movimiento sano) o que se separen (posible agotamiento).',
    formulas: [
      'CVD = Σ (compra agresiva − venta agresiva) desde el inicio de la sesión automática (Sídney 22:00, Tokio 00:00, Londres 07:00, Nueva York 12:30 UTC).',
      'Pendiente = delta sumado de las 5 últimas barras.',
      'VWAP del día = Σ (precio × cantidad) / Σ cantidad desde las 00:00 UTC.',
      'Si la app se abrió a mitad de sesión o hubo un corte, el CVD y el VWAP están a medias: en las Features quedan vacíos (no se inventa lo que no se vio).',
    ],
    vivo: (f) => [
      ['CVD sesión', `${o(f.resumen.cvdSesion, 2)}`],
      ['Velocidad (1 min)', o(f.cvdVelocidad, 2)],
      ['VWAP', o(f.resumen.vwap, 1)],
    ],
  },
  {
    id: 'big',
    nombre: '4 · Big trades',
    que: 'órdenes a mercado muy grandes, aunque lleguen partidas en varios trades seguidos.',
    sirve: 'ver cuándo entra un participante grande.',
    mirar: 'big trades compradores en un soporte o vendedores en una resistencia.',
    formulas: [
      'Bloque = trades seguidos del mismo lado con ≤ 50 ms entre uno y otro (máx. 1 s de bloque).',
      'Nocional N = Σ precio × cantidad · precio del bloque = N / Σ cantidad.',
      'Es big trade si N ≥ 250.000 USD (BTC) Y su volumen es atípico: z = (V − media) / desviación de los últimos 1.000 bloques ≥ 2,5.',
    ],
    vivo: (f) => [
      ['Compradores (5 min)', usd(f.resumen.bigCompraUsd)],
      ['Vendedores (5 min)', usd(f.resumen.bigVentaUsd)],
    ],
  },
  {
    id: 'absorcion',
    nombre: '5 · Absorción',
    que: 'agresión muy fuerte en un precio que NO consigue mover el precio: alguien grande la estaba absorbiendo con órdenes límite.',
    sirve: 'detectar muros reales que frenan a compradores o vendedores.',
    mirar: 'absorción en el bid (vendedores frenados) cerca de mínimos, o en el ask (compradores frenados) cerca de máximos.',
    formulas: [
      'Filtros: z del volumen agresivo del nivel ≥ 2 (frente a 20 barras), ≥ 60 % del volumen del nivel es de un lado, y el precio avanzó ≤ 35 % del rango normal más allá del nivel.',
      'Puntuación 0–100 = media ponderada de: volumen (25 %), poco avance (30 %), dominio (15 %), concentración (15 %), repetición en barras previas (10 %), cierre fallido (5 %). Se muestra desde 60.',
    ],
    vivo: (f) => [
      ['Última', f.resumen.absorcion ? `${f.resumen.absorcion.lado === 'bid' ? 'en el bid' : 'en el ask'} · ${num(f.resumen.absorcion.score, 0)}` : '—'],
      ['Pico frente a 20 barras', f.resumen.absorcionSpike ? `${num(f.resumen.absorcionSpike, 1)}×` : '—'],
    ],
  },
  {
    id: 'agotamiento',
    nombre: '6 · Agotamiento',
    que: 'un empuje que llega al extremo cada vez con menos fuerza y el precio no sigue.',
    sirve: 'anticipar el final de un tramo alcista o bajista.',
    mirar: 'agotamiento alcista en máximos o bajista en mínimos, sobre todo junto a absorción.',
    formulas: [
      'La agresión media de los 2 niveles del extremo ≤ 50 % de la de los 3 niveles anteriores; la aproximación es fuerte frente a 20 barras.',
      'El extremo está en lo alto (o bajo) del rango reciente, y la barra cierra lejos de él o la barra SIGUIENTE no lo supera.',
      'Como necesita la barra siguiente, solo se conoce al cerrar esa barra: en las Features aparece una fila después (nunca se adelanta).',
    ],
    vivo: (f) => [['Último', f.resumen.agotamiento ? `${f.resumen.agotamiento.lado === 'bullish' ? 'alcista' : 'bajista'} · ${num(f.resumen.agotamiento.score, 0)}` : '—']],
  },
  {
    id: 'icebergs',
    nombre: '7 · Icebergs',
    que: 'órdenes ocultas: en un precio se negocia mucho más de lo que el libro mostraba, porque la orden se va reponiendo.',
    sirve: 'encontrar a un participante grande escondido en un nivel.',
    mirar: 'icebergs comprando en un soporte o vendiendo en una resistencia: el nivel suele aguantar.',
    formulas: [
      'Cada segundo, por nivel: consumido = mín(ejecutado, visible antes); esperado = visible antes − ejecutado; repuesto = visible después − esperado.',
      'Recarga = repuesto ≥ 50 % de lo consumido (y lo consumido ≥ 10 % de lo visible).',
      'Iceberg = ejecutado ≥ 3 × el máximo que llegó a verse y 3 o más recargas.',
      'Cada trade se asigna al nivel del libro agrupado donde está la orden (compras al nivel ask de arriba, ventas al bid de abajo).',
    ],
    vivo: (f) => [['Icebergs (5 min)', num(f.resumen.icebergs)]],
  },
  {
    id: 'stoprun',
    nombre: '8 · Stop runs',
    que: 'el precio rompe un máximo o un mínimo reciente con una ráfaga (saltando los stops) y vuelve enseguida.',
    sirve: 'ver barridos de stops que suelen ir seguidos de un giro.',
    mirar: 'un barrido del máximo (después suele bajar) o del mínimo (después suele subir).',
    formulas: [
      'Barras de 5 s. Nivel = máximo (o mínimo) de los 5 min anteriores, sin contar los últimos 15 s.',
      'Ruptura ≥ 2 pasos del libro (≈ 2 USD en BTC) y la barra anterior no lo había roto.',
      'Ráfaga: volumen agresor por barra ≥ 2 × la mediana y ≥ 60 % del volumen en la dirección del barrido.',
      'Rechazo: en ≤ 6 barras el cierre vuelve al otro lado del nivel. Solo cuenta si hay rechazo.',
    ],
    vivo: (f) => [['Stop runs (5 min)', num(f.resumen.stopRuns)]],
  },
  {
    id: 'oi',
    nombre: '9 · Open Interest',
    que: 'cuántos contratos hay abiertos en el mercado. Sube si entran posiciones nuevas y baja si se cierran.',
    sirve: 'saber si un movimiento viene de dinero nuevo o de gente cerrando.',
    mirar: 'precio ↑ con OI ↑ = largos nuevos; precio ↑ con OI ↓ = cortos cerrando; precio ↓ con OI ↑ = cortos nuevos; precio ↓ con OI ↓ = largos cerrando.',
    formulas: [
      'ΔOI % = (OI ahora − OI de la barra anterior) / OI anterior × 100 (Binance, cada 5 s).',
      'z robusto = 0,6745 × (ΔOI − mediana) / MAD, sobre las últimas 100 barras.',
      'Flush = z ≤ −2,5 con un movimiento ≥ 1 rango medio y volumen atípico (cierre masivo).',
    ],
    vivo: (f) => [
      ['OI', f.resumen.oi !== null ? num(f.resumen.oi, 0) : '—'],
      ['ΔOI 15 min', f.resumen.oiDeltaPct !== null ? conSigno(f.resumen.oiDeltaPct, 2, '%') : '—'],
    ],
  },
  {
    id: 'lhm',
    nombre: '10 · Heatmap de liquidez y pools',
    que: 'el mapa de calor es la foto del libro cada segundo durante 30 min: los colores fuertes son órdenes grandes. Un pool es una orden grande que se queda quieta.',
    sirve: 'ver dónde hay muros de liquidez que pueden frenar o atraer al precio.',
    mirar: 'el pool más cercano arriba y abajo. Si el precio lo barre, queda su huella.',
    formulas: [
      'Heatmap: color = log(tamaño / mediana) / log(P99 / mediana). Lo normal (hasta la mediana) queda oscuro.',
      'Pool = cubo de 5 niveles con volumen ≥ percentil 99 de las últimas 120 fotos durante 3 fotos seguidas.',
      'Desaparece si baja del umbral (se retiró) o si el precio lo atraviesa (barrido → huella durante 5 min).',
    ],
    vivo: (f) => [
      ['Pool arriba', f.resumen.poolArriba ? `${num(f.resumen.poolArriba.p, 1)} · ${num(f.resumen.poolArriba.v, 1)}` : '—'],
      ['Pool abajo', f.resumen.poolAbajo ? `${num(f.resumen.poolAbajo.p, 1)} · ${num(f.resumen.poolAbajo.v, 1)}` : '—'],
    ],
  },
  {
    id: 'liq',
    nombre: '11 · Liquidaciones y funding',
    que: 'liquidaciones = posiciones cerradas a la fuerza por el exchange. Funding = lo que se pagan largos y cortos cada 8 h.',
    sirve: 'ver cascadas de liquidaciones y si el mercado está muy cargado hacia un lado.',
    mirar: 'muchas liquidaciones de largos en una caída (capitulación) o funding muy positivo (demasiados largos).',
    formulas: [
      'Liquidación (Binance forceOrder): nocional = precio medio ejecutado × cantidad ejecutada. Orden de venta = se liquidó un largo.',
      'Funding: tasa vigente (markPrice). Con tasa > 0 los largos pagan a los cortos a las 00, 08 y 16 UTC.',
    ],
    vivo: (f) => [
      ['Largos liquidados (5 min)', usd(f.resumen.liqLargosUsd)],
      ['Cortos liquidados (5 min)', usd(f.resumen.liqCortosUsd)],
      ['Funding', f.resumen.fundingTasa !== null ? conSigno(f.resumen.fundingTasa * 100, 4, '%') : '—'],
    ],
  },
];

/** Pestaña «Cómo funciona cada motor»: explicación simple, fórmulas y valor en vivo del mercado visible. */
export default function MotoresOrderFlow({ feed, estado }: { feed: EstadoFeed | undefined; estado: EstadoGrafico | null }) {
  return (
    <div className="space-y-4" data-motores-of>
      <p className="text-xs text-plata-400">
        Cada motor lee el mercado en vivo {feed ? `(${feed.simbolo})` : ''} y alimenta las Features que aprende la máquina. Todos se revisaron con valores calculados a mano.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {MOTORES.map((m) => (
          <TarjetaMotor key={m.id} m={m} vivo={feed ? m.vivo(feed, estado) : [['En vivo', 'sin datos']]} />
        ))}
      </div>
    </div>
  );
}
