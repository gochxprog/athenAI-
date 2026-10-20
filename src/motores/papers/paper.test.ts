import { describe, expect, it } from 'vitest';
import { crearPaper, ideaDe, logicaDe, nombreArchivo, paperHtml } from './paper';
import { juzgar } from '../juez/juez';
import { peticionArchivo, CONFIG_NOTIF_POR_DEFECTO } from '../notificaciones/canales';
import type { RespuestaLaboratorio } from '../laboratorio/protocolo';

const codigo = `# Compra cuando hay absorción en el bid
# con delta negativo.
PARAMETROS = {"umbral": [50, 80]}

def estrategia(filas, p):
    return [1 if (f.get("absorcion_bid") or 0) >= p["umbral"] and f["delta_ratio"] < 0 else 0 for f in filas]
`;

function respuesta(): RespuestaLaboratorio {
  const cierres = Array.from({ length: 900 }, (_, i) => 100 + Math.sin(i / 7) * 2 + i * 0.01);
  const tiempos = cierres.map((_, i) => i * 60_000);
  const pos = cierres.map((_, i) => (i % 20 < 10 ? 1 : 0));
  const resultado = juzgar({ cierres, tiempos, combos: [{ umbral: 50 }, { umbral: 80 }], posiciones: [pos, pos.map((x, i) => (i % 3 ? x : 0))] });
  return { resultado, combos: [{ umbral: 50 }, { umbral: 80 }], filas: 900, desde: 0, hasta: 899 * 60_000, inicioOosT: 270 * 60_000, segundos: 1.2, lados: { largos: 450, cortos: 0 } };
}

describe('Papers', () => {
  it('saca la idea de los comentarios y describe la lógica', () => {
    expect(ideaDe(codigo)).toBe('Compra cuando hay absorción en el bid con delta negativo.');
    const l = logicaDe(codigo, [{ umbral: 50 }, { umbral: 80 }], { largos: 3, cortos: 0 });
    expect(l.features.sort()).toEqual(['absorcion_bid', 'delta_ratio']);
    expect(l.parametros).toEqual(['umbral: 50, 80']);
    expect(l.lados).toBe('solo en largo');
  });

  it('genera un documento completo, reducido y sin inyección de HTML', () => {
    const p = crearPaper({ estrategia: 'Absorción <b>bid</b>', codigo, simbolo: 'BTCUSDT', proveedor: 'Binance Futures', costos: { comisionPb: 4, deslizamientoPb: 1 }, respuesta: respuesta() }, Date.UTC(2026, 9, 20, 12));
    expect(p.respuesta.resultado.equityOos.length).toBeLessThanOrEqual(400);
    const html = paperHtml(p);
    for (const t of ['1. Idea', '2. Lógica en texto plano', '3. Código', '4. Walk-Forward', '5. Métricas', '6. Reglas del Juez', '7. Monte Carlo', '8. Robustez', '9. Conclusión']) expect(html).toContain(t);
    expect(html).toContain('Absorción &lt;b&gt;bid&lt;/b&gt;');
    expect(html).not.toContain('<b>bid</b>');
    expect(html).toContain('Absorción en el bid</b> (<code>absorcion_bid</code>)');
    expect(nombreArchivo(p)).toBe('paper-absorcion-b-bid-b-BTCUSDT-2026-10-20-12-00.html');
  });

  it('adjunta el archivo en Discord y Telegram y lo publica en ntfy', () => {
    const c = { ...CONFIG_NOTIF_POR_DEFECTO, discord: { activo: true, webhook: 'https://discord.com/api/webhooks/1/a' }, telegram: { activo: true, token: 'T', chatId: '7' }, ntfy: { activo: true, servidor: 'https://ntfy.sh', tema: 'x' } };
    const d = peticionArchivo('discord', c, 'p.html', '<html>', 'hola');
    expect((d.init.body as FormData).get('files[0]')).toBeInstanceOf(Blob);
    const t = peticionArchivo('telegram', c, 'p.html', '<html>', 'hola');
    expect(t.url).toBe('https://api.telegram.org/botT/sendDocument');
    expect((t.init.body as FormData).get('chat_id')).toBe('7');
    const n = peticionArchivo('ntfy', c, 'p.html', '<html>', 'hola');
    expect(n.url).toContain('filename=p.html');
    expect(n.init.method).toBe('POST');
  });
});
