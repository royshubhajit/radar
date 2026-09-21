import { PredictionConfig, PredictionItem } from '../types';

const CONFIG_KEY = 'crypto_radar_prediction_config';
const HISTORY_KEY = 'crypto_radar_predictions_history';

export function formatToIST(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} IST`;
}

class PredictionService {
  public getConfig(): PredictionConfig {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (_) {}
    return { webhookUrl: '', sheetUrl: '' };
  }

  public saveConfig(config: PredictionConfig): void {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (_) {}
  }

  public getRecentPredictions(): PredictionItem[] {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  public savePredictionLocally(item: PredictionItem): void {
    try {
      const list = this.getRecentPredictions();
      const updated = [item, ...list.filter((p) => p.id !== item.id)].slice(0, 50);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (_) {}
  }

  public async submitPrediction(params: {
    symbol: string;
    currentPrice: number;
    predictedPrice: number;
    changePercent: number;
  }): Promise<{ success: boolean; message: string; savedLocallyOnly?: boolean }> {
    const now = new Date();
    const istString = formatToIST(now);

    const newItem: PredictionItem = {
      id: Date.now().toString(),
      symbol: params.symbol.toUpperCase(),
      loggedTime: istString,
      currentPrice: params.currentPrice,
      predictedPrice: params.predictedPrice,
      changePercent: params.changePercent,
      highestPrice: params.currentPrice,
      lowestPrice: params.currentPrice,
      lastCheckedAt: istString,
      status: 'Wrong',
      rightAt: '',
      checking: 'Yes',
      notes: 'Active',
      checkingSource: 'Binance Futures',
      elapsedTime: '',
    };

    // 1. Always save locally so history is immediately accessible
    this.savePredictionLocally(newItem);

    const config = this.getConfig();
    if (!config.webhookUrl || !config.webhookUrl.trim()) {
      return {
        success: true,
        savedLocallyOnly: true,
        message: 'Saved to local history! Add your Google Apps Script URL in Settings to sync with Google Sheet.',
      };
    }

    // 2. Submit to Google Apps Script Web App
    try {
      const payload = {
        symbol: newItem.symbol,
        currentTime: newItem.loggedTime,
        currentPrice: newItem.currentPrice,
        predictedPrice: newItem.predictedPrice,
        changePercent: newItem.changePercent,
        checkingSource: newItem.checkingSource,
      };

      // We use Content-Type text/plain and no-cors mode to ensure smooth delivery across Google Apps Script redirects
      await fetch(config.webhookUrl.trim(), {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

      return {
        success: true,
        message: 'Logged to Google Sheet and local history!',
      };
    } catch (err: any) {
      console.error('Failed to post prediction to Google Sheet:', err);
      return {
        success: true,
        savedLocallyOnly: true,
        message: 'Saved locally, but Google Sheet webhook failed to connect. Check your Webhook URL in Settings.',
      };
    }
  }

  public async syncFromSheet(): Promise<PredictionItem[]> {
    const config = this.getConfig();
    if (!config.webhookUrl || !config.webhookUrl.trim()) {
      return this.getRecentPredictions();
    }

    try {
      const res = await fetch(config.webhookUrl.trim());
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'success' && Array.isArray(json.data)) {
          const mapped: PredictionItem[] = json.data.map((row: any, idx: number) => ({
            id: `sheet-${idx}-${row.loggedTime}`,
            symbol: row.symbol,
            loggedTime: row.loggedTime,
            currentPrice: parseFloat(row.currentPrice) || 0,
            predictedPrice: parseFloat(row.predictedPrice) || 0,
            changePercent: parseFloat(row.changePercent) || 0,
            highestPrice: parseFloat(row.highestPrice) || 0,
            lowestPrice: parseFloat(row.lowestPrice) || 0,
            lastCheckedAt: row.lastCheckedAt,
            status: row.status === 'Right' ? 'Right' : 'Wrong',
            rightAt: row.rightAt,
            checking: row.checking === 'No' ? 'No' : 'Yes',
            notes: row.notes || '',
            checkingSource: row.checkingSource || 'Binance Futures',
            elapsedTime: row.elapsedTime || '',
          }));

          // Merge with local storage
          localStorage.setItem(HISTORY_KEY, JSON.stringify(mapped.slice(0, 50)));
          return mapped;
        }
      }
    } catch (_) {}

    return this.getRecentPredictions();
  }
}

export const predictionService = new PredictionService();
