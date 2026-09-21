export type KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type AlertTimeframe = '15m' | '1h' | '4h' | '1d';

export interface CoinInfo {
  id: string;
  symbol: string;
  binanceSymbol: string;
  name: string;
  rank: number;
  priceUsd: number;
  change24h: number;
  marketCapUsd: number;
}

export interface Candle {
  time: number; // unix timestamp in seconds for lightweight-charts
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ConsecutiveDropInfo {
  dropPercent: number;
  openPrice: number;
  closePrice: number;
  candleTime: number;
  isLatest: boolean;
}

export interface AlertItem {
  symbol: string;         // e.g. "BTCUSDT"
  baseAsset: string;      // e.g. "BTC"
  name: string;
  rank: number;
  timeframe: AlertTimeframe;
  dropPercent: number;    // e.g. 12.42 (positive value representing % drop)
  openPrice: number;      // Latest closed candle open
  closePrice: number;     // Latest closed candle close
  highPrice: number;      // Latest closed candle high
  lowPrice: number;       // Latest closed candle low
  volume: number;         // Latest closed candle volume
  candleTime: number;     // ms timestamp of candle open
  candleClosedTime: number; // ms timestamp of candle close
  currentPrice: number;
  consecutiveRedCount: number; // 1 = 1st red candle, 2 = 2nd consecutive red, etc.
  consecutiveDrops: ConsecutiveDropInfo[]; // Chronological drops: oldest to latest
  isNew?: boolean;
}

export interface MiniCandle {
  isGreen: boolean;
  changePercent: number;
  time: number;
  open: number;
  close: number;
}

export interface ScannerConfig {
  timeframe: AlertTimeframe;
  thresholdPercent: number;
  isSoundEnabled: boolean;
  soundVolume: number;
  autoScanIntervalSeconds: number;
}

export interface ScannerStatus {
  isScanning: boolean;
  lastScannedAt: number | null;
  nextScanIn: number;
  totalScanned: number;
  error: string | null;
}

export interface PredictionItem {
  id: string;
  symbol: string;
  loggedTime: string;
  currentPrice: number;
  predictedPrice: number;
  changePercent: number;
  highestPrice?: number;
  lowestPrice?: number;
  lastCheckedAt?: string;
  status: 'Wrong' | 'Right';
  rightAt?: string;
  checking?: 'Yes' | 'No';
  notes?: string;
  checkingSource?: string;
  elapsedTime?: string;
}

export interface PredictionConfig {
  webhookUrl: string;
  sheetUrl?: string;
}

export interface CandleReminder {
  id: string;
  symbol: string;
  coinName?: string;
  interval: KlineInterval;
  targetTimeMs: number;
  createdAt: number;
  triggered: boolean;
  triggeredAt?: number;
}
