// Pruebas del Juez en el VPS (grabadora/laboratorioVps.ts).
import type { PedidoPrueba, Trabajo } from '@/motores/laboratorio/prueba';

async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(ruta, cuerpo === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const x = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok || x.error) throw new Error(x.error ?? `El VPS respondió ${r.status}`);
  return x;
}

export const probar = (p: PedidoPrueba) => pedir<{ id: string }>('/api/laboratorio/probar', p);
export const cancelar = (id: string) => pedir('/api/laboratorio/cancelar', { id });
export const trabajo = (id: string) => pedir<Trabajo>(`/api/laboratorio/trabajo?id=${encodeURIComponent(id)}`);
