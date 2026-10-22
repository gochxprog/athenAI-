// Marco de la versión 2: barra de arriba, cinta en vivo, menú lateral (PC) o barra de abajo (celular).
import { useEffect, useState, type ReactNode } from 'react';
import { Lock, MoreHorizontal, X } from 'lucide-react';
import Pildora from '@/components/ui/Pildora';
import { MENU, MOVIL, TODAS, nota, type IdPantalla, type Item } from './menu';
import { movimientos, useVps, type Vps } from './vps';
import './shell.css';

const hora = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function useReloj() {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Chips({ v, ahora }: { v: Vps; ahora: number }) {
  const vivos = v.mercados.filter((m) => m.conexion === 'en-vivo').length;
  const estado = v.sinSesion ? 'SIN SESIÓN' : v.caido ? 'SIN CONEXIÓN' : !v.listo ? '…' : vivos === v.mercados.length && vivos ? 'EN VIVO' : `${vivos}/${v.mercados.length} EN VIVO`;
  const horas = v.inicio ? Math.floor((ahora - v.inicio) / 3_600_000) : null;
  return (
    <div className="chips">
      <span className="chip"><span className={`punto ${estado === 'EN VIVO' ? 'on' : ''}`} />GRABADORA <b>{estado}</b></span>
      <span className="chip ocultable">BOTS PAPER <b>{v.bots.filter((b) => b.estado === 'activo').length}</b></span>
      <span className="chip ocultable">VPS <b>{horas === null ? '—' : horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} d`}</b></span>
      <span className="chip ocultable">HISTORIA <b>{v.historia.reduce((s, h) => s + h.dias, 0)} d</b></span>
    </div>
  );
}

function Cinta({ v }: { v: Vps }) {
  const items = movimientos(v).slice(0, 8);
  const texto = items.length ? items : [{ t: 0, quien: '—', texto: 'sin movimientos todavía' }];
  return (
    <div className="cinta mono" aria-label="Lo último que pasó">
      <div className="cinta-pista">
        {[...texto, ...texto].map((m, i) => (
          <span key={i}><b>{m.quien}</b> · {m.texto}</span>
        ))}
      </div>
    </div>
  );
}

function Enlace({ it, sel, ir }: { it: Item; sel: boolean; ir: (id: IdPantalla) => void }) {
  const Icono = it.icono;
  return (
    <button className={`enlace ${sel ? 'sel' : ''} ${it.fase ? 'bloq' : ''}`} onClick={() => !it.fase && ir(it.id)} title={nota(it)} aria-disabled={!!it.fase} aria-current={sel ? 'page' : undefined}>
      {sel && <Pildora id="menu-v2" className="pildora" rigidez={380} />}
      <Icono size={15} strokeWidth={1.6} />
      <span>{it.nombre}</span>
      {it.fase ? <Lock size={11} className="candado" /> : null}
    </button>
  );
}

export default function Shell({ pantalla, ir, children }: { pantalla: IdPantalla; ir: (id: IdPantalla) => void; children: ReactNode }) {
  const v = useVps();
  const ahora = useReloj();
  const [mas, setMas] = useState(false);
  const menu = (
    <>
      {MENU.map((s) => (
        <div key={s.seccion}>
          <div className="seccion et">{s.seccion}</div>
          {s.items.map((it) => <Enlace key={it.id} it={it} sel={it.id === pantalla} ir={(id) => (setMas(false), ir(id))} />)}
        </div>
      ))}
    </>
  );
  return (
    <div className="shell">
      <header className="arriba">
        <div className="logo"><i />ATHENAI <span className="et">// quant-agentic</span></div>
        <Chips v={v} ahora={ahora} />
        <div className="reloj"><span className="et">{new Date(ahora).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span><b className="cifra">{hora(ahora)}</b></div>
      </header>
      <Cinta v={v} />
      <nav className="lateral">{menu}</nav>
      <main className="contenido">{children}</main>
      <nav className="abajo">
        {MOVIL.map((id) => <Enlace key={id} it={TODAS.find((x) => x.id === id)!} sel={id === pantalla} ir={ir} />)}
        <button className="enlace" onClick={() => setMas(true)}><MoreHorizontal size={15} /><span>Más</span></button>
      </nav>
      {mas && (
        <div className="hoja" onClick={() => setMas(false)}>
          <div className="hoja-cuerpo caja" onClick={(e) => e.stopPropagation()}>
            <button className="cerrar" onClick={() => setMas(false)} aria-label="Cerrar"><X size={16} /></button>
            {menu}
          </div>
        </div>
      )}
    </div>
  );
}
