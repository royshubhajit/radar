import React from 'react';
import { AlertItem, AlertTimeframe } from '../types';
import { TrendingDown, ArrowDownRight, BarChart2, ShieldAlert, RefreshCw } from 'lucide-react';

interface AlertFeedProps {
  alerts: AlertItem[];
  selectedSymbol: string;
  onSelectCoin: (symbol: string, name: string, timeframe?: AlertTimeframe, price?: number) => void;
  thresholdPercent: number;
  timeframe: string;
  isScanning: boolean;
  onLowerThreshold: (newVal: number) => void;
  onTimeframeChange?: (tf: AlertTimeframe) => void;
}

export const AlertFeed: React.FC<AlertFeedProps> = ({
  alerts,
  selectedSymbol,
  onSelectCoin,
  thresholdPercent,
  timeframe,
  isScanning,
  onLowerThreshold,
  onTimeframeChange,
}) => {
  const formatDropDate = (timeMs: number, tf: string) => {
    const d = new Date(timeMs);
    if (tf === '1d') {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    } else if (tf === '4h' || tf === '1h') {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  };



  // Up to 6 digits post decimal for higher precision on open and close
  const formatPrice6 = (val: number | undefined | null) => {
    if (val === undefined || val === null || isNaN(val) || val <= 0) return '--';
    if (val < 0.000001) return val.toFixed(8);
    return val.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  };

  const formatVolume = (val: number) => {
    if (!val) return '--';
    if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toFixed(0);
  };

  const formatTimeAgo = (closedMs: number) => {
    const diffMin = Math.floor((Date.now() - closedMs) / 60000);
    if (diffMin <= 0) return 'Just now';
    if (diffMin === 1) return '1m ago';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h ${diffMin % 60}m ago`;
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] border border-[#1e2638] rounded-xl overflow-hidden shadow-2xl">
      {/* Alert Feed Header */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#121722] border-b border-[#1e2638] gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-rose-500/20 text-rose-400">
            <TrendingDown className="w-4 h-4 text-rose-500" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide font-mono flex items-center gap-2">
              LIVE DROP ALERTS
              <span className="text-[11px] px-2 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 font-mono">
                {alerts.length} Detected
              </span>
              {isScanning && (
                <span className="text-[10px] text-blue-400 font-normal flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Scanning...
                </span>
              )}
            </h2>
          </div>
        </div>

        {/* Timeframe Filter Buttons: 15m, 1h, 4h, 1d */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">Timeframe:</span>
          <div className="flex items-center bg-[#0b0e14] border border-[#242e42] p-0.5 rounded-lg gap-0.5">
            {(['15m', '1h', '4h', '1d'] as AlertTimeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange?.(tf)}
                className={`px-2.5 py-0.5 text-xs font-mono font-bold rounded transition-all ${
                  timeframe === tf
                    ? 'bg-rose-500 text-white shadow-sm shadow-rose-600/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#182130]'
                }`}
                title={`Filter drop alerts for closed ${tf} candles`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="text-[11px] font-mono text-slate-400 pl-2 border-l border-[#242e42] hidden md:block">
            Ranked by <span className="text-rose-400 font-bold">Drop % &darr;</span>
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#161d2b] border border-[#232d42] flex items-center justify-center mb-3 text-slate-500">
              <ShieldAlert className="w-7 h-7 text-slate-400" />
            </div>
            <h3 className="text-sm font-bold text-slate-200 font-mono mb-1">
              No Coins Dropped &ge; {thresholdPercent}% on {timeframe} Candle
            </h3>
            <p className="text-xs text-slate-400 max-w-md mb-4">
              Currently, none of the Top 100 cryptocurrencies closed a {timeframe} red candle with a drop equal to or exceeding {thresholdPercent}%.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Try lowering threshold:</span>
              {[0.4, 0.8, 1.0, 1.2].map((t) => (
                <button
                  key={t}
                  onClick={() => onLowerThreshold(t)}
                  className="px-2.5 py-1 text-xs font-mono font-medium rounded-lg bg-[#1a2334] hover:bg-blue-600/30 hover:border-blue-500/50 border border-[#2c3a54] text-slate-300 transition-colors"
                >
                  {t}%
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0e131d] text-[11px] font-mono text-slate-400 border-b border-[#1a2233] sticky top-0 z-10">
                  <th className="py-2.5 px-3 font-semibold text-center w-12">#</th>
                  <th className="py-2.5 px-3 font-semibold">ASSET</th>
                  <th className="py-2.5 px-3 font-semibold text-right">DROP % (STREAK)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">OPEN (LATEST)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">CLOSE (LATEST)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">VOLUME (LATEST)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">CLOSED</th>
                  <th className="py-2.5 px-3 font-semibold text-center w-24">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151c2a] text-xs font-mono">
                {alerts.map((alert, index) => {
                  const isSelected = alert.symbol === selectedSymbol;
                  const isSevere = alert.dropPercent >= 8;

                  return (
                    <tr
                      key={alert.symbol}
                      onClick={() => {
                        const alertPrice = (alert.currentPrice && alert.currentPrice > 0) ? alert.currentPrice : alert.closePrice;
                        onSelectCoin(alert.symbol, alert.name, alert.timeframe, alertPrice);
                      }}
                      className={`cursor-pointer transition-all hover:bg-[#151b27] ${
                        isSelected
                          ? 'bg-blue-950/30 border-l-4 border-blue-500'
                          : alert.isNew
                          ? 'bg-rose-950/20'
                          : ''
                      }`}
                    >
                      {/* Descending Rank Indicator */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold ${
                            index === 0
                              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                              : index === 1
                              ? 'bg-rose-700/80 text-rose-100'
                              : index === 2
                              ? 'bg-rose-800/60 text-rose-200'
                              : 'bg-[#182030] text-slate-400'
                          }`}
                        >
                          {index + 1}
                        </span>
                      </td>

                      {/* Coin Details */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 font-bold text-white tracking-tight flex-wrap">
                              <span>{alert.baseAsset}</span>
                              <span className="text-[10px] px-1 py-0.2 rounded bg-[#1e2638] text-slate-400">
                                #{alert.rank}
                              </span>

                              {/* Consecutive Red Candle Pill Badge */}
                              {alert.consecutiveRedCount <= 1 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40" title="1st red candle after green/neutral price action">
                                  1st Red
                                </span>
                              ) : alert.consecutiveRedCount === 2 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-orange-500/25 text-orange-300 border border-orange-500/50" title="2nd consecutive red candle in a row">
                                  2nd Red
                                </span>
                              ) : alert.consecutiveRedCount === 3 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/25 text-rose-300 border border-rose-500/50" title="3rd consecutive red candle in a row">
                                  3rd Red 🔥
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold bg-red-600/35 text-red-200 border border-red-500/60 shadow-sm shadow-red-900/40 animate-pulse flex items-center gap-0.5" title={`${alert.consecutiveRedCount} consecutive red candles in a row!`}>
                                  <span>{alert.consecutiveRedCount}x Red</span>
                                  <span>🔥</span>
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                              {alert.name}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Drop Percentage (Descending Order) & Consecutive Drops Side by Side */}
                      <td className="py-3 px-3 text-right">
                        {alert.consecutiveDrops && alert.consecutiveDrops.length > 1 ? (
                          <div className="flex flex-col items-end gap-1">
                            {/* Side-by-side drops in chronological order (Oldest -> Latest) */}
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {alert.consecutiveDrops.map((d, i) => (
                                <div
                                  key={i}
                                  title={
                                    d.isLatest
                                      ? `Latest Closed ${alert.timeframe} Candle (${formatDropDate(d.candleTime, alert.timeframe)}): -${d.dropPercent}%`
                                      : `Prior Red Candle #${i + 1} (${formatDropDate(d.candleTime, alert.timeframe)}): -${d.dropPercent}%`
                                  }
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-all flex items-center gap-0.5 ${
                                    d.isLatest
                                      ? 'bg-rose-600 text-white font-bold ring-1 ring-white/80 shadow-sm shadow-rose-600/50'
                                      : 'bg-rose-950/70 text-rose-300 border border-rose-800/80 font-medium'
                                  }`}
                                >
                                  <span className="text-[8.5px] text-slate-300 font-sans opacity-85 mr-0.5">
                                    {formatDropDate(d.candleTime, alert.timeframe)}:
                                  </span>
                                  <span>-{d.dropPercent.toFixed(2)}%</span>
                                  {d.isLatest && (
                                    <span className="text-[7.5px] uppercase tracking-tight bg-black/50 px-1 py-0.2 rounded text-rose-200 ml-0.5 font-sans">
                                      Latest
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                            {/* Chronological direction cue */}
                            <div className="text-[8px] font-mono text-slate-500 flex items-center gap-1">
                              <span>old</span>
                              <span>&rarr;</span>
                              <span className="text-rose-400 font-semibold">latest &#9668;</span>
                            </div>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-400 font-bold text-xs">
                            <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
                            <span>-{alert.dropPercent.toFixed(2)}%</span>
                          </div>
                        )}
                        {isSevere && (
                          <div className="text-[9px] text-rose-400 font-semibold tracking-wider uppercase mt-0.5">
                            CRASH ALERT
                          </div>
                        )}
                      </td>

                      {/* Open Price (up to 6 digits post decimal) */}
                      <td className="py-3 px-3 text-right text-slate-300 font-mono">
                        ${formatPrice6(alert.openPrice)}
                      </td>

                      {/* Close Price (up to 6 digits post decimal) */}
                      <td className="py-3 px-3 text-right text-rose-400 font-semibold font-mono">
                        ${formatPrice6(alert.closePrice)}
                      </td>

                      {/* Volume */}
                      <td className="py-3 px-3 text-right text-slate-400">
                        {formatVolume(alert.volume)}
                      </td>

                      {/* Closed Time */}
                      <td className="py-3 px-3 text-right text-slate-400 text-[11px]">
                        {formatTimeAgo(alert.candleClosedTime)}
                      </td>

                      {/* Chart Quick Switch */}
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const alertPrice = (alert.currentPrice && alert.currentPrice > 0) ? alert.currentPrice : alert.closePrice;
                            onSelectCoin(alert.symbol, alert.name, alert.timeframe, alertPrice);
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-[#182130] text-slate-300 hover:bg-blue-600 hover:text-white'
                          }`}
                        >
                          <BarChart2 className="w-3 h-3" />
                          <span>Chart</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
