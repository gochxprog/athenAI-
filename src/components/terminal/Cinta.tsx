// Cinta tipo teletipo: lo último que hicieron los bots y tú, desplazándose lento. Se detiene al pasar el ratón.
import { useMotorPaper, hora } from './comun';

export default function Cinta() {
  const motor = useMotorPaper();
  const items = motor.bitacora.slice(0, 14);
  if (!items.length) {
    return <div className="rounded-lg border border-borde-suave px-3 py-1.5 font-mono text-[10px] text-plata-500">— sin movimientos todavía · aquí pasa cada entrada, salida y cada vez que actúa el Guardián —</div>;
  }
  const linea = items.map((x, i) => (
    <span key={`${x.t}-${i}`} className={`mx-6 inline-flex items-center gap-2 ${x.grave ? 'text-white' : 'text-plata-300'}`}>
      <span className="text-plata-500">{hora(x.t).slice(-8)}</span>
      <span className="h-1 w-1 rounded-full bg-plata-500" />
      <span className="text-plata-100">{x.nombre}</span>
      {x.texto}
    </span>
  ));
  return (
    <div className="group relative overflow-hidden rounded-lg border border-borde-suave py-1.5 font-mono text-[10.5px] [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]" data-cinta>
      <div className="flex w-max animate-[cinta_70s_linear_infinite] whitespace-nowrap group-hover:[animation-play-state:paused]">
        <div>{linea}</div>
        <div aria-hidden>{linea}</div>
      </div>
    </div>
  );
}
