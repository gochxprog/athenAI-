import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Database, MousePointerClick, Network } from 'lucide-react';
import Constelacion from '@/components/three/Constelacion';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import PanelLateral from '@/components/ui/PanelLateral';
import Insignia from '@/components/ui/Insignia';
import Barra from '@/components/ui/Barra';
import Punto from '@/components/ui/Punto';
import { HIPOTESIS, MODELOS, RELACIONES_HIPOTESIS, TEMAS, type EstadoHipotesis, type Tema } from '@/data/mock';
import { useSistema } from '@/hooks/SistemaDemo';
import { num, pct } from '@/lib/format';

function insigniaEstado(e: EstadoHipotesis) {
  if (e === 'Aprobada') return <Insignia variante="solida">Aprobada</Insignia>;
  if (e === 'Rechazada') return <Insignia variante="tachada">Rechazada</Insignia>;
  if (e === 'En prueba') return <Insignia variante="contorno">En prueba</Insignia>;
  return <Insignia variante="tenue">{e}</Insignia>;
}

export default function InvestigacionView() {
  const { motor } = useSistema();
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [tema, setTema] = useState<Tema | null>(null);
  const [estados, setEstados] = useState<Record<string, EstadoHipotesis>>({});
  const [enviadas, setEnviadas] = useState<string[]>([]);

  const h = HIPOTESIS.find((x) => x.id === seleccion) ?? null;
  const estadoDe = (id: string) => estados[id] ?? HIPOTESIS.find((x) => x.id === id)!.estado;
  const relacionadas = useMemo(
    () => (h ? RELACIONES_HIPOTESIS.filter(([a, b]) => a === h.id || b === h.id).map(([a, b]) => (a === h.id ? b : a)) : []),
    [h],
  );
  const lista = HIPOTESIS.filter((x) => !tema || x.tema === tema);

  const enviar = (id: string) => {
    setEstados((s) => ({ ...s, [id]: 'En cola' }));
    setEnviadas((s) => [...s, id]);
  };

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Investigación"
        titulo="Red de hipótesis"
        descripcion="Cada nodo es una hipótesis propuesta por los modelos a partir de los datos de mercado y Order Flow. Las líneas unen hipótesis que comparten Features; las señales muestran qué se está cruzando ahora."
      >
        <Insignia variante="tenue">{HIPOTESIS.length} en el mapa</Insignia>
        <Insignia variante="contorno">{num(motor.hipotesis)} generadas</Insignia>
      </Encabezado>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel cuerpo="p-0" className="overflow-hidden">
          <div className="relative h-[460px] md:h-[560px]">
            <div className="absolute inset-0 rejilla-fondo opacity-60" />
            <Constelacion estados={estados} seleccion={seleccion} temaActivo={tema} onSeleccion={setSeleccion} />
            <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 text-[10px] uppercase tracking-etiqueta text-plata-400">
              <Network size={12} /> Constelación de hipótesis · capas activándose en ondas
            </div>
            <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 text-[10px] text-plata-500">
              <MousePointerClick size={12} /> Haz clic en un nodo · arrastra para girar
            </div>
            <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 text-[10px] text-plata-400">
              <Leyenda simbolo={<span className="h-2 w-2 rounded-full bg-white" />} texto="Aprobada (con anillo)" />
              <Leyenda simbolo={<span className="h-2 w-2 rounded-full bg-plata-300" />} texto="En prueba (pulsa) / en cola" />
              <Leyenda simbolo={<span className="h-2 w-2 rounded-full border border-plata-400" />} texto="Rechazada (hueca)" />
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel titulo="Temas" cuerpo="p-2">
            <button onClick={() => setTema(null)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${tema === null ? 'bg-white/[0.07] text-white' : 'text-plata-400 hover:bg-white/[0.03]'}`}>
              Todos <span className="cifra text-plata-500">{HIPOTESIS.length}</span>
            </button>
            {TEMAS.map((t) => {
              const del = HIPOTESIS.filter((x) => x.tema === t);
              const aprob = del.filter((x) => estadoDe(x.id) === 'Aprobada').length;
              return (
                <button key={t} onClick={() => setTema(tema === t ? null : t)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${tema === t ? 'bg-white/[0.07] text-white' : 'text-plata-300 hover:bg-white/[0.03]'}`}>
                  <span>{t}</span>
                  <span className="cifra text-[10px] text-plata-500">
                    {aprob} aprob. · {del.length}
                  </span>
                </button>
              );
            })}
          </Panel>

          <Panel titulo="Hipótesis" cuerpo="max-h-[340px] overflow-y-auto p-2">
            {lista.map((x) => (
              <button key={x.id} onClick={() => setSeleccion(x.id)} className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${seleccion === x.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-plata-500">{x.id}</span>
                  {insigniaEstado(estadoDe(x.id))}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-plata-200">{x.titulo}</p>
              </button>
            ))}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {MODELOS.map((m) => {
          const propias = HIPOTESIS.filter((x) => x.modelo === m.id);
          return (
            <Panel key={m.id} titulo={`${m.id} · ${m.familia}`} accion={<Punto estado="activo" />}>
              <p className="text-[11px] text-plata-500">{m.tipo} · vive en {m.ubicacion === 'Cerebro' ? 'el Cerebro (esfera)' : 'el Laboratorio'}</p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <p className="etiqueta">En mapa</p>
                  <p className="cifra mt-1 text-lg text-white">{propias.length}</p>
                </div>
                <div>
                  <p className="etiqueta">Aprobadas</p>
                  <p className="cifra mt-1 text-lg text-white">{propias.filter((x) => estadoDe(x.id) === 'Aprobada').length}</p>
                </div>
                <div>
                  <p className="etiqueta">AUC</p>
                  <p className="cifra mt-1 text-lg text-white">{num(m.auc, 3)}</p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      <PanelLateral abierto={!!h} onCerrar={() => setSeleccion(null)} subtitulo={h ? `${h.id} · ${h.tema}` : ''} titulo={h?.titulo ?? ''}>
        {h && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {insigniaEstado(estadoDe(h.id))}
              <Insignia variante="tenue">Propuesta por {h.modelo}</Insignia>
            </div>

            <section>
              <p className="etiqueta mb-2 flex items-center gap-1.5">
                <Database size={11} /> Evidencia en los datos
              </p>
              <p className="text-[13px] leading-relaxed text-plata-200">{h.evidencia}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-borde-suave p-3">
                <div>
                  <p className="etiqueta">Ocurrencias</p>
                  <p className="cifra mt-1 text-white">{num(h.ocurrencias)}</p>
                </div>
                <div>
                  <p className="etiqueta">Ventana</p>
                  <p className="cifra mt-1 text-white">{h.ventana}</p>
                </div>
              </div>
            </section>

            <section>
              <p className="etiqueta mb-2">Highlights técnicos</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['VWAP', h.highlights.vwap],
                  ['ATR', h.highlights.atr],
                  ['Delta', h.highlights.delta],
                  ['Volumen', h.highlights.volumen],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-borde-suave bg-white/[0.02] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">{k}</p>
                    <p className="cifra mt-0.5 text-[13px] text-white">{v}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="etiqueta">Confianza del modelo</span>
                <span className="cifra text-white">{pct(h.confianza, 0)}</span>
              </div>
              <Barra valor={h.confianza * 100} marca={50} />
              <p className="mt-1.5 text-[10px] text-plata-500">La confianza del modelo no aprueba nada: solo el Juez decide.</p>
            </section>

            {relacionadas.length > 0 && (
              <section>
                <p className="etiqueta mb-2">Relacionadas</p>
                <div className="flex flex-wrap gap-1.5">
                  {relacionadas.map((id) => (
                    <button key={id} onClick={() => setSeleccion(id)} className="rounded border border-borde px-2 py-1 font-mono text-[10px] text-plata-300 transition-colors hover:border-plata-400 hover:text-white">
                      {id}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <AnimatePresence mode="wait">
              {enviadas.includes(h.id) ? (
                <motion.div key="ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-lg border border-plata-400 px-3 py-3 text-xs text-white">
                  <Check size={14} /> Enviada al Laboratorio · en cola del Juez (posición {motor.cola + 1})
                </motion.div>
              ) : (
                <motion.button
                  key="btn"
                  whileTap={{ scale: 0.98 }}
                  disabled={['Aprobada', 'Rechazada', 'En prueba', 'En cola'].includes(estadoDe(h.id))}
                  onClick={() => enviar(h.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-xs font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Enviar al Laboratorio <ArrowRight size={14} />
                </motion.button>
              )}
            </AnimatePresence>
            {['Aprobada', 'Rechazada', 'En prueba', 'En cola'].includes(estadoDe(h.id)) && !enviadas.includes(h.id) && (
              <p className="-mt-3 text-center text-[10px] text-plata-500">Esta hipótesis ya pasó por el Laboratorio o está en él.</p>
            )}
          </div>
        )}
      </PanelLateral>
    </div>
  );
}

function Leyenda({ simbolo, texto }: { simbolo: React.ReactNode; texto: string }) {
  return (
    <span className="flex items-center gap-2">
      {simbolo}
      {texto}
    </span>
  );
}
