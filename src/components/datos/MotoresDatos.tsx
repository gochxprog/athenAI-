import TarjetaMotor, { type FichaMotor } from '@/components/ui/TarjetaMotor';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import { proximoEvento } from '@/motores/nucleo/calendario';
import type { EstadoFeed } from '@/motores/worker/protocolo';
import { num } from '@/lib/format';

interface Motor extends FichaMotor {
  vivo: (f: EstadoFeed | undefined) => [string, string][];
}

const ESTADO: Record<string, string> = { 'en-vivo': 'En vivo', conectando: 'Conectando', reconectando: 'Reconectando', 'sin-datos': 'Sin datos', error: 'Error', detenido: 'Detenido' };

const usdCorto = (v: number) => (v >= 1e6 ? `${num(v / 1e6, 1)} M` : `${num(v / 1e3, 0)} k`);

const MOTORES: Motor[] = [
  {
    id: 'fuente',
    nombre: '1 · Fuente Binance',
    que: 'la conexión con Binance: operaciones, libro de órdenes, Open Interest, liquidaciones y funding.',
    sirve: 'que todo lo demás reciba datos reales y completos.',
    mirar: 'que diga «En vivo» y que la latencia sea baja (menos de 1 s).',
    formulas: [
      'Dos conexiones: /market (trades, liquidaciones, funding) y /public (libro cada 100 ms).',
      'Libro: foto inicial por REST y luego cambios encadenados. El primero debe cumplir U ≤ lastUpdateId ≤ u y cada uno siguiente pu = u anterior; si no, se vuelve a pedir la foto (resincronización).',
      'Si una conexión calla (libro 20 s, trades 90 s) se reconecta con espera creciente (1 s → 30 s).',
      'Latencia = hora de llegada − hora del trade en Binance.',
    ],
    vivo: (f) => [
      ['Estado', f ? (ESTADO[f.conexion] ?? f.conexion) : '—'],
      ['Latencia', f?.latenciaMs != null ? `${num(f.latenciaMs)} ms` : '—'],
      ['Trades/s', f ? num(f.tradesPorSeg, 1) : '—'],
    ],
  },
  {
    id: 'vigia',
    nombre: '2 · Vigía de huecos',
    que: 'avisa cuando faltan datos: un corte de conexión, el libro que hubo que resincronizar o trades perdidos.',
    sirve: 'que la máquina no aprenda de datos rotos. Esas filas llevan hueco = 1.',
    mirar: 'que los cortes y los trades perdidos sean pocos. Si suben mucho, revisa tu conexión.',
    formulas: [
      'Corte: el feed deja de estar «en vivo» (reconexión, error, resincronización del libro).',
      'Trades perdidos: los números de operación de Binance (aggTradeId) son consecutivos; si salta, faltaron trades. Los repetidos se ignoran.',
      'La primera barra tras abrir la app también es hueco: antes no se grababa.',
      'La siguiente fila de Features lleva hueco = 1; el CVD y el VWAP de esa sesión quedan marcados como incompletos.',
    ],
    vivo: (f) => [
      ['Cortes', f ? num(f.cortes) : '—'],
      ['Trades perdidos', f ? num(f.tradesPerdidos) : '—'],
    ],
  },
  {
    id: 'barras',
    nombre: '3 · Barras (dollar bars)',
    que: 'en vez de una vela por minuto, una barra cada vez que se negocia una cantidad fija de dinero.',
    sirve: 'cada barra tiene la misma «cantidad de mercado»: más barras cuando hay acción y menos cuando está quieto.',
    mirar: 'unas 2.000 barras al día. En BTC cada barra son 10 M USD.',
    formulas: [
      'Tamaño = volumen de 24 h / 2.000, entre 100 mil y 10 M USD (se fija al conectar).',
      'La barra se cierra con el trade que hace que Σ precio × cantidad ≥ tamaño (ese trade pertenece a la barra).',
      'Apertura = primer trade, cierre = último, máximo y mínimo; compra y venta agresivas por nivel de precio (footprint).',
    ],
    vivo: (f) => [
      ['Tamaño de barra', f?.calibrado ? `${usdCorto(f.dollarBarUsd)} USD` : 'calibrando'],
      ['Filas hoy', f ? num(f.filas) : '—'],
    ],
  },
  {
    id: 'almacen',
    nombre: '4 · Almacén',
    que: 'guarda en tu navegador cada fila de Features, en una carpeta separada por fuente.',
    sirve: 'tener historia para el Juez, el Etiquetador y los bots aunque cierres la app.',
    mirar: 'que diga «guardando». Cada vez que abres la app empieza una sesión nueva.',
    formulas: [
      'Clave de cada fila: (símbolo, cierre de la barra, número): se leen siempre en orden de tiempo.',
      'Se escribe en lotes (una transacción) para no frenar el motor.',
      'Un cambio de sesión cuenta como hueco para el Juez y el Etiquetador.',
    ],
    vivo: (f) => [['Guardando', f ? (f.guardando ? 'sí' : 'no') : '—']],
  },
  {
    id: 'calendario',
    nombre: '5 · Calendario de eventos',
    que: 'las fechas de los eventos fuertes (FOMC, CPI…) que se conocen de antemano.',
    sirve: 'marcar las barras en la ventana de «no operar» (ventana_evento = 1).',
    mirar: 'el próximo evento y su ventana.',
    formulas: ['Ventana = desde «minutos antes» hasta «minutos después» del evento (FOMC: 30 antes, 90 después). Solo los de impacto alto marcan las Features.'],
    vivo: () => {
      const e = proximoEvento(motorOrderFlow.calendario, Date.now());
      return [['Próximo', e ? `${e.nombre} · ${new Date(e.t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}` : 'ninguno']];
    },
  },
];

/** Sección «Cómo funciona cada motor» del Centro de datos. */
export default function MotoresDatos({ feed }: { feed: EstadoFeed | undefined }) {
  return (
    <div className="space-y-3" data-motores-datos>
      <p className="etiqueta">Cómo funciona cada motor de datos {feed ? `· ${feed.simbolo}` : ''}</p>
      <div className="grid gap-4 xl:grid-cols-2">
        {MOTORES.map((m) => (
          <TarjetaMotor key={m.id} m={m} vivo={m.vivo(feed)} />
        ))}
      </div>
    </div>
  );
}
