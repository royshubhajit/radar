import { CandleReminder, KlineInterval } from "../types";

const STORAGE_KEY = "crypto_candle_reminders";

export function getIntervalMilliseconds(interval: KlineInterval): number {
  switch (interval) {
    case "1m": return 60 * 1000;
    case "5m": return 5 * 60 * 1000;
    case "15m": return 15 * 60 * 1000;
    case "1h": return 60 * 60 * 1000;
    case "4h": return 4 * 60 * 60 * 1000;
    case "1d": return 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

/**
 * Computes the exact timestamp (ms) when the current candle closes and the next candle starts.
 */
export function getNextCandleStartTime(interval: KlineInterval, fromMs = Date.now()): number {
  const intervalMs = getIntervalMilliseconds(interval);
  const nextBoundary = Math.ceil(fromMs / intervalMs) * intervalMs;
  // If fewer than 1.5 seconds remain before current boundary, target the subsequent one
  if (nextBoundary - fromMs < 1500) {
    return nextBoundary + intervalMs;
  }
  return nextBoundary;
}

/**
 * Format remaining countdown (e.g. "14m 32s" or "1h 05m 12s")
 */
export function formatCountdown(targetTimeMs: number, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((targetTimeMs - nowMs) / 1000));
  if (diffSec <= 0) return "Starting now...";
  
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;

  if (hours > 0) {
    return `${hours}h ${mins.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`;
  }
  return `${mins.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`;
}

class ReminderService {
  public loadReminders(): CandleReminder[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  public saveReminders(reminders: CandleReminder[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
    } catch (e) {
      console.warn("Failed to persist reminders to localStorage:", e);
    }
  }
}

export const reminderService = new ReminderService();
