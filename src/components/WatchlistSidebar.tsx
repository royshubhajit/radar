import React, { useState, useMemo } from 'react';
import { CoinInfo, MiniCandle } from '../types';
import { Search, TrendingUp, TrendingDown, X } from 'lucide-react';
import { formatPriceDisplay } from '../utils/priceFormatter';

interface WatchlistSidebarProps {
  coins: CoinInfo[];
  selectedSymbol: string;
  onSelectCoin: (symbol: string, name: string, price?: number) => void;
  alertedSymbols: Set<string>;
  history16Map?: Map<string, MiniCandle[]>;
}

export const WatchlistSidebar: React.FC<WatchlistSidebarProps> = ({
  coins,
  selectedSymbol,
  onSelectCoin,
  alertedSymbols,
  history16Map,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCoins = useMemo(() => {
    if (!searchQuery.trim()) return coins;
    const q = searchQuery.toLowerCase().trim();
    return coins.filter(
      (c) =>
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.binanceSymbol.toLowerCase().includes(q)
    );
  }, [coins, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] border border-[#1e2638] rounded-xl overflow-hidden shadow-2xl">
      {/* Header & Search */}
      <div className="p-3 bg-[#121722] border-b border-[#1e2638]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase flex items-center gap-1.5">
            Top 100 Watchlist
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#1f283d] text-blue-400 font-mono">
              {coins.length}
            </span>
          </h2>
          {alertedSymbols.size > 0 && (
            <span className="text-[10px] font-mono text-rose-400 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
              {alertedSymbols.size} Alerted
            </span>
          )}
        </div>

        {/* Search input with cross clear button */}
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search coin or symbol..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0b0e14] border border-[#232d42] rounded-lg pl-8 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100 p-0.5 rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 16 Candle Strip Legend / Direction Indicator */}
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[#1c2436] text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1">
            <span>Last 16 (15m):</span>
            <span className="text-slate-400">Past</span>
            <span className="text-blue-400">&rarr;</span>
            <span className="text-cyan-400 font-bold">Latest &#9668;</span>
          </span>
          <span className="text-[9px] text-slate-400">Auto 15m</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#131924]">
        {filteredCoins.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 font-mono">
            No coins matching "{searchQuery}"
          </div>
        ) : (
          filteredCoins.map((coin) => {
            const isSelected = coin.binanceSymbol === selectedSymbol;
            const hasAlert = alertedSymbols.has(coin.binanceSymbol);
            const history16 = history16Map?.get(coin.binanceSymbol);

            return (
              <div
                key={coin.binanceSymbol}
                onClick={() => onSelectCoin(coin.binanceSymbol, coin.name, coin.priceUsd)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors text-xs font-mono gap-1.5 ${
                  isSelected
                    ? 'bg-blue-950/40 border-l-4 border-blue-500'
                    : hasAlert
                    ? 'bg-rose-950/15 hover:bg-[#161c28]'
                    : 'hover:bg-[#121722]'
                }`}
              >
                {/* Left: Rank & Symbol */}
                <div className="flex items-center gap-2 min-w-0 flex-shrink-0 w-[78px]">
                  <span className="text-[10px] text-slate-400 w-4 text-right flex-shrink-0">
                    {coin.rank}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-slate-100 truncate">{coin.symbol}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[55px]">
                      {coin.name}
                    </div>
                  </div>
                </div>

                {/* Center: 16 Mini Candle Color Bars */}
                <div className="flex flex-col items-center justify-center flex-shrink-0">
                  {history16 && history16.length > 0 ? (
                    <div>
                      <div className="flex items-end gap-[1.5px] p-1 bg-[#0b0e14] rounded border border-[#1c2438]">
                        {history16.map((candle, idx) => {
                          const isLatest = idx === history16.length - 1;
                          return (
                            <div
                              key={idx}
                              title={`${isLatest ? 'LATEST (Closed): ' : `Past candle #${16 - idx}: `}${candle.isGreen ? '+' : ''}${candle.changePercent}%`}
                              className={`w-[3px] rounded-[1px] transition-all ${
                                isLatest
                                  ? candle.isGreen
                                    ? 'h-[14px] bg-emerald-400 ring-1 ring-white/80 shadow-sm shadow-emerald-400/50'
                                    : 'h-[14px] bg-rose-500 ring-1 ring-white/80 shadow-sm shadow-rose-500/50'
                                  : candle.isGreen
                                  ? 'h-[10px] bg-emerald-500/80 hover:bg-emerald-400'
                                  : 'h-[10px] bg-rose-500/80 hover:bg-rose-400'
                              }`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between text-[7px] font-mono text-slate-400 px-0.5 mt-0.5">
                        <span className="text-slate-400">old</span>
                        <span className="text-slate-400">&rarr;</span>
                        <span className="text-cyan-400 font-bold">new</span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-[74px] h-[14px] bg-[#101522] rounded flex items-center justify-center text-[9px] text-slate-400 font-mono">
                      Loading...
                    </div>
                  )}
                </div>

                {/* Right: Price & 24h Change */}
                <div className="text-right flex-shrink-0 min-w-[65px]">
                  <div className="font-medium text-slate-200 text-[11px]">
                    {formatPriceDisplay(coin.priceUsd)}
                  </div>
                  <div
                    className={`flex items-center justify-end gap-0.5 text-[10px] font-semibold ${
                      coin.change24h >= 0 ? 'text-bullish' : 'text-bearish'
                    }`}
                  >
                    {coin.change24h >= 0 ? (
                      <TrendingUp className="w-2.5 h-2.5" />
                    ) : (
                      <TrendingDown className="w-2.5 h-2.5" />
                    )}
                    <span>{coin.change24h > 0 ? '+' : ''}{coin.change24h.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

