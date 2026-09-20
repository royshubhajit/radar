import React, { useState, useEffect } from "react";
import { Bell, BellOff, Trash2, CheckCircle2 } from "lucide-react";
import { CandleReminder } from "../types";
import { formatCountdown } from "../services/reminderService";

interface RemindersCardProps {
  reminders: CandleReminder[];
  onRemoveReminder: (id: string) => void;
  onClearAll: () => void;
  onSelectCoin: (symbol: string) => void;
  currentSymbol?: string;
}

export const RemindersCard: React.FC<RemindersCardProps> = ({
  reminders,
  onRemoveReminder,
  onClearAll,
  onSelectCoin,
  currentSymbol,
}) => {
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Update live clock every second for smooth countdowns
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeCount = reminders.filter((r) => !r.triggered).length;

  // Format epoch ms to IST time string HH:mm:ss
  const formatTimeIST = (ms: number): string => {
    try {
      return new Date(ms).toLocaleTimeString("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return "";
    }
  };

  // Sort: Active first by soonest target time, then triggered by trigger time desc
  const sortedReminders = [...reminders].sort((a, b) => {
    if (!a.triggered && b.triggered) return -1;
    if (a.triggered && !b.triggered) return 1;
    if (!a.triggered && !b.triggered) return a.targetTimeMs - b.targetTimeMs;
    return (b.triggeredAt || 0) - (a.triggeredAt || 0);
  });

  return (
    <div className="h-full bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl backdrop-blur-sm flex flex-col">
      {/* Card Header */}
      <div className="border-b border-slate-800 bg-slate-800/40 px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-amber-500/10 text-amber-400">
            <Bell className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200 tracking-wide">Candle Reminders</span>
          {activeCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {activeCount} active
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-800/80 border border-slate-700/50">
              0 active
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {reminders.length > 0 && (
            <button
              onClick={onClearAll}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-300 hover:text-rose-300 bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/40 transition-colors cursor-pointer"
              title="Clear all reminders"
            >
              <Trash2 className="w-3 h-3 text-slate-400 group-hover:text-rose-400" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="p-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Reminders List */}
        {reminders.length === 0 ? (
          <div className="h-full py-4 px-3 text-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 flex flex-col items-center justify-center gap-1.5">
            <div className="p-2 rounded-full bg-slate-800/60 text-slate-500">
              <BellOff className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-slate-300">No Reminders Set</span>
            <p className="text-[11px] text-slate-400 max-w-[260px] leading-tight">
              Click <strong className="text-amber-300">🔔 Remind</strong> in chart header to get alerted when the next candle starts.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 custom-scrollbar flex flex-col gap-1.5">
            {sortedReminders.map((r) => {
              const base = r.symbol.replace(/USDT?$/, "");
              const isCurrent = r.symbol === currentSymbol;

              return (
                <div
                  key={r.id}
                  className={`p-2 rounded-lg border transition-all flex items-center justify-between gap-2 shrink-0 ${
                    r.triggered
                      ? "bg-emerald-950/20 border-emerald-500/30"
                      : isCurrent
                      ? "bg-amber-500/10 border-amber-500/40"
                      : "bg-slate-800/40 hover:bg-slate-800/70 border-slate-700/50"
                  }`}
                >
                  {/* Left: Coin symbol and timeframe */}
                  <button
                    onClick={() => onSelectCoin(r.symbol)}
                    className="flex items-center gap-1.5 text-left cursor-pointer group"
                    title={`View ${base} on chart`}
                  >
                    <span className="text-xs font-bold font-mono text-white group-hover:text-blue-400 transition-colors">
                      {base}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      {r.interval}
                    </span>
                  </button>

                  {/* Center: Countdown or Triggered status */}
                  <div className="flex flex-col items-center flex-1 min-w-0">
                    {r.triggered ? (
                      <div className="flex items-center gap-1 text-emerald-400 text-[11px] font-mono font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Candle Started</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                        <span className="text-xs font-bold text-amber-300">
                          {formatCountdown(r.targetTimeMs, nowMs)}
                        </span>
                      </div>
                    )}
                    <span className="text-[9px] font-mono text-slate-400 truncate">
                      {r.triggered ? `Triggered at ${formatTimeIST(r.triggeredAt || r.targetTimeMs)} IST` : `At ${formatTimeIST(r.targetTimeMs)} IST`}
                    </span>
                  </div>

                  {/* Right: Individual Delete Trash Button */}
                  <button
                    onClick={() => onRemoveReminder(r.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 rounded transition-colors cursor-pointer"
                    title="Delete reminder"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
