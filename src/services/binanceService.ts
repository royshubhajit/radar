import { Candle, KlineInterval } from '../types';

export type ExchangeSource = 'binance_spot' | 'binance_futures' | 'mexc' | 'bitfinex';

const API_ENDPOINTS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api1.binance.com',
  'https://api3.binance.com'
];

class BinanceService {
  private currentEndpointIndex = 0;
  private symbolSourceCache = new Map<string, ExchangeSource>([
    ['HYPEUSDT', 'binance_futures'],
    ['XMRUSDT', 'binance_futures'],
    ['KASUSDT', 'binance_futures'],
    ['USELESSUSDT', 'binance_futures'],
    ['FARTCOINUSDT', 'binance_futures'],
  ]);

  private getBaseUrl(): string {
    return API_ENDPOINTS[this.currentEndpointIndex];
  }

  private switchEndpoint(): void {
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % API_ENDPOINTS.length;
  }

  public getSymbolSource(symbol: string): ExchangeSource {
    return this.symbolSourceCache.get(symbol.toUpperCase()) || 'binance_spot';
  }

  /**
   * Fetches historical klines for a given symbol and interval with automatic multi-exchange routing
   */
  public async getKlines(symbol: string, interval: KlineInterval, limit = 100): Promise<Candle[]> {
    const sym = symbol.toUpperCase();
    const source = this.symbolSourceCache.get(sym);

    if (source === 'binance_futures') {
      return this.getBinanceFuturesKlines(sym, interval, limit);
    } else if (source === 'mexc') {
      return this.getMexcKlines(sym, interval, limit);
    } else if (source === 'bitfinex') {
      return this.getBitfinexKlines(sym, interval, limit);
    }

    // Try Binance Spot first
    const spotCandles = await this.getBinanceSpotKlines(sym, interval, limit);
    if (spotCandles.length > 0) {
      this.symbolSourceCache.set(sym, 'binance_spot');
      return spotCandles;
    }

    // Fallback 1: Binance USDⓈ-M Futures (e.g. HYPE)
    const futuresCandles = await this.getBinanceFuturesKlines(sym, interval, limit);
    if (futuresCandles.length > 0) {
      this.symbolSourceCache.set(sym, 'binance_futures');
      return futuresCandles;
    }

    // Fallback 2: MEXC (e.g. WBT)
    const mexcCandles = await this.getMexcKlines(sym, interval, limit);
    if (mexcCandles.length > 0) {
      this.symbolSourceCache.set(sym, 'mexc');
      return mexcCandles;
    }

    // Fallback 3: Bitfinex (e.g. LEO)
    const bfxCandles = await this.getBitfinexKlines(sym, interval, limit);
    if (bfxCandles.length > 0) {
      this.symbolSourceCache.set(sym, 'bitfinex');
      return bfxCandles;
    }

    return [];
  }

  /**
   * Binance Spot klines
   */
  private async getBinanceSpotKlines(symbol: string, interval: KlineInterval, limit: number): Promise<Candle[]> {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = `${this.getBaseUrl()}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

        if (!res.ok) {
          if (res.status === 400) return []; // Invalid symbol on spot
          if (res.status === 429) throw new Error('Rate limit exceeded');
          throw new Error(`HTTP error ${res.status}`);
        }

        const rawData = await res.json();
        if (!Array.isArray(rawData)) return [];

        const candles = rawData.map((item: any[]) => ({
          time: Math.floor(item[0] / 1000),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5]),
        }));

        // Reject stale/delisted pairs returning ancient history (e.g. XMR returning 2024 candles)
        if (candles.length > 0) {
          const lastCandleTime = candles[candles.length - 1].time;
          const twoDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 2;
          if (lastCandleTime < twoDaysAgo) {
            return [];
          }
        }

        return candles;
      } catch (err) {
        if (attempt === maxRetries) return [];
        this.switchEndpoint();
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    return [];
  }

  /**
   * Binance USDⓈ-M Futures klines (e.g. HYPEUSDT)
   */
  private async getBinanceFuturesKlines(symbol: string, interval: KlineInterval, limit: number): Promise<Candle[]> {
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return [];

      const rawData = await res.json();
      if (!Array.isArray(rawData)) return [];

      return rawData.map((item: any[]) => ({
        time: Math.floor(item[0] / 1000),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      }));
    } catch {
      return [];
    }
  }

  /**
   * MEXC klines (e.g. WBTUSDT)
   */
  private async getMexcKlines(symbol: string, interval: KlineInterval, limit: number): Promise<Candle[]> {
    try {
      // MEXC uses 60m instead of 1h
      const mexcInterval = interval === '1h' ? '60m' : interval;
      const url = `https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${mexcInterval}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return [];

      const rawData = await res.json();
      if (!Array.isArray(rawData)) return [];

      return rawData.map((item: any[]) => ({
        time: Math.floor(item[0] / 1000),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Bitfinex klines (e.g. LEOUSDT -> tLEOUSD)
   */
  private async getBitfinexKlines(symbol: string, interval: KlineInterval, limit: number): Promise<Candle[]> {
    try {
      const base = symbol.replace(/USDT?$/, '');
      const bfxSymbol = `t${base}USD`;
      const bfxInterval = interval === '1d' ? '1D' : interval;
      const url = `https://api-pub.bitfinex.com/v2/candles/trade:${bfxInterval}:${bfxSymbol}/hist?limit=${limit}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return [];

      const rawData = await res.json();
      if (!Array.isArray(rawData)) return [];

      // Bitfinex returns newest first, reverse to chronological order (oldest first)
      const reversed = [...rawData].reverse();

      return reversed.map((item: any[]) => ({
        time: Math.floor(item[0] / 1000),
        open: parseFloat(item[1]),
        high: parseFloat(item[3]),
        low: parseFloat(item[4]),
        close: parseFloat(item[2]),
        volume: parseFloat(item[5]),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Concurrently fetch klines for multiple symbols with batch concurrency throttle
   */
  public async batchFetchKlines(
    symbols: string[],
    interval: KlineInterval,
    limit = 3,
    concurrency = 12
  ): Promise<Map<string, Candle[]>> {
    const results = new Map<string, Candle[]>();
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < symbols.length) {
        const index = currentIndex++;
        const symbol = symbols[index];
        const candles = await this.getKlines(symbol, interval, limit);
        if (candles.length > 0) {
          results.set(symbol, candles);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }

  /**
   * Fetches 24h ticker statistics for real-time prices across Spot, Futures, MEXC, and Bitfinex
   */
  public async get24hTickers(): Promise<Map<string, { price: number; change24h: number; volume: number }>> {
    const map = new Map<string, { price: number; change24h: number; volume: number }>();

    // 1. Binance Spot
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/v3/ticker/24hr`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            // Reject delisted/halted spot symbols where order book has no active bids/asks
            const hasBidsAsks = parseFloat(item.bidPrice) > 0 || parseFloat(item.askPrice) > 0;
            if (!hasBidsAsks) {
              continue;
            }
            // If explicitly routed to another exchange (e.g. futures), let that exchange take precedence
            if (this.symbolSourceCache.get(item.symbol) === 'binance_futures') {
              continue;
            }

            map.set(item.symbol, {
              price: parseFloat(item.lastPrice) || 0,
              change24h: parseFloat(item.priceChangePercent) || 0,
              volume: parseFloat(item.quoteVolume) || 0,
            });
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch 24h tickers:', e);
    }

    // 2. Binance Futures (for HYPE, XMR, KAS, and any futures-only tokens)
    try {
      const fRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (fRes.ok) {
        const fData = await fRes.json();
        if (Array.isArray(fData)) {
          for (const item of fData) {
            const isExplicitFutures = this.symbolSourceCache.get(item.symbol) === 'binance_futures';
            if (!map.has(item.symbol) || isExplicitFutures) {
              map.set(item.symbol, {
                price: parseFloat(item.lastPrice) || 0,
                change24h: parseFloat(item.priceChangePercent) || 0,
                volume: parseFloat(item.quoteVolume) || 0,
              });
            }
          }
        }
      }
    } catch (_) {}

    // 3. MEXC (for WBT)
    try {
      const wbtRes = await fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=WBTUSDT');
      if (wbtRes.ok) {
        const wbt = await wbtRes.json();
        if (wbt && wbt.lastPrice) {
          map.set('WBTUSDT', {
            price: parseFloat(wbt.lastPrice) || 0,
            change24h: (parseFloat(wbt.priceChangePercent) || 0) * 100,
            volume: parseFloat(wbt.quoteVolume) || 0,
          });
        }
      }
    } catch (_) {}

    // 4. Bitfinex (for LEO)
    try {
      const leoRes = await fetch('https://api-pub.bitfinex.com/v2/ticker/tLEOUSD');
      if (leoRes.ok) {
        const leo = await leoRes.json();
        if (Array.isArray(leo) && leo.length >= 7) {
          map.set('LEOUSDT', {
            price: parseFloat(leo[6]) || 0,
            change24h: (parseFloat(leo[5]) || 0) * 100,
            volume: parseFloat(leo[7]) || 0,
          });
        }
      }
    } catch (_) {}

    return map;
  }
}

export const binanceService = new BinanceService();
