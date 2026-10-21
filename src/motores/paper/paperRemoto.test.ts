import { describe, expect, it } from 'vitest';
import { MotorPaperRemoto } from './paperRemoto';

describe('Bots del VPS vistos desde la plataforma', () => {
  it('sin grabadora (o sin bots en ella) no está disponible; con ella refleja bots y acciones', async () => {
    const llamadas: { ruta: string; cuerpo?: unknown }[] = [];
    let hay = false;
    const estado = { cargado: true, apagado: false, reglas: { ddDiarioMax: 0.05, perdidasSeguidasMax: 5 }, bots: [{ id: 'b1' }], bitacora: [] };
    const api = async <T,>(ruta: string, cuerpo?: unknown): Promise<T | null> => {
      llamadas.push({ ruta, cuerpo });
      if (!hay) return null;
      if (ruta === '/api/paper') return estado as T;
      if (ruta.startsWith('/api/paper/operaciones')) return { operaciones: [{ botId: 'b1' }] } as T;
      if (ruta === '/api/paper/crear') return { bot: { id: 'b2' } } as T;
      return { ok: true } as T;
    };
    const m = new MotorPaperRemoto(api);
    await m.cargar();
    expect(m.disponible).toBe(false);
    hay = true;
    await m.cargar();
    expect(m.disponible).toBe(true);
    expect(m.bots.map((b) => b.id)).toEqual(['b1']);
    expect((await m.operaciones('b1')).length).toBe(1);
    expect(llamadas.at(-1)?.ruta).toBe('/api/paper/operaciones?bot=b1');
    await m.pausar('b1');
    expect(llamadas.find((x) => x.ruta === '/api/paper/pausar')?.cuerpo).toEqual({ id: 'b1' });
    expect((await m.crearBot({} as never)).id).toBe('b2');
  });

  it('si la grabadora falla, queda no disponible con el error (los bots del navegador siguen)', async () => {
    const m = new MotorPaperRemoto(async () => {
      throw new Error('HTTP 404');
    });
    await m.cargar();
    expect(m.disponible).toBe(false);
    expect(m.error).toBe('HTTP 404');
  });
});
