import { describe, expect, it } from "vitest";
import { bigTradesTopic, bookTopic, klineTopic, parseTopic, tradesTopic } from "./protocol";

describe("protocolo de topics", () => {
  it("ida y vuelta de cada tipo", () => {
    expect(parseTopic(klineTopic("btcusdt", "1m"))).toEqual({ kind: "kline", symbol: "BTCUSDT", interval: "1m" });
    expect(parseTopic(tradesTopic("ethusdt"))).toEqual({ kind: "trades", symbol: "ETHUSDT" });
    expect(parseTopic(bigTradesTopic("SOLUSDT"))).toEqual({ kind: "bigtrades", symbol: "SOLUSDT" });
    expect(parseTopic(bookTopic("BTCUSDT", 40, 10))).toEqual({ kind: "book", symbol: "BTCUSDT", depth: 40, group: 10 });
  });

  it("rechaza topics mal formados o fuera de rango", () => {
    for (const bad of [
      "", "kline", "kline:BTCUSDT", "kline:btcusdt:1m", "kline:BTCUSDT:1m:x", "kline:BTCUSDT:abc",
      "trades:BTC", "trades:BTCUSDT:extra", "book:BTCUSDT:4:10", "book:BTCUSDT:301:10", "book:BTCUSDT:40:0",
      "book:BTCUSDT:40:1001", "book:BTCUSDT:4x:10", "book:BTCUSDT:40", "nope:BTCUSDT", "kline:BTC/USDT:1m",
      "trades:" + "A".repeat(100),
    ]) {
      expect(parseTopic(bad)).toBeNull();
    }
  });
});
