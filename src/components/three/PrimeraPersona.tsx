// Primera persona dentro de la sala: arrastrar = mirar; rueda, pellizco o los botones ▲ ▼ = caminar; en el PC
// también W A S D y las flechas. No atraviesa los puestos ni sale de la sala.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

export const OJOS = 1.45;
const LIMITE = { x: 8.2, zMin: -6.2, zMax: 6.6 };
const VEL = 1.8;
export interface Inicio { x: number; z: number; yaw: number }

export default function PrimeraPersona({ inicio, obstaculos, avance }: { inicio: Inicio; obstaculos: [number, number, number][]; avance: MutableRefObject<number> }) {
  const { camera, gl } = useThree();
  const st = useRef({ yaw: inicio.yaw, pitch: -0.08, x: inicio.x, z: inicio.z, teclas: new Set<string>() });

  // Mueve sin salir de la sala ni meterse en un puesto (lo empuja afuera de su círculo).
  const ir = (dx: number, dz: number) => {
    const s = st.current;
    let [x, z] = [Math.max(-LIMITE.x, Math.min(LIMITE.x, s.x + dx)), Math.max(LIMITE.zMin, Math.min(LIMITE.zMax, s.z + dz))];
    for (const [ox, oz, r] of obstaculos) {
      const d = Math.hypot(x - ox, z - oz);
      if (d < r) [x, z] = d < 1e-6 ? [ox + r, oz] : [ox + ((x - ox) / d) * r, oz + ((z - oz) / d) * r];
    }
    [s.x, s.z] = [x, z];
  };
  const caminar = (m: number) => ir(-Math.sin(st.current.yaw) * m, -Math.cos(st.current.yaw) * m);

  useEffect(() => {
    const el = gl.domElement;
    const punteros = new Map<number, { x: number; y: number }>();
    let pellizco = 0;
    const abajo = (e: PointerEvent) => punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const mover = (e: PointerEvent) => {
      const p = punteros.get(e.pointerId);
      if (!p) return;
      const s = st.current;
      if (punteros.size === 1) {
        s.yaw -= (e.clientX - p.x) * 0.0045;
        s.pitch = Math.max(-1.1, Math.min(1.1, s.pitch - (e.clientY - p.y) * 0.0045));
      }
      [p.x, p.y] = [e.clientX, e.clientY];
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pellizco) caminar((d - pellizco) * 0.012);
        pellizco = d;
      }
    };
    const arriba = (e: PointerEvent) => {
      punteros.delete(e.pointerId);
      pellizco = 0;
    };
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      caminar(-e.deltaY * 0.004);
    };
    const tecla = (on: boolean) => (e: KeyboardEvent) => (on ? st.current.teclas.add(e.code) : st.current.teclas.delete(e.code));
    const [baja, sube] = [tecla(true), tecla(false)];
    el.addEventListener('pointerdown', abajo);
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', arriba);
    window.addEventListener('pointercancel', arriba);
    el.addEventListener('wheel', rueda, { passive: false });
    window.addEventListener('keydown', baja);
    window.addEventListener('keyup', sube);
    el.style.touchAction = 'none';
    return () => {
      el.removeEventListener('pointerdown', abajo);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', arriba);
      window.removeEventListener('pointercancel', arriba);
      el.removeEventListener('wheel', rueda);
      window.removeEventListener('keydown', baja);
      window.removeEventListener('keyup', sube);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useFrame((_, dt) => {
    const s = st.current;
    const k = (c: string) => s.teclas.has(c);
    const paso = Math.min(dt, 0.1) * VEL;
    const adelante = avance.current + (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const lado = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    s.yaw += ((k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0)) * paso;
    if (adelante) caminar(adelante * paso);
    if (lado) ir(Math.cos(s.yaw) * lado * paso, -Math.sin(s.yaw) * lado * paso);
    camera.position.set(s.x, OJOS, s.z);
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
  });
  return null;
}
