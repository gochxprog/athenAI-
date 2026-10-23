// Calendario (v2): los eventos fuertes que el VPS conoce de antemano y su ventana de no operar. Son los mismos que
// marcan la Feature `ventana_evento` en cada barra (fechas fijadas antes: no mira al futuro).
import { useEffect, useState } from 'react';
import { EVENTOS_PREDEFINIDOS, eventoEnVentana } from '@/motores/nucleo/calendario';
import { useVps } from '../../vps';
import '../laboratorio/lab.css';
import './calendario.css';

const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const falta = (ms: number) => {
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.max(0, Math.round(ms / 60_000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} días`;
};

export default function Calendario() {
  const v = useVps();
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const eventos = [...EVENTOS_PREDEFINIDOS].sort((a, b) => a.t - b.t);
  const enCurso = eventoEnVentana(eventos, ahora);
  const proximos = eventos.filter((e) => e.t + e.despuesMin * 60_000 >= ahora);
  const pasados = eventos.filter((e) => e.t + e.despuesMin * 60_000 < ahora).reverse();
  // Barras de la última media hora marcadas dentro de una ventana (lo que ve cada estrategia y bot).
  const marcadas = Object.values(v.filas).flat().filter((f) => f.valores.ventana_evento).length;

  return (
    <div className="calendario-v2">
      <div>
        <div className="et">Calendario</div>
        <h1>{enCurso ? `Ahora: ${enCurso.nombre} · no operar` : proximos[0] ? `${proximos[0].nombre} · en ${falta(proximos[0].t - ahora)}` : 'Sin eventos próximos'}</h1>
      </div>
      <section className="caja bloque-c">
        <span className="et">Próximos</span>
        {proximos.length ? proximos.map((e) => {
          const abre = e.t - e.antesMin * 60_000;
          const dentro = enCurso?.id === e.id;
          return (
            <div key={e.id} className={`evento-c ${dentro ? 'dentro' : ''}`}>
              <div><b>{e.nombre}</b><small>{fecha(e.t)} · impacto {e.impacto}</small></div>
              <div className="mono">{dentro ? 'dentro de la ventana' : `en ${falta(e.t - ahora)}`}<small>sin operar de {new Date(abre).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} a {new Date(e.t + e.despuesMin * 60_000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</small></div>
            </div>
          );
        }) : <p className="nota-c">—</p>}
      </section>
      <section className="caja bloque-c">
        <span className="et">Ventana</span>
        <p className="nota-c mono">−{EVENTOS_PREDEFINIDOS[0]?.antesMin ?? 30} min / +{EVENTOS_PREDEFINIDOS[0]?.despuesMin ?? 90} min · {marcadas} barras marcadas (30 min)</p>
      </section>
      {pasados.length > 0 && (
        <section className="caja bloque-c">
          <span className="et">Pasados</span>
          {pasados.map((e) => <div key={e.id} className="evento-c pasado"><div><b>{e.nombre}</b><small>{fecha(e.t)}</small></div></div>)}
        </section>
      )}
    </div>
  );
}
