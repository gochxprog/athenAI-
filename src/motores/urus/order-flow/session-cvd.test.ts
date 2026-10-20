import { describe, expect, it } from "vitest";
import {
  SESSION_DEFINITIONS,
  SessionCVDEngine,
  computeVisibleYRange,
  getSessionDefinition,
  getSessionWindow,
  pickAutoSession,
} from "./session-cvd";

const utc = (iso: string) => Date.parse(`${iso}Z`);
const tick = (iso: string, volume: number, isBuyerMaker = false) => ({
  timestamp: utc(iso),
  price: 100,
  volume,
  isBuyerMaker,
});

describe("session windows (UTC)", () => {
  const active = (iso: string) =>
    SESSION_DEFINITIONS.filter(def => getSessionWindow(def, utc(iso))).map(def => def.id).sort();

  it("respeta las 4 ventanas con sus solapes reales (+ DAY siempre activo)", () => {
    // Cambio de semántica documentado (Fase 5/E3): el motor también acumula la
    // ventana diaria DAY (00:00–24:00 UTC), que está activa las 24 h.
    expect(active("2026-10-02T03:00:00")).toEqual(["DAY", "SYD", "TOK"]);
    expect(active("2026-10-02T08:00:00")).toEqual(["DAY", "LON", "TOK"]);
    expect(active("2026-10-02T12:00:00")).toEqual(["DAY", "LON"]);
    expect(active("2026-10-02T12:30:00")).toEqual(["DAY", "LON", "NY"]);
    expect(active("2026-10-02T15:29:00")).toEqual(["DAY", "LON", "NY"]);
    expect(active("2026-10-02T15:30:00")).toEqual(["DAY", "NY"]);
    expect(active("2026-10-02T21:00:00")).toEqual(["DAY"]);
    expect(active("2026-10-02T22:00:00")).toEqual(["DAY", "SYD"]);
  });

  it("Sydney cruza medianoche y conserva el inicio del día anterior", () => {
    const window = getSessionWindow(getSessionDefinition("SYD"), utc("2026-10-02T03:00:00"))!;
    expect(window.startMs).toBe(utc("2026-10-01T22:00:00"));
    expect(window.endMs).toBe(utc("2026-10-02T07:00:00"));
  });

  it("AUTO elige la sesión activa más reciente", () => {
    expect(pickAutoSession(utc("2026-10-02T08:00:00")).id).toBe("LON");
    expect(pickAutoSession(utc("2026-10-02T13:00:00")).id).toBe("NY");
    expect(pickAutoSession(utc("2026-10-02T22:30:00")).id).toBe("SYD");
    const gap = pickAutoSession(utc("2026-10-02T21:30:00"));
    expect(gap.id).toBe("NY");
    expect(gap.active).toBe(false);
  });
});

describe("SessionCVDEngine", () => {
  it("suma +buy / -sell y respeta buyerIsMaker", () => {
    const engine = new SessionCVDEngine({ symbol: "btcusdt" });
    engine.processTick(tick("2026-10-02T13:00:00", 5, false));
    const result = engine.processTick(tick("2026-10-02T13:00:01", 2, true));
    expect(result.session).toBe("NY");
    expect(result.cvd).toBe(3);
    expect(engine.getState("LON").cvd).toBe(3);
  });

  it("M8: un trade re-entregado con el mismo id no se suma dos veces", () => {
    const engine = new SessionCVDEngine({ symbol: "btcusdt" });
    const t1 = { ...tick("2026-10-02T13:00:00", 5, false), id: 101 };
    const t2 = { ...tick("2026-10-02T13:00:01", 5, false), id: 101 }; // mismo id
    const t3 = { ...tick("2026-10-02T13:00:02", 5, false), id: 102 }; // id nuevo
    engine.processTick(t1);
    const dup = engine.processTick(t2);
    engine.processTick(t3);
    expect(dup.cvd).toBe(5); // el duplicado no sumó
    expect(engine.getState("NY").cvd).toBe(10); // 5 + 5, no 15
  });

  it("M8: sin id no hay dedup (comportamiento anterior intacto)", () => {
    const engine = new SessionCVDEngine({ symbol: "btcusdt" });
    engine.processTick(tick("2026-10-02T13:00:00", 5, false));
    const result = engine.processTick(tick("2026-10-02T13:00:00", 5, false));
    expect(result.cvd).toBe(10);
  });

  it("cada sesión ignora trades fuera de su ventana", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-02T16:00:00", 10));
    expect(engine.getState("NY").cvd).toBe(10);
    expect(engine.getState("LON").cvd).toBe(0);
    expect(engine.getState("TOK").cvd).toBe(0);
  });

  it("resetea a 0 al iniciar una nueva instancia, aunque tenga el mismo nombre", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-01T13:00:00", 7));
    const next = engine.processTick(tick("2026-10-02T13:00:00", 1));
    expect(next.isReset).toBe(true);
    expect(next.cvd).toBe(1);
    const keys = new Set(engine.getState("NY").points.map(point => point.instanceKey));
    expect(keys.size).toBe(2);
  });

  it("reset de Londres a las 07:00 y de Tokio a las 00:00", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-02T06:59:00", 4));
    const r = engine.processTick(tick("2026-10-02T07:00:00", 1));
    expect(r.resets).toContain("LON");
    expect(r.resets).not.toContain("TOK");
    expect(engine.getState("TOK").cvd).toBe(5);
    const midnight = engine.processTick(tick("2026-10-03T00:00:00", 2));
    expect(midnight.resets).toContain("TOK");
  });

  it("applyAggregate equivale a procesar los trades del minuto", () => {
    const a = new SessionCVDEngine({ symbol: "BTCUSDT" });
    const b = new SessionCVDEngine({ symbol: "BTCUSDT" });
    a.processTick(tick("2026-10-02T13:00:10", 3, false));
    a.processTick(tick("2026-10-02T13:00:20", 1, true));
    b.applyAggregate(utc("2026-10-02T13:00:00"), 3, 1);
    expect(b.getState("NY").cvd).toBe(a.getState("NY").cvd);
  });

  it("agrupa en buckets y no duplica puntos", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT", bucketMs: 300_000 });
    engine.processTick(tick("2026-10-02T13:00:10", 1));
    engine.processTick(tick("2026-10-02T13:04:59", 1));
    engine.processTick(tick("2026-10-02T13:05:00", 1));
    const points = engine.getState("NY").points;
    expect(points).toHaveLength(2);
    expect(points[0].cvd).toBe(2);
    expect(points[1].cvd).toBe(3);
  });

  it("cuenta minutos con datos para detectar huecos y los reinicia con cada sesión", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-02T13:00:10", 1));
    engine.processTick(tick("2026-10-02T13:00:50", 1)); // mismo minuto
    engine.processTick(tick("2026-10-02T13:05:00", 1)); // hueco de 4 minutos
    expect(engine.getState("NY").minutesWithData).toBe(2);
    engine.processTick(tick("2026-10-03T13:00:00", 1)); // nueva instancia
    expect(engine.getState("NY").minutesWithData).toBe(1);
  });

  it("instancias del motor son independientes entre sí", () => {
    const chartA = new SessionCVDEngine({ symbol: "BTCUSDT" });
    const chartB = new SessionCVDEngine({ symbol: "ETHUSDT" });
    chartA.processTick(tick("2026-10-02T13:00:00", 9));
    expect(chartB.getState("NY").cvd).toBe(0);
  });

  it("DAY acumula todo el día y se reinicia a las 00:00 UTC", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-02T10:00:00", 4)); // buy agresivo
    engine.processTick(tick("2026-10-02T23:59:30", 3, true)); // sell agresivo
    expect(engine.getState("DAY").cvd).toBe(1);
    // Cruza medianoche UTC: el acumulado diario vuelve a cero.
    const r = engine.processTick(tick("2026-10-03T00:00:20", 2));
    expect(r.resets).toContain("DAY");
    expect(engine.getState("DAY").cvd).toBe(2);
    expect(engine.getState("DAY").buyVolume).toBe(2);
    expect(engine.getState("DAY").sellVolume).toBe(0);
    // Dos instancias diarias distintas en el historial de puntos.
    const keys = new Set(engine.getState("DAY").points.map(point => point.instanceKey));
    expect(keys.size).toBe(2);
    expect([...keys].every(key => key.startsWith("DAY@"))).toBe(true);
  });

  it("DAY acumula trades de todas las franjas horarias del día", () => {
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-02T02:00:00", 5)); // sesión SYD/TOK
    engine.processTick(tick("2026-10-02T14:00:00", 7)); // sesión NY
    engine.processTick(tick("2026-10-02T21:30:00", 3)); // fuera de toda sesión
    expect(engine.getState("DAY").cvd).toBe(15);
  });

  it("el backfill de un día produce una línea de muchos puntos con una sola instancia (no solo el punto final)", () => {
    // Reproduce el escenario del reporte "el CVD muestra solo un punto":
    // siembra el motor EXACTAMENTE como lo hace useSessionCVD.synchronize()
    // (applyAggregate por cada minuto del endpoint) y exige una línea continua.
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    const dayStart = utc("2026-10-06T00:00:00");
    const minutes = 360; // 6 horas de historia
    let expectedCvd = 0;
    for (let i = 0; i < minutes; i += 1) {
      const buy = 10 + (i % 7);
      const sell = 8 + (i % 5);
      expectedCvd += buy - sell;
      engine.applyAggregate(dayStart + i * 60_000, buy, sell);
    }
    const state = engine.getState("DAY");
    // La línea: un punto por minuto de historia…
    expect(state.points.length).toBe(minutes);
    // …todos de la misma instancia del día: un solo segmento continuo, sin cortes.
    const keys = new Set(state.points.map(point => point.instanceKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]!.startsWith("DAY@")).toBe(true);
    expect(state.cvd).toBe(expectedCvd);
    // La punta viva (el puntito brillante del panel) es el ÚLTIMO punto de ese
    // único segmento: un solo marcador al final, no un punto aislado.
    const tip = state.points.at(-1)!;
    expect(tip.t).toBe(dayStart + (minutes - 1) * 60_000);
    expect(tip.cvd).toBe(expectedCvd);
  });

  it("un trade tardío no rompe el orden cronológico ni corrompe valores históricos (H-1)", () => {
    // Caso verificado en la auditoría: antes del fix, el trade tardío hacía push
    // al final → [00:00→10, 01:00→20, 02:00→30, 00:00→35] (orden roto + valor mal).
    const engine = new SessionCVDEngine({ symbol: "BTCUSDT" });
    engine.processTick(tick("2026-10-02T00:00:00", 10)); // buy 10
    engine.processTick(tick("2026-10-02T01:00:00", 10)); // buy 10
    engine.processTick(tick("2026-10-02T02:00:00", 10)); // buy 10
    // Trade tardío: ocurrió a las 00:00:30 (mismo bucket 00:00) pero llega
    // después del trade de las 02:00.
    engine.processTick(tick("2026-10-02T00:00:30", 5)); // buy 5
    const state = engine.getState("DAY");
    const points = state.points;
    // El orden cronológico se conserva: ningún punto fuera de orden al final.
    expect(points.map(point => point.t)).toEqual([
      utc("2026-10-02T00:00:00"),
      utc("2026-10-02T01:00:00"),
      utc("2026-10-02T02:00:00"),
    ]);
    // El delta del trade tardío se propagó a su bucket (00:00) y a los
    // posteriores: valores históricamente correctos, total intacto.
    expect(points.map(point => point.cvd)).toEqual([15, 25, 35]);
    expect(state.cvd).toBe(35);
    // minutesWithData no cuenta doble el minuto 00:00 del trade tardío.
    expect(state.minutesWithData).toBe(3);
  });
});

describe("computeVisibleYRange", () => {
  it("usa solo los puntos dentro de la ventana visible", () => {
    const points = [
      { t: 0, cvd: 1000, instanceKey: "x" },
      { t: 10, cvd: 5, instanceKey: "x" },
      { t: 20, cvd: -5, instanceKey: "x" },
      { t: 30, cvd: -2000, instanceKey: "x" },
    ];
    const range = computeVisibleYRange(points, 10, 20, 0)!;
    expect(range.min).toBe(-5);
    expect(range.max).toBe(5);
  });

  it("devuelve null sin puntos y rango > 0 con un solo punto", () => {
    expect(computeVisibleYRange([], 0, 1)).toBeNull();
    const single = computeVisibleYRange([{ t: 1, cvd: 0, instanceKey: "x" }], 0, 2)!;
    expect(single.max).toBeGreaterThan(single.min);
  });
});
