import { AlertItem, AlertTimeframe, CoinInfo, MiniCandle, ScannerConfig, ScannerStatus } from '../types';
import { marketCapService } from './marketCapService';
import { binanceService } from './binanceService';
import { soundService } from './soundService';

type Listener = () => void;

function getSecondsUntilNextCandleClose(timeframe: AlertTimeframe): number {
  const now = Date.now();
  let intervalMs = 15 * 60 * 1000;
  if (timeframe === '15m') intervalMs = 15 * 60 * 1000;
  else if (timeframe === '1h') intervalMs = 60 * 60 * 1000;
  else if (timeframe === '4h') intervalMs = 4 * 60 * 60 * 1000;
  else if (timeframe === '1d') intervalMs = 24 * 60 * 60 * 1000;

  // Next boundary + 2.5s buffer so exchange finalizes closed candle
  const nextBoundary = Math.ceil(now / intervalMs) * intervalMs + 2500;
  const diffSec = Math.floor((nextBoundary - now) / 1000);
  return Math.max(1, diffSec);
}

class ScannerEngine {
  private config: ScannerConfig = {
    timeframe: '15m',
    thresholdPercent: 0.8, // default 0.8% drop
    isSoundEnabled: true,
    soundVolume: 0.5,
    autoScanIntervalSeconds: 60,
  };

  private status: ScannerStatus = {
    isScanning: false,
    lastScannedAt: null,
    nextScanIn: 60,
    totalScanned: 0,
    error: null,
  };

  private coins: CoinInfo[] = [];
  private alerts: AlertItem[] = [];
  private alertsByTimeframe = new Map<AlertTimeframe, AlertItem[]>();
  private history16Map = new Map<string, MiniCandle[]>();
  private previousAlertSymbols = new Set<string>();
  private listeners = new Set<Listener>();
  private timer: any = null;
  private countdownTimer: any = null;
  private history16Timer: any = null;
  private top100Timer: any = null;
  private isInitialScan = true;

  constructor() {
    // Load config from localStorage if available
    try {
      const savedConfig = localStorage.getItem('crypto_scanner_config');
      if (savedConfig) {
        this.config = { ...this.config, ...JSON.parse(savedConfig) };
      }
    } catch (_) {}
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getConfig(): ScannerConfig {
    return { ...this.config };
  }

  public getStatus(): ScannerStatus {
    return { ...this.status };
  }

  public getCoins(): CoinInfo[] {
    return [...this.coins];
  }

  public getAlerts(): AlertItem[] {
    return [...this.alerts];
  }

  public getHistory16Map(): Map<string, MiniCandle[]> {
    return this.history16Map;
  }

  public updateConfig(newConfig: Partial<ScannerConfig>): void {
    const timeframeChanged = newConfig.timeframe && newConfig.timeframe !== this.config.timeframe;
    this.config = { ...this.config, ...newConfig };
    
    try {
      localStorage.setItem('crypto_scanner_config', JSON.stringify(this.config));
    } catch (_) {}

    // If timeframe changed, load cached alerts immediately, reset countdown, and trigger scan
    if (timeframeChanged && newConfig.timeframe) {
      const cached = this.alertsByTimeframe.get(newConfig.timeframe);
      if (cached) {
        this.alerts = cached.filter((a) => a.dropPercent >= this.config.thresholdPercent);
      } else {
        this.alerts = [];
      }
      this.status.nextScanIn = getSecondsUntilNextCandleClose(this.config.timeframe);
      this.notify();
      this.runScan(true);
    } else {
      // Re-filter and sort current alerts if only threshold changed
      this.reFilterAlerts();
      this.notify();
    }
  }

  private reFilterAlerts(): void {
    const cached = this.alertsByTimeframe.get(this.config.timeframe) || this.alerts;
    this.alerts = cached.filter((a) => a.dropPercent >= this.config.thresholdPercent);
    this.alerts.sort((a, b) => b.dropPercent - a.dropPercent);
  }

  public async fetch16History(): Promise<void> {
    try {
      if (this.coins.length === 0) {
        this.coins = await marketCapService.getTop100Coins();
      }
      const symbols = this.coins.map((c) => c.binanceSymbol);
      const klinesMap = await binanceService.batchFetchKlines(symbols, '15m', 18, 15);

      for (const [symbol, candles] of klinesMap.entries()) {
        if (candles.length >= 2) {
          // Last 16 completed closed candles (excluding forming candle at candles.length - 1)
          const closed = candles.slice(Math.max(0, candles.length - 17), candles.length - 1);
          const miniList: MiniCandle[] = closed.map((c) => ({
            isGreen: c.close >= c.open,
            changePercent: parseFloat((((c.close - c.open) / (c.open || 1)) * 100).toFixed(2)),
            time: c.time,
            open: c.open,
            close: c.close,
          }));
          this.history16Map.set(symbol, miniList);
        }
      }
      this.notify();
    } catch (e) {
      console.warn('Failed to fetch 16-candle history:', e);
    }
  }

  /**
   * Refreshes real-time Binance prices and 24h change for all Top 100 coins
   * Runs every 30 seconds so watchlist is 100% synchronized with chart prices
   */
  public async refreshTop100Prices(): Promise<void> {
    try {
      if (this.coins.length === 0) {
        this.coins = await marketCapService.getTop100Coins();
      }

      const tickerMap = await binanceService.get24hTickers();
      if (tickerMap.size > 0) {
        let updated = false;
        for (const coin of this.coins) {
          const ticker = tickerMap.get(coin.binanceSymbol);
          if (ticker && ticker.price > 0) {
            coin.priceUsd = ticker.price;
            coin.change24h = ticker.change24h;
            updated = true;
          }
        }
        if (updated) {
          this.notify();
        }
      }
    } catch (e) {
      console.warn('Failed to refresh top 100 prices from Binance:', e);
    }
  }

  public async start(): Promise<void> {
    // Stop any existing timers
    this.stop();

    // 1. Initial refresh of Top 100 Binance prices
    await this.refreshTop100Prices();

    // 2. Refresh Top 100 watchlist prices from Binance every 30 seconds
    this.top100Timer = window.setInterval(() => {
      this.refreshTop100Prices();
    }, 30 * 1000);

    // 3. Initial scan (silent on initial page load)
    await this.runScan(true);

    // 4. Initial 16-candle history fetch and 15-minute refresh
    this.fetch16History();
    this.history16Timer = window.setInterval(() => {
      this.fetch16History();
    }, 15 * 60 * 1000);

    // 5. Candle-close countdown timer: drop alerts scan refreshes strictly when candle closes (e.g. 15m)
    this.status.nextScanIn = getSecondsUntilNextCandleClose(this.config.timeframe);
    this.countdownTimer = window.setInterval(() => {
      if (this.status.nextScanIn > 1) {
        this.status.nextScanIn--;
        this.notify();
      } else {
        // Candle close boundary reached! Execute scan and reset countdown
        this.runScan(false);
        this.status.nextScanIn = getSecondsUntilNextCandleClose(this.config.timeframe);
        this.notify();
      }
    }, 1000);
  }

  public stop(): void {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.top100Timer) {
      window.clearInterval(this.top100Timer);
      this.top100Timer = null;
    }
    if (this.countdownTimer) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.history16Timer) {
      window.clearInterval(this.history16Timer);
      this.history16Timer = null;
    }
  }

  public async runScan(isSilent = false): Promise<void> {
    if (this.status.isScanning) return;

    this.status.isScanning = true;
    this.status.error = null;
    this.notify();

    try {
      // 1. Fetch or get top 100 coins
      if (this.coins.length === 0) {
        this.coins = await marketCapService.getTop100Coins();
      }

      const coinMap = new Map<string, CoinInfo>();
      const symbols: string[] = [];
      for (const coin of this.coins) {
        coinMap.set(coin.binanceSymbol, coin);
        symbols.push(coin.binanceSymbol);
      }

      // 2. Batch fetch klines (limit = 25 gives historical candles for consecutive red check)
      const klinesMap = await binanceService.batchFetchKlines(symbols, this.config.timeframe, 25, 15);

      // 3. Evaluate closed candles
      const newAlerts: AlertItem[] = [];
      let newAlertsFound = 0;

      for (const [symbol, candles] of klinesMap.entries()) {
        if (candles.length < 2) continue;

        // If scanning on 15m, also keep the 16-candle watchlist history fresh
        if (this.config.timeframe === '15m') {
          const closed16 = candles.slice(Math.max(0, candles.length - 17), candles.length - 1);
          const miniList: MiniCandle[] = closed16.map((c) => ({
            isGreen: c.close >= c.open,
            changePercent: parseFloat((((c.close - c.open) / (c.open || 1)) * 100).toFixed(2)),
            time: c.time,
            open: c.open,
            close: c.close,
          }));
          this.history16Map.set(symbol, miniList);
        }

        // candles[candles.length - 2] is the completed closed candle
        const closedCandle = candles[candles.length - 2];
        const formingCandle = candles[candles.length - 1];

        const open = closedCandle.open;
        const close = closedCandle.close;
        const isRed = close < open;

        if (isRed && open > 0) {
          const dropPercent = ((open - close) / open) * 100;

          if (dropPercent >= this.config.thresholdPercent) {
            const coin = coinMap.get(symbol);
            const isNewlyAlerted = !this.previousAlertSymbols.has(symbol);
            if (isNewlyAlerted) {
              newAlertsFound++;
            }

            // Collect all consecutive red closed candles up to this closed candle
            const consecutiveCandles: Array<{ candle: typeof closedCandle; isLatest: boolean }> = [];
            for (let i = candles.length - 2; i >= 0; i--) {
              if (candles[i].close < candles[i].open) {
                consecutiveCandles.push({ candle: candles[i], isLatest: i === candles.length - 2 });
              } else {
                break;
              }
            }
            const consecutiveReds = consecutiveCandles.length;

            // Reverse so they are in chronological order (Oldest -> Latest)
            consecutiveCandles.reverse();
            const consecutiveDrops = consecutiveCandles.map((item) => {
              const c = item.candle;
              const d = ((c.open - c.close) / (c.open || 1)) * 100;
              return {
                dropPercent: parseFloat(d.toFixed(2)),
                openPrice: c.open,
                closePrice: c.close,
                candleTime: c.time * 1000,
                isLatest: item.isLatest,
              };
            });

            // Interval in milliseconds to compute close time
            let intervalMs = 15 * 60 * 1000;
            if (this.config.timeframe === '15m') intervalMs = 15 * 60 * 1000;
            else if (this.config.timeframe === '1h') intervalMs = 60 * 60 * 1000;
            else if (this.config.timeframe === '4h') intervalMs = 4 * 60 * 60 * 1000;
            else if (this.config.timeframe === '1d') intervalMs = 24 * 60 * 60 * 1000;

            const openTimeMs = closedCandle.time * 1000;
            const closeTimeMs = openTimeMs + intervalMs - 1;

            newAlerts.push({
              symbol: symbol,
              baseAsset: coin?.symbol || symbol.replace('USDT', ''),
              name: coin?.name || symbol,
              rank: coin?.rank || 999,
              timeframe: this.config.timeframe,
              dropPercent: parseFloat(dropPercent.toFixed(2)),
              openPrice: open,
              closePrice: close,
              highPrice: closedCandle.high,
              lowPrice: closedCandle.low,
              volume: closedCandle.volume,
              candleTime: openTimeMs,
              candleClosedTime: closeTimeMs,
              currentPrice: formingCandle.close,
              consecutiveRedCount: consecutiveReds,
              consecutiveDrops: consecutiveDrops,
              isNew: isNewlyAlerted,
            });
          }
        }
      }

      // 4. Sort alerts in STRICT DESCENDING ORDER of percentage drop
      newAlerts.sort((a, b) => b.dropPercent - a.dropPercent);

      // Cache alerts for this timeframe and update state
      this.alertsByTimeframe.set(this.config.timeframe, newAlerts);
      this.alerts = newAlerts;

      // Update alert symbols set for future comparison
      const currentAlertSymbols = new Set(newAlerts.map(a => a.symbol));
      this.previousAlertSymbols = currentAlertSymbols;

      // 5. Trigger audio chime if new drop alerts appeared on automated candle close
      if (!isSilent && !this.isInitialScan && newAlertsFound > 0 && this.config.isSoundEnabled) {
        soundService.playDropAlert(this.config.soundVolume);
      }
      this.isInitialScan = false;

      this.status.totalScanned = klinesMap.size;
      this.status.lastScannedAt = Date.now();
      this.status.nextScanIn = getSecondsUntilNextCandleClose(this.config.timeframe);
    } catch (err: any) {
      console.error('Scan execution error:', err);
      this.status.error = err.message || 'Scan failed';
    } finally {
      this.status.isScanning = false;
      this.notify();
    }
  }
}

export const scannerEngine = new ScannerEngine();
