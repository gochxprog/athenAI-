// Pruebas del Juez en el VPS (grabadora/laboratorioVps.ts).
import type { PedidoPrueba, Trabajo } from '@/motores/laboratorio/prueba';
import { pedir } from '../../api';

export const probar = (p: PedidoPrueba) => pedir<{ id: string }>('/api/laboratorio/probar', p);
export const cancelar = (id: string) => pedir('/api/laboratorio/cancelar', { id });
export const trabajo = (id: string) => pedir<Trabajo>(`/api/laboratorio/trabajo?id=${encodeURIComponent(id)}`);
/** Estado del Laboratorio en este navegador (la Biblioteca lo usa para «Abrir en el Laboratorio»). */
export const CLAVE_LAB = 'athenai.v2.laboratorio';
