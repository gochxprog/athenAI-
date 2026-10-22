export interface NormalizedCandle {
  /** Milliseconds since Unix epoch, always UTC and never a date string. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Reserved for provider-normalized order-flow extensions. */
  buyVolume?: number;
  sellVolume?: number;
  delta?: number;
  tradeCount?: number;
}


export interface AggTrade {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  aggTradeId: number;
  buyerIsMaker: boolean;
}
