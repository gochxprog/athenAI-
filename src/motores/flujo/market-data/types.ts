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

export interface MarketDataQuery {
  symbol: string;
  interval: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface MarketDataAdapter {
  getHistoricalCandles(query: MarketDataQuery): Promise<NormalizedCandle[]>;
  getLatestCandle(query: MarketDataQuery): Promise<NormalizedCandle | null>;
  subscribeToCandles(
    query: MarketDataQuery,
    onCandle: (candle: NormalizedCandle) => void,
    onError: (error: Error) => void,
  ): () => void;
}

export interface MarketDataError {
  code: "provider_unavailable" | "instrument_unavailable" | "invalid_query" | "network_error";
  message: string;
  provider: string;
  symbol?: string;
  interval?: string;
  marketType?: "futures" | "spot";
  providerHttpStatus?: number;
  providerError?: string;
}

export type MarketDataConnectionState = "CONNECTING" | "CONNECTED" | "RECONNECTING" | "DISCONNECTED" | "PROVIDER_ERROR" | "DATA_STALE" | "LIVE";

export interface MarketDataProviderError {
  code: string;
  provider: string;
  marketType: "futures" | "spot";
  symbol: string;
  interval: string;
  providerHttpStatus?: number;
  providerError?: string;
  message: string;
}
