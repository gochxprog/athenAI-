// Sala de agentes (v2): la sala 3D con los 10 puestos y, en la pared del fondo, la pantalla gigante con las velas
// de 1 min de cada mercado, la radio de lo que hacen los agentes y las cifras del día. Todo sale del VPS (24/7):
// un agente solo se enciende si su motor está trabajando ahí de verdad.
import { lazy, Suspense, useEffect, useState } from 'react';
import { AGENTES, CAPAS, ESTILO_AGENTE, type AgenteId } from '@/data/agentes';
import type { DatosMuro, VelaMuro } from '@/components/three/muro';
import { pedir } from '../../api';
import { dinero } from '../../formato';
import { deHoy, useVps, type Vps } from '../../vps';
import '../../tw.css';
import './agentes.css';

const Sala = lazy(() => import('@/components/three/SalaAgentes3D'));
const nombre = (id: AgenteId) => AGENTES.find((a) => a.id === id)!.nombre;
const color = (id: AgenteId) => ESTILO_AGENTE[id].color;

/** Velas de 1 min de la última hora de cada mercado (historia + grabado del VPS), cada 15 s. */
function useVelas(simbolos: string[]) {
  const [velas, setVelas] = useState<Record<string, VelaMuro[]>>({});
  const clave = simbolos.join();
  useEffect(() => {
    if (!clave) return;
    const traer = () =>
      clave.split(',').forEach((s) =>
        pedir<{ velas: number[][] }>(`/api/velas?simbolo=${s}&serie=1m&n=60`)
          .then((r) => setVelas((x) => ({ ...x, [s]: r.velas.map(([, o, h, l, c, v]) => ({ o, h, l, c, v })) })))
          .catch(() => undefined),
      );
    traer();
    const id = setInterval(traer, 15_000);
    return () => clearInterval(id);
  }, [clave]);
  return velas;
}

/** Qué hace ahora cada agente en el VPS (los que aún no viven ahí, en qué fase llegan). */
function lecturas(v: Vps): { estados: Record<AgenteId, string>; activos: Record<AgenteId, boolean> } {
  const vivos = v.mercados.filter((m) => m.conexion === 'en-vivo').length;
  const activos = v.bots.filter((b) => b.estado === 'activo').length;
  const enPosicion = v.bots.filter((b) => b.posicion).length;
  const filas = v.mercados.reduce((s, m) => s + m.filasSesion, 0);
  const importando = v.historia.find((h) => h.importando);
  const x: Record<AgenteId, [boolean, string]> = {
    vigia: [v.mercados.length > 0, `${vivos}/${v.mercados.length} mercados en vivo`],
    flujo: [vivos > 0, importando ? `importando ${importando.progreso?.dia ?? ''}` : `${filas.toLocaleString('es-ES')} filas hoy`],
    rastreador: [false, 'llega en A2'],
    programador: [activos > 0, activos ? `señal de ${activos} bots` : 'sin bots que correr'],
    juez: [true, 'listo en el Laboratorio'],
    etiquetador: [false, 'llega en A2'],
    lector: [false, 'llega en A3'],
    sintetizador: [false, 'llega en A4'],
    guardian: [v.bots.length > 0, v.apagado ? 'apagado de emergencia' : `vigila ${v.bots.length} bots`],
    ejecutor: [activos > 0, `${enPosicion}/${v.bots.length} en posición`],
  };
  return { estados: Object.fromEntries(AGENTES.map((a) => [a.id, x[a.id][1]])) as Record<AgenteId, string>, activos: Object.fromEntries(AGENTES.map((a) => [a.id, x[a.id][0]])) as Record<AgenteId, boolean> };
}

/** Lo que muestra la pantalla gigante. */
function muroDe(v: Vps, velas: Record<string, VelaMuro[]>): DatosMuro {
  const hoy = deHoy(v.ops);
  return {
    mercados: v.mercados.map((m) => ({ simbolo: m.simbolo, precio: v.filas[m.simbolo]?.at(-1)?.close ?? velas[m.simbolo]?.at(-1)?.c ?? null, velas: velas[m.simbolo] ?? [], serie: '1 MIN · ÚLTIMA HORA', conexion: m.conexion })),
    lineas: [
      ...v.bitacora.slice(0, 12).map((e) => (e.grave ? { t: e.t, quien: nombre('guardian'), color: color('guardian'), texto: `${e.nombre}: ${e.texto}` } : { t: e.t, quien: nombre('ejecutor'), color: color('ejecutor'), texto: `${e.nombre}: ${e.texto}` })),
      ...v.mercados.filter((m) => m.ultimoCierre).map((m) => ({ t: m.ultimoCierre!, quien: nombre('flujo'), color: color('flujo'), texto: `${m.simbolo}: ${m.filasSesion.toLocaleString('es-ES')} filas de Features${m.cortes ? ` · ${m.cortes} cortes` : ''}` })),
    ].sort((a, b) => b.t - a.t),
    cifras: [
      { nombre: 'Mercados en vivo', valor: `${v.mercados.filter((m) => m.conexion === 'en-vivo').length}/${v.mercados.length}` },
      { nombre: 'Bots activos', valor: `${v.bots.filter((b) => b.estado === 'activo').length}/${v.bots.length}` },
      { nombre: 'Operaciones hoy', valor: String(hoy.length) },
      { nombre: 'Paper hoy', valor: `${dinero(hoy.reduce((s, o) => s + o.pnl, 0))} $` },
    ],
  };
}

export default function Agentes() {
  const v = useVps();
  const velas = useVelas(v.mercados.map((m) => m.simbolo));
  const [sel, setSel] = useState<AgenteId | null>(null);
  const { estados, activos } = lecturas(v);
  const n = Object.values(activos).filter(Boolean).length;
  const a = AGENTES.find((x) => x.id === sel);

  return (
    <div className="agentes-v2">
      <div>
        <div className="et">Sala de agentes · viven en tu VPS</div>
        <h1>{n === 1 ? 'Un agente trabajando' : `${n} agentes trabajando`} de {AGENTES.length}.</h1>
      </div>
      <section className="caja sala-v2 vista-v1">
        <Suspense fallback={<p className="vacio">Abriendo la sala…</p>}>
          <Sala seleccion={sel} onSeleccion={(id) => setSel(sel === id ? null : id)} estados={estados} activos={activos} muro={muroDe(v, velas)} />
        </Suspense>
      </section>
      <div className="fichas-ag">
        {AGENTES.map((x) => (
          <button key={x.id} className={`caja ficha-ag ${sel === x.id ? 'sel' : ''} ${activos[x.id] ? '' : 'dormido'}`} style={{ ['--c' as string]: color(x.id) }} onClick={() => setSel(sel === x.id ? null : x.id)}>
            <b><i />{x.nombre}</b>
            <span className="mono">{estados[x.id]}</span>
          </button>
        ))}
      </div>
      {a && (
        <section className="caja detalle-ag" style={{ ['--c' as string]: color(a.id) }}>
          <span className="et">Capa {a.capa} · {CAPAS[a.capa]}</span>
          <h2><i />{a.nombre}</h2>
          <p>{a.rol}.</p>
          <p className="mono tenue">Motor: {a.motor} · ahora: {estados[a.id]}</p>
        </section>
      )}
    </div>
  );
}
