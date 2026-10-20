import { motion } from 'framer-motion';
import { Database, HardDrive, Radio, Rows3, Timer, Waves } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { Estado } from '@/components/ui/Punto';
import Insignia from '@/components/ui/Insignia';
import ContadorAnimado from '@/components/ui/ContadorAnimado';
import Sparkline from '@/components/charts/Sparkline';
import { useSistema } from '@/hooks/SistemaDemo';
import { FEATURES } from '@/data/mock';
import type { EstadoMercado } from '@/lib/simulacion';
import { conSigno, num, pct } from '@/lib/format';

/** Valor actual de cada Feature, derivado del mercado DEMO. */
function valorFeature(nombre: string, m: EstadoMercado) {
  const ultimas = m.barras.slice(-21, -1);
  const vols = ultimas.map((b) => b.compra + b.venta);
  const media = vols.reduce((a, v) => a + v, 0) / Math.max(vols.length, 1);
  const ultima = m.barras[m.barras.length - 2];
  switch (nombre) {
    case 'CVD Delta':
      return `${conSigno(m.cvd, 0)} BTC`;
    case 'VWAP (distancia σ)':
      return `${conSigno((m.precio - m.vwap) / (m.atr * 0.9), 2)}σ`;
    case 'Absorción':
      return num(Math.min(1, Math.abs(ultima.compra - ultima.venta) < 1 ? 0.72 : 0.31), 2);
    case 'ATR':
      return `${num(m.atr, 1)} USD`;
    case 'Open Interest (Δ)':
      return `${conSigno(((m.oi - 81_240) / 81_240) * 100, 2, '%')}`;
    case 'Agotamiento':
      return num(Math.max(0, 1 - Math.abs(ultima.compra - ultima.venta) / 6), 2);
    case 'Volumen relativo':
      return `${num((ultima.compra + ultima.venta) / media, 2)}×`;
    case 'Desequilibrio del libro':
      return num(ultima.compra / Math.max(ultima.venta, 0.1), 2);
    default:
      return '—';
  }
}

export default function DatosView() {
  const { mercado } = useSistema();
  const ritmo = mercado.ritmo[mercado.ritmo.length - 1];

  const etapas = [
    { t: 'Binance USD-M', d: `BTCUSDT · ${mercado.latenciaMs} ms`, icono: Radio },
    { t: 'Recorder', d: 'trades + libro L2', icono: HardDrive },
    { t: 'Dollar bars', d: '1 M USD por barra', icono: Rows3 },
    { t: 'Features', d: `${FEATURES.length} en tiempo real`, icono: Waves },
  ];

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Datos"
        titulo="Recorder y pipeline de Features"
        descripcion="La única fuente de aprendizaje es el mercado: el feed de Binance USD-M Futures se graba, se agrega en dollar bars y se transforma en Features. Nada de vídeos, repositorios ni artículos."
      >
        <Estado estado={mercado.grabando ? 'activo' : 'detenido'} texto={mercado.grabando ? 'Grabando' : 'Detenido'} />
      </Encabezado>

      <Panel cuerpo="overflow-x-auto px-4 py-5">
        <div className="flex min-w-[640px] items-center">
          {etapas.map((e, i) => {
            const Icono = e.icono;
            return (
              <div key={e.t} className="flex flex-1 items-center last:flex-none">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-borde bg-white/[0.03]">
                    <Icono size={17} strokeWidth={1.4} className="text-plata-100" />
                  </div>
                  <div>
                    <p className="text-xs text-white">{e.t}</p>
                    <p className="cifra text-[10px] text-plata-500">{e.d}</p>
                  </div>
                </div>
                {i < etapas.length - 1 && (
                  <div className="relative mx-4 h-px flex-1 bg-white/10">
                    {[0, 1, 2, 3].map((k) => (
                      <motion.span
                        key={k}
                        className="absolute -top-[1.5px] h-[4px] w-[4px] rounded-full bg-white"
                        animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 1.4, repeat: Infinity, delay: k * 0.35 + i * 0.2, ease: 'linear' }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi etiqueta="Dollar bars · sesión" valor={<ContadorAnimado valor={mercado.dollarBars} />} />
        <Kpi etiqueta="Ritmo actual" valor={`${num(ritmo, 0)} /min`} />
        <Kpi etiqueta="Gaps detectados" valor={String(mercado.gaps)} nota="últimas 24 h" />
        <Kpi etiqueta="Latencia del feed" valor={`${mercado.latenciaMs} ms`} />
        <Kpi etiqueta="Almacenado" valor="2,8 TB" nota="desde el 01-may" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel titulo="Throughput de ingestión · dollar bars por minuto" icono={Timer} accion={<span className="cifra text-[10px] text-plata-500">ventanas de 10 s · últimos 5 min</span>}>
          <div className="flex gap-3">
            <div className="flex flex-col justify-between py-1 font-mono text-[9.5px] text-plata-500">
              <span>{num(Math.max(...mercado.ritmo), 0)}</span>
              <span>{num(Math.min(...mercado.ritmo), 0)}</span>
            </div>
            <div className="flex-1">
              <Sparkline datos={mercado.ritmo} alto={150} grosor={1.3} />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-plata-500">Cada dollar bar agrupa 1 M USD negociados; el ritmo sube con el volumen, no con el reloj.</p>
        </Panel>

        <Panel titulo="Últimas dollar bars" icono={Database} cuerpo="px-4 py-2">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
                <th className="py-2 font-normal">#</th>
                <th className="py-2 font-normal">Compras</th>
                <th className="py-2 font-normal">Ventas</th>
                <th className="py-2 text-right font-normal">Delta</th>
              </tr>
            </thead>
            <tbody>
              {mercado.barras
                .slice(-9, -1)
                .reverse()
                .map((b, i) => (
                  <motion.tr key={mercado.dollarBars - i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-borde-suave">
                    <td className="cifra py-1.5 text-plata-500">{num(mercado.dollarBars - i)}</td>
                    <td className="cifra py-1.5 text-plata-200">{num(b.compra, 2)} BTC</td>
                    <td className="cifra py-1.5 text-plata-200">{num(b.venta, 2)} BTC</td>
                    <td className="cifra py-1.5 text-right text-white">{conSigno(b.compra - b.venta, 2)}</td>
                  </motion.tr>
                ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel titulo="Features · importancia y valor actual" icono={Waves} accion={<Insignia variante="tenue">Importancia SHAP media</Insignia>} cuerpo="overflow-x-auto px-4 py-2">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
              <th className="py-2.5 font-normal">Feature</th>
              <th className="py-2.5 font-normal">Descripción</th>
              <th className="w-[22%] py-2.5 font-normal">Importancia</th>
              <th className="py-2.5 font-normal">Ventana</th>
              <th className="py-2.5 font-normal">Cálculo</th>
              <th className="py-2.5 text-right font-normal">Valor actual</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f, i) => (
              <tr key={f.nombre} className="border-t border-borde-suave">
                <td className="py-3 text-white">{f.nombre}</td>
                <td className="py-3 pr-4 text-plata-400">{f.descripcion}</td>
                <td className="py-3 pr-6">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div className="h-full rounded-full bg-plata-200" initial={{ width: 0 }} animate={{ width: `${(f.importancia / FEATURES[0].importancia) * 100}%` }} transition={{ duration: 1, delay: i * 0.06 }} />
                    </div>
                    <span className="cifra w-12 text-right text-plata-300">{pct(f.importancia, 1)}</span>
                  </div>
                </td>
                <td className="py-3 text-plata-400">{f.ventana}</td>
                <td className="cifra py-3 text-plata-400">{num(f.calculoMs, 1)} ms</td>
                <td className="cifra py-3 text-right text-white">{valorFeature(f.nombre, mercado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Kpi({ etiqueta, valor, nota }: { etiqueta: string; valor: React.ReactNode; nota?: string }) {
  return (
    <div className="panel p-4">
      <p className="etiqueta">{etiqueta}</p>
      <p className="cifra mt-2 text-xl font-light text-white">{valor}</p>
      {nota && <p className="mt-1 text-[10px] text-plata-500">{nota}</p>}
    </div>
  );
}
