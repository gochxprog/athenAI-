// Sala de agentes (v2): la sala 3D con los 10 puestos y, en la pared del fondo, la pantalla gigante con las velas
// de 1 min de cada mercado, la radio de los agentes y las cifras del día. Los estados, la radio y la fila salen del
// orquestador del VPS (/api/agentes): un agente solo se enciende si de verdad está trabajando ahí.
import { lazy, Suspense, useEffect, useState } from 'react';
import { AGENTES, ESTILO_AGENTE, type AgenteId } from '@/data/agentes';
import { frase, type EstadoSala } from '@/motores/agentes/sala';
import type { DatosMuro, VelaMuro } from '@/components/three/muro';
import { pedir } from '../../api';
import { dinero, num } from '../../formato';
import { deHoy, useVps, type Vps } from '../../vps';
import DetalleAgente from './DetalleAgente';
import '../../tw.css';
import './agentes.css';

const Sala = lazy(() => import('@/components/three/SalaAgentes3D'));
const nombre = (id: AgenteId) => AGENTES.find((a) => a.id === id)!.nombre;
const color = (id: AgenteId) => ESTILO_AGENTE[id].color;
const gb = (b: number) => `${num(b / 1024 ** 3, 1)} GB`;

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

/** Lo que muestra la pantalla gigante. */
function muroDe(v: Vps, sala: EstadoSala, velas: Record<string, VelaMuro[]>): DatosMuro {
  const hoy = deHoy(v.ops);
  return {
    mercados: v.mercados.map((m) => ({ simbolo: m.simbolo, precio: v.filas[m.simbolo]?.at(-1)?.close ?? velas[m.simbolo]?.at(-1)?.c ?? null, velas: velas[m.simbolo] ?? [], serie: '1 MIN · ÚLTIMA HORA', conexion: m.conexion })),
    lineas: sala.notas.map((n) => ({ t: n.t, quien: nombre(n.id), color: color(n.id), texto: n.texto })),
    cifras: [
      { nombre: 'Agentes trabajando', valor: `${sala.agentes.filter((a) => a.estado === 'trabajando').length}/${AGENTES.length}` },
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
  const sala = v.agentes;
  if (!sala) return <div className="agentes-v2"><p className="vacio">{v.listo ? 'Tu grabadora todavía no tiene la sala de agentes: instala la versión nueva en el VPS.' : 'Conectando con el VPS…'}</p></div>;
  const ficha = (id: AgenteId) => sala.agentes.find((a) => a.id === id)!;
  // En la sala, solo una palabra (el detalle va en las fichas de abajo): los rótulos no se enciman.
  const estados = Object.fromEntries(sala.agentes.map((a) => [a.id, a.estado === 'dormido' ? a.ahora.replace('llega en la fase', 'llega en') : a.estado])) as Record<AgenteId, string>;
  const activos = Object.fromEntries(sala.agentes.map((a) => [a.id, a.estado === 'trabajando' || a.estado === 'alerta'])) as Record<AgenteId, boolean>;
  const r = sala.recursos;
  const elegir = (id: AgenteId) => setSel(sel === id ? null : id);

  return (
    <div className="agentes-v2">
      <div>
        <div className="et">Sala de agentes · viven en tu VPS</div>
        <h1>{frase(sala)}</h1>
      </div>
      <div className="recursos-ag mono">
        <span>Memoria <b>{gb(r.memTotal - r.memLibre)} / {gb(r.memTotal)}</b><i style={{ width: `${((r.memTotal - r.memLibre) / r.memTotal) * 100}%` }} /></span>
        {r.discoLibre !== null && r.discoTotal !== null && <span>Disco libre <b>{gb(r.discoLibre)}</b><i style={{ width: `${(1 - r.discoLibre / r.discoTotal) * 100}%` }} /></span>}
        <span>Grabadora <b>{gb(r.rss)}</b></span>
        <span>Carga <b>{num(r.carga, 2)} · {r.nucleos} núcleos</b></span>
        <span>Fila pesada <b>{sala.fila.actual ? `${nombre(sala.fila.actual.id)} · ${sala.fila.actual.nombre}` : 'libre'}{sala.fila.espera.length ? ` · ${sala.fila.espera.length} en espera` : ''}</b></span>
      </div>
      <section className="caja sala-v2 vista-v1">
        <Suspense fallback={<p className="vacio">Abriendo la sala…</p>}>
          <Sala seleccion={sel} onSeleccion={elegir} estados={estados} activos={activos} muro={muroDe(v, sala, velas)} />
        </Suspense>
      </section>
      {sel && <DetalleAgente ficha={ficha(sel)} notas={sala.notas.filter((n) => n.id === sel)} />}
      <div className="fichas-ag">
        {sala.agentes.map((x) => (
          <button key={x.id} className={`caja ficha-ag ${sel === x.id ? 'sel' : ''} ${x.estado}`} style={{ ['--c' as string]: color(x.id) }} onClick={() => elegir(x.id)}>
            <b><i />{nombre(x.id)}</b>
            <span className="mono">{x.ahora}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
