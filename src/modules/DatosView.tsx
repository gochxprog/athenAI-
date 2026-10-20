import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Database, FolderOpen, KeyRound, Play, Plus, Radio, RefreshCw, ScrollText, Server, Square, Trash2, Waves, X, FlaskConical, Download } from 'lucide-react';
import { useNavegar } from '@/hooks/Navegacion';
import { DEFINICIONES_FEATURES } from '@/motores/nucleo/features';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Punto, { Estado } from '@/components/ui/Punto';
import Insignia from '@/components/ui/Insignia';
import { NOMBRE_PROVEEDOR, useFeeds } from '@/components/orderflow/OrderFlowChart';
import { descargarCsv, motorOrderFlow } from '@/motores/worker/motorCliente';
import { GATEWAYS_RITHMIC, SISTEMAS_RITHMIC } from '@/motores/fuentes/rithmicPuente';
import type { ConfigCentro, EstadoFeed, Proveedor, ResumenSimbolo } from '@/motores/worker/protocolo';
import { hora, num } from '@/lib/format';

const MAX_ACTIVOS = 6;

const PROVEEDORES: { id: Proveedor; icono: typeof Radio; nota: string; descripcion: string; sugeridos: string[] }[] = [
  {
    id: 'binance',
    icono: Radio,
    nota: 'Por defecto · datos públicos',
    descripcion: 'Futuros perpetuos USD-M: aggTrades, libro L2 sincronizado y Open Interest. No necesita API key para datos de mercado.',
    sugeridos: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
  },
  {
    id: 'rithmic',
    icono: KeyRound,
    nota: 'CME · COMEX · NYMEX',
    descripcion: 'Futuros regulados (ES, NQ, CL, GC…) con tus credenciales de Rithmic, a través del puente R|Protocol de tu VPS.',
    sugeridos: ['ESZ6', 'NQZ6', 'MESZ6', 'MNQZ6', 'CLZ6', 'GCZ6'],
  },
  {
    id: 'urus',
    icono: Server,
    nota: 'SSE',
    descripcion: 'Tu servidor de Urus: recibe trades y la vista del libro ya calculada por su OrderBookEngine.',
    sugeridos: ['BTCUSDT', 'ETHUSDT'],
  },
  {
    id: 'simulacion',
    icono: FlaskConical,
    nota: 'Solo pruebas',
    descripcion: 'Mercado sintético calibrado a BTC. Sirve para probar la plataforma; nunca se mezcla con datos reales.',
    sugeridos: ['BTCUSDT'],
  },
];

const ESTADO_TEXTO: Record<string, string> = {
  conectando: 'Conectando',
  'en-vivo': 'En vivo',
  reconectando: 'Reconectando',
  'sin-datos': 'Sin datos',
  error: 'Error',
  detenido: 'Detenido',
};

const puntoDe = (c: string) => (c === 'en-vivo' ? 'activo' : c === 'error' || c === 'detenido' ? 'detenido' : 'espera');

const usdCorto = (v: number) => (v >= 1e6 ? `${num(v / 1e6, v % 1e6 ? 1 : 0)} M` : `${num(v / 1e3)} mil`);

export default function DatosView() {
  const navegar = useNavegar();
  const { feeds, registro } = useFeeds();
  const [borrador, setBorrador] = useState<ConfigCentro>(motorOrderFlow.config);
  const [recordar, setRecordar] = useState(motorOrderFlow.guardada.recordarContrasena);
  const [nuevoActivo, setNuevoActivo] = useState('');
  const [aplicado, setAplicado] = useState(motorOrderFlow.config);

  const cambios = useMemo(() => JSON.stringify(borrador) !== JSON.stringify(aplicado), [borrador, aplicado]);
  const prov = PROVEEDORES.find((p) => p.id === borrador.proveedor)!;
  const enVivo = feeds.feeds.filter((f) => f.conexion === 'en-vivo').length;

  const set = <K extends keyof ConfigCentro>(k: K, v: ConfigCentro[K]) => setBorrador((b) => ({ ...b, [k]: v }));
  const agregar = (s: string) => {
    const x = s.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
    if (!x || borrador.simbolos.includes(x) || borrador.simbolos.length >= MAX_ACTIVOS) return;
    set('simbolos', [...borrador.simbolos, x]);
    setNuevoActivo('');
  };
  const elegirProveedor = (id: Proveedor) => {
    if (id === borrador.proveedor) return;
    const p = PROVEEDORES.find((x) => x.id === id)!;
    // Los símbolos de una fuente no valen en otra (BTCUSDT no existe en Rithmic): se proponen los típicos.
    const validos = borrador.simbolos.filter((s) => p.sugeridos.includes(s));
    setBorrador((b) => ({ ...b, proveedor: id, simbolos: validos.length ? validos : [p.sugeridos[0]] }));
  };
  const aplicar = () => {
    motorOrderFlow.aplicar(borrador, recordar);
    setAplicado(borrador);
  };

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Datos"
        titulo="Centro de datos"
        fuente={feeds.proveedor ? NOMBRE_PROVEEDOR[feeds.proveedor].toUpperCase() : 'SIN FUENTE'}
        descripcion="Elige de dónde aprende athenAI y qué activos. Al aplicar, el pipeline se limpia y los motores empiezan desde cero con la fuente nueva. Cada fuente guarda sus Features en su propia carpeta: nunca se mezclan."
      >
        <Estado estado={enVivo ? 'activo' : feeds.feeds.length ? 'espera' : 'detenido'} texto={feeds.proveedor ? `${NOMBRE_PROVEEDOR[feeds.proveedor]} · ${enVivo}/${feeds.feeds.length} en vivo` : 'Sin fuente'} />
      </Encabezado>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel titulo="Fuente de datos" icono={Database} accion={<span className="text-[10px] text-plata-500">una fuente activa a la vez</span>}>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Fuente de datos">
            {PROVEEDORES.map((p) => {
              const Icono = p.icono;
              const sel = borrador.proveedor === p.id;
              const activo = feeds.proveedor === p.id;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={sel}
                  onClick={() => elegirProveedor(p.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${sel ? 'border-white bg-white/[0.06]' : 'border-borde hover:border-plata-400'}`}
                >
                  <div className="flex items-center gap-2">
                    <Icono size={14} className={sel ? 'text-white' : 'text-plata-400'} />
                    <span className="text-xs text-white">{NOMBRE_PROVEEDOR[p.id]}</span>
                    {activo && <Punto estado={enVivo ? 'activo' : 'espera'} className="ml-auto" />}
                  </div>
                  <p className="mt-1 text-[9.5px] uppercase tracking-[0.12em] text-plata-500">{p.nota}</p>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-plata-400">{p.descripcion}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-borde-suave pt-4">
            {borrador.proveedor === 'binance' && (
              <div className="space-y-3">
                <p className="text-[11px] text-plata-300">Binance publica el mercado de futuros sin autenticación. Las claves de API solo harán falta para enviar órdenes, no para aprender.</p>
                <details className="text-[11px] text-plata-400">
                  <summary className="cursor-pointer select-none text-plata-300">Endpoints (avanzado)</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Campo etiqueta="REST" valor={borrador.binance.rest} onChange={(v) => set('binance', { ...borrador.binance, rest: v })} />
                    <Campo etiqueta="WebSocket" valor={borrador.binance.ws} onChange={(v) => set('binance', { ...borrador.binance, ws: v })} />
                  </div>
                </details>
              </div>
            )}
            {borrador.proveedor === 'rithmic' && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Campo etiqueta="Usuario" valor={borrador.rithmic.usuario} onChange={(v) => set('rithmic', { ...borrador.rithmic, usuario: v })} autoComplete="username" />
                  <Campo etiqueta="Contraseña" tipo="password" valor={borrador.rithmic.contrasena} onChange={(v) => set('rithmic', { ...borrador.rithmic, contrasena: v })} autoComplete="current-password" />
                  <Selector etiqueta="Sistema" valor={borrador.rithmic.sistema} opciones={SISTEMAS_RITHMIC} onChange={(v) => set('rithmic', { ...borrador.rithmic, sistema: v })} />
                  <Selector etiqueta="Gateway" valor={borrador.rithmic.gateway} opciones={GATEWAYS_RITHMIC} onChange={(v) => set('rithmic', { ...borrador.rithmic, gateway: v })} />
                  <div className="sm:col-span-2">
                    <Campo etiqueta="URL del puente R|Protocol" valor={borrador.rithmic.puente} onChange={(v) => set('rithmic', { ...borrador.rithmic, puente: v })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-plata-300">
                  <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} className="accent-white" />
                  Recordar la contraseña en este equipo
                </label>
                <p className="rounded-lg border border-borde-suave bg-white/[0.02] p-2.5 text-[10.5px] leading-relaxed text-plata-400">
                  Rithmic no acepta conexiones directas desde un navegador: su API exige un cliente certificado. athenAI envía las credenciales una vez a tu puente (servicio en tu VPS) y el puente re-publica el mercado con el protocolo de Urus. Sin puente verás el error en el feed.
                </p>
              </div>
            )}
            {borrador.proveedor === 'urus' && <Campo etiqueta="URL del servidor de Urus" valor={borrador.urus.baseUrl} onChange={(v) => set('urus', { baseUrl: v })} />}
            {borrador.proveedor === 'simulacion' && (
              <p className="text-[11px] text-plata-300">Genera un mercado sintético con icebergs, stop runs, pools y bloques grandes. Sus Features se guardan aparte, en la carpeta de Simulación, y no deben usarse para entrenar modelos de producción.</p>
            )}
          </div>
        </Panel>

        <Panel titulo="Activos que aprende" icono={Waves} accion={<span className="cifra text-[10px] text-plata-500">{borrador.simbolos.length} / {MAX_ACTIVOS}</span>}>
          <div className="flex flex-wrap gap-1.5">
            {borrador.simbolos.map((s) => (
              <span key={s} className="flex items-center gap-1 rounded-md border border-plata-400 px-2 py-1 font-mono text-[11px] text-white">
                {s}
                <button onClick={() => set('simbolos', borrador.simbolos.filter((x) => x !== s))} aria-label={`Quitar ${s}`} className="text-plata-400 hover:text-white">
                  <X size={11} />
                </button>
              </span>
            ))}
            {!borrador.simbolos.length && <span className="text-[11px] text-plata-500">Añade al menos un activo.</span>}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              agregar(nuevoActivo);
            }}
          >
            <input
              value={nuevoActivo}
              onChange={(e) => setNuevoActivo(e.target.value)}
              placeholder={prov.sugeridos[0]}
              aria-label="Nuevo activo"
              className="min-w-0 flex-1 rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] uppercase text-plata-100 outline-none placeholder:text-plata-600 focus:border-plata-400"
            />
            <button type="submit" disabled={borrador.simbolos.length >= MAX_ACTIVOS} className="flex items-center gap-1 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 hover:border-plata-400 disabled:opacity-40">
              <Plus size={12} /> Añadir
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1">
            {prov.sugeridos
              .filter((s) => !borrador.simbolos.includes(s))
              .map((s) => (
                <button key={s} onClick={() => agregar(s)} className="rounded border border-borde-suave px-1.5 py-0.5 font-mono text-[10px] text-plata-400 hover:border-plata-400 hover:text-white">
                  + {s}
                </button>
              ))}
          </div>

          <label className="mt-4 flex items-start gap-2 text-[11px] text-plata-300">
            <input type="checkbox" checked={borrador.guardar} onChange={(e) => set('guardar', e.target.checked)} className="mt-0.5 accent-white" />
            <span>
              Guardar las Features en la carpeta <span className="font-mono text-plata-100">athenai-{borrador.proveedor}</span>
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-borde-suave pt-4">
            <button onClick={aplicar} disabled={!borrador.simbolos.length} className="flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black disabled:opacity-40">
              <Play size={13} /> Aplicar y empezar a aprender
            </button>
            <button onClick={() => motorOrderFlow.detener()} className="flex items-center gap-1.5 rounded-lg border border-borde px-3 py-2 text-xs text-plata-200 hover:border-plata-400">
              <Square size={12} /> Detener
            </button>
            {cambios && <span className="text-[10.5px] text-plata-400">Cambios sin aplicar · al aplicar se limpia el pipeline</span>}
          </div>
        </Panel>
      </div>

      <Feeds feeds={feeds.feeds} visible={feeds.visible} enCola={feeds.enCola} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Almacenamiento activo={feeds.proveedor} />
        <Panel titulo="Registro de cambios" icono={ScrollText} cuerpo="max-h-[340px] overflow-y-auto px-4 py-2">
          {!registro.length && <p className="py-6 text-center text-xs text-plata-500">Sin cambios todavía.</p>}
          {registro.map((r, i) => (
            <p key={`${r.t}-${i}`} className="border-b border-borde-suave py-1.5 text-[11px] last:border-0">
              <span className="cifra mr-2 text-plata-500">{hora(new Date(r.t))}</span>
              <span className="text-plata-200">{r.texto}</span>
            </p>
          ))}
        </Panel>
      </div>

      <Panel titulo="Pipeline de Features de los motores de Urus" icono={Waves} accion={<Insignia variante="contorno">{DEFINICIONES_FEATURES.length} Features</Insignia>}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-3xl text-xs leading-relaxed text-plata-300">
            Absorción, agotamiento, imbalances, big trades, CVD de sesión, Open Interest, pools de liquidez (LHM), icebergs y stop runs se calculan por cada dollar bar del activo (≈ 2.000 barras al día según su volumen), sin mirar al futuro. Es la tabla que aprenderán los modelos.
          </p>
          <button onClick={() => navegar('orderflow')} className="flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black">
            Ver en Order Flow <ArrowRight size={13} />
          </button>
        </div>
      </Panel>
    </div>
  );
}

function Feeds({ feeds, visible, enCola }: { feeds: EstadoFeed[]; visible: string | null; enCola: number }) {
  const navegar = useNavegar();
  return (
    <Panel titulo="Feeds por activo" icono={Radio} accion={<span className="cifra text-[10px] text-plata-500">{enCola ? `${num(enCola)} filas por escribir` : 'actualiza cada segundo'}</span>} cuerpo="overflow-x-auto px-4 py-2">
      {!feeds.length && <p className="py-6 text-center text-xs text-plata-500">Sin fuente activa. Elige una y pulsa «Aplicar».</p>}
      {!!feeds.length && (
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
              <th className="py-2 font-normal">Activo</th>
              <th className="py-2 font-normal">Estado</th>
              <th className="py-2 text-right font-normal">Precio</th>
              <th className="py-2 text-right font-normal">Trades/s</th>
              <th className="py-2 text-right font-normal">Latencia</th>
              <th className="py-2 text-right font-normal">Tick</th>
              <th className="py-2 text-right font-normal">Dollar bar</th>
              <th className="py-2 text-right font-normal">Filas</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {feeds.map((f) => (
              <tr key={f.simbolo} className="border-t border-borde-suave" data-feed={f.simbolo}>
                <td className="py-2 font-mono text-white">{f.simbolo}</td>
                <td className="max-w-[280px] py-2">
                  <span className="flex items-center gap-1.5 text-plata-200">
                    <Punto estado={puntoDe(f.conexion)} />
                    <span data-estado>{ESTADO_TEXTO[f.conexion] ?? f.conexion}</span>
                  </span>
                  {f.detalle && <span className="block truncate text-[10px] text-plata-500" title={f.detalle}>{f.detalle}</span>}
                </td>
                <td className="cifra py-2 text-right text-plata-100">{f.precio === null ? '—' : num(f.precio, f.tickSize < 1 ? Math.min(6, Math.max(0, Math.round(-Math.log10(f.tickSize)))) : 0)}</td>
                <td className="cifra py-2 text-right text-plata-200">{num(f.tradesPorSeg, 1)}</td>
                <td className="cifra py-2 text-right text-plata-200">{f.latenciaMs === null ? '—' : `${num(f.latenciaMs)} ms`}</td>
                <td className="cifra py-2 text-right text-plata-400">{f.calibrado ? f.tickSize : '…'}</td>
                <td className="cifra py-2 text-right text-plata-400">{f.calibrado ? `${usdCorto(f.dollarBarUsd)} USD` : 'calibrando'}</td>
                <td className="cifra py-2 text-right text-white">{num(f.filas)}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => {
                      motorOrderFlow.ver(f.simbolo);
                      navegar('orderflow');
                    }}
                    className={`rounded border px-2 py-0.5 text-[10px] ${visible === f.simbolo ? 'border-plata-300 text-white' : 'border-borde text-plata-400 hover:text-white'}`}
                  >
                    Ver gráfico
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Almacenamiento({ activo }: { activo: Proveedor | null }) {
  const [resumen, setResumen] = useState<Record<Proveedor, ResumenSimbolo[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const refrescar = useCallback(() => {
    motorOrderFlow.resumenAlmacen().then(
      (r) => {
        setResumen(r);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    refrescar();
    const id = setInterval(refrescar, 5_000);
    return () => clearInterval(id);
  }, [refrescar]);

  const exportar = async (p: Proveedor, s: string) => {
    setOcupado(`${p}:${s}`);
    try {
      const { csv } = await motorOrderFlow.exportarAlmacen(p, s);
      descargarCsv(csv, `athenai-${p}-${s}-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally {
      setOcupado(null);
    }
  };
  const borrar = async (p: Proveedor) => {
    if (!window.confirm(`¿Borrar todas las Features guardadas de ${NOMBRE_PROVEEDOR[p]}? Las demás fuentes no se tocan.`)) return;
    setOcupado(p);
    try {
      await motorOrderFlow.borrarAlmacen(p);
      refrescar();
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Panel
      titulo="Almacenamiento por fuente"
      icono={FolderOpen}
      accion={
        <button onClick={refrescar} className="flex items-center gap-1 text-[10px] text-plata-400 hover:text-white" aria-label="Actualizar almacenamiento">
          <RefreshCw size={11} /> actualizar
        </button>
      }
      cuerpo="space-y-3 p-4"
    >
      <p className="text-[10.5px] text-plata-500">Una base de datos por fuente en este navegador (IndexedDB). Exporta a CSV para entrenar fuera o para subirlo a tu VPS.</p>
      {error && <p className="text-[11px] text-plata-300">No se pudo leer el almacenamiento: {error}</p>}
      {PROVEEDORES.map((p) => {
        const filas = resumen?.[p.id] ?? [];
        const total = filas.reduce((a, r) => a + r.filas, 0);
        return (
          <div key={p.id} className="rounded-lg border border-borde-suave p-3" data-carpeta={p.id}>
            <div className="flex items-center gap-2">
              <FolderOpen size={13} className="text-plata-400" />
              <span className="font-mono text-[11px] text-white">athenai-{p.id}</span>
              <span className="text-[10px] text-plata-500">· {NOMBRE_PROVEEDOR[p.id]}</span>
              {activo === p.id && <Insignia variante="solida">activa</Insignia>}
              <span className="cifra ml-auto text-[10.5px] text-plata-300">{num(total)} filas</span>
              <button onClick={() => borrar(p.id)} disabled={!total || ocupado === p.id} aria-label={`Borrar carpeta ${p.id}`} className="text-plata-500 hover:text-white disabled:opacity-30">
                <Trash2 size={12} />
              </button>
            </div>
            {!!filas.length && (
              <div className="mt-2 space-y-1">
                {filas.map((r) => (
                  <div key={r.simbolo} className="flex items-center gap-2 text-[10.5px]">
                    <span className="w-24 font-mono text-plata-200">{r.simbolo}</span>
                    <span className="cifra w-20 text-right text-plata-300">{num(r.filas)}</span>
                    <span className="cifra hidden flex-1 text-plata-500 sm:block">
                      {r.desde ? `${new Date(r.desde).toLocaleString('es-ES')} → ${new Date(r.hasta!).toLocaleString('es-ES')}` : '—'} · {r.sesiones} {r.sesiones === 1 ? 'sesión' : 'sesiones'}
                    </span>
                    <button onClick={() => exportar(p.id, r.simbolo)} disabled={!r.filas || ocupado === `${p.id}:${r.simbolo}`} className="ml-auto flex items-center gap-1 rounded border border-borde px-1.5 py-0.5 text-plata-300 hover:text-white disabled:opacity-30">
                      <Download size={10} /> CSV
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function Campo({ etiqueta, valor, onChange, tipo = 'text', autoComplete }: { etiqueta: string; valor: string; onChange: (v: string) => void; tipo?: string; autoComplete?: string }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      <input
        type={tipo}
        value={valor}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400"
      />
    </label>
  );
}

function Selector({ etiqueta, valor, opciones, onChange }: { etiqueta: string; valor: string; opciones: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100 outline-none focus:border-plata-400">
        {opciones.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
