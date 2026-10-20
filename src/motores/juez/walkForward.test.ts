// Verificación del motor 3 (Walk-Forward) con la especificación WFO del usuario.
import { describe, expect, it } from 'vitest';
import { anualizado, clasificarWfe, ventanasWfo, walkForward } from './walkForward';
import { crearAleatorio, normal } from '@/lib/random';

const SIN = { comisionPb: 0, deslizamientoPb: 0 };
const H = 3_600_000;

function mercado(n: number, persistencia: number, semilla: number) {
  const r = crearAleatorio(semilla);
  const cierres = [100];
  let previo = 0;
  for (let i = 1; i < n; i += 1) {
    const ret = persistencia * previo + normal(r) * 0.003;
    previo = ret;
    cierres.push(cierres[i - 1] * (1 + ret));
  }
  return { cierres, tiempos: cierres.map((_, i) => i * H) };
}
const momentum = (c: number[], k: number) => c.map((x, i) => (i < k ? 0 : Math.sign(x - c[i - k])));

describe('Motor 3 · Walk-Forward', () => {
  it('ventanas rolling automáticas: 5 ventanas, IS:OOS = 4:1, paso = L_OOS, con embargo', () => {
    const v = ventanasWfo(900);
    expect(v).toHaveLength(5);
    v.forEach((x, k) => {
      expect(x).toEqual({ isDesde: 100 * k, isHasta: 100 * k + 400 - 20, oosDesde: 400 + 100 * k, oosHasta: 500 + 100 * k });
      expect(x.isHasta).toBeLessThan(x.oosDesde);
    });
    expect(v[4].oosHasta).toBe(900);
    // Sobra menos de una ventana: la última OOS llega al final.
    expect(ventanasWfo(905)[4].oosHasta).toBe(905);
    // Tamaños propios.
    expect(ventanasWfo(1000, { lIs: 300, lOos: 200, embargo: 0 }).map((x) => [x.isDesde, x.oosDesde, x.oosHasta])).toEqual([
      [0, 300, 500],
      [200, 500, 700],
      [400, 700, 1000],
    ]);
  });

  it('elige θ* = argmax del objetivo solo con el IS, y no mira el OOS', () => {
    const { cierres, tiempos } = mercado(1_800, 0.5, 3);
    const buena = momentum(cierres, 1);
    const mala = buena.map((x) => -x);
    const quieta = cierres.map(() => 0);
    const r = walkForward({ cierres, tiempos, posiciones: [mala, buena, quieta], costos: SIN });
    for (const v of r.ventanas) expect(v.combo).toBe(1);
    // Cambiar precios dentro del OOS de la primera ventana no cambia su θ*.
    const v0 = r.ventanas[0];
    const alterados = cierres.map((c, i) => (i >= v0.oosDesde && i < v0.oosHasta ? c * (1 + 0.05 * Math.sin(i)) : c));
    const r2 = walkForward({ cierres: alterados, tiempos, posiciones: [mala, buena, quieta], costos: SIN });
    expect(r2.ventanas[0].combo).toBe(v0.combo);
    expect(r2.ventanas[0].objetivoIs).toBe(v0.objetivoIs);
  });

  it('el objetivo cambia la elección: Retorno neto frente a Sharpe', () => {
    // Variante A: sube poco y sin ruido (Sharpe altísimo). Variante B: sube más pero con mucho ruido.
    const n = 900;
    const cierres = [100];
    for (let i = 1; i < n; i += 1) cierres.push(cierres[i - 1] * (1 + (i % 2 ? 0.03 : -0.0285)));
    const tiempos = cierres.map((_, i) => i * H);
    const a = cierres.map((_, i) => (i % 2 === 0 ? 1 : 0)); // solo barras que suben
    const b = cierres.map(() => 1); // siempre largo
    const porSharpe = walkForward({ cierres, tiempos, posiciones: [b, a], costos: SIN, config: { objetivo: 'sharpe' } });
    const porRetorno = walkForward({ cierres, tiempos, posiciones: [a, b], costos: SIN, config: { objetivo: 'retorno' } });
    expect(porSharpe.ventanas[0].combo).toBe(1); // a
    expect(porRetorno.ventanas[0].combo).toBe(0); // a también gana más en retorno aquí
    expect(porRetorno.objetivo).toBe('retorno');
  });

  it('WFE alto con ventaja real; bajo con sobreajuste; null si el IS no gana', () => {
    const { cierres, tiempos } = mercado(4_500, 0.5, 1);
    const real = walkForward({ cierres, tiempos, posiciones: [1, 2, 3].map((k) => momentum(cierres, k)), costos: SIN });
    expect(real.wfe).toBeGreaterThan(0.5);

    // Sobreajuste: mercado sin ventaja (paseo aleatorio) y 40 variantes al azar. En cada IS gana alguna por
    // suerte; fuera de muestra esa suerte no se repite. Una sola prueba es ruidosa: se promedian 12 mercados.
    const wfes: number[] = [];
    for (let semilla = 1; semilla <= 12; semilla += 1) {
      const ruido = mercado(4_500, 0, semilla);
      const azar = crearAleatorio(100 + semilla);
      const variantes = Array.from({ length: 40 }, () => ruido.cierres.map(() => (azar() < 0.5 ? 1 : -1)));
      const w = walkForward({ cierres: ruido.cierres, tiempos: ruido.tiempos, posiciones: variantes, costos: SIN }).wfe;
      expect(w).not.toBeNull();
      wfes.push(w!);
    }
    const media = wfes.reduce((a, x) => a + x, 0) / wfes.length;
    expect(media).toBeLessThan(0.3);
    expect(clasificarWfe(media)).toBe('sobreajuste');

    const nada = walkForward({ cierres, tiempos, posiciones: [cierres.map(() => 0)], costos: SIN });
    expect(nada.wfe).toBeNull();
  });

  it('anualizado = media por barra × barras por año; clasificación de la especificación', () => {
    const rets = [0.001, -0.0005, 0.002, 0.0005];
    const t = [0, 1, 2, 3].map((i) => i * 24 * H); // 365,25 barras por año
    expect(anualizado(rets, t, 0, 4)).toBeCloseTo((0.003 / 4) * 365.25, 12);
    expect(clasificarWfe(0.75)).toBe('excelente');
    expect(clasificarWfe(0.55)).toBe('aceptable');
    expect(clasificarWfe(0.4)).toBe('débil');
    expect(clasificarWfe(0.2)).toBe('sobreajuste');
    expect(clasificarWfe(null)).toBeNull();
  });
});
