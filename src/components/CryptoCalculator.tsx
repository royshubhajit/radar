import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calculator, ArrowUpRight, ArrowDownRight, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { formatPriceInput, formatPriceDisplay } from '../utils/priceFormatter';

interface CryptoCalculatorProps {
  selectedSymbol: string;
  initialPrice?: number;
  clickId?: number;
  onRefreshPrice?: () => void;
}

const LEVERAGE_PRESETS = [1, 2, 5, 10, 20, 50];

export const CryptoCalculator: React.FC<CryptoCalculatorProps> = ({
  selectedSymbol,
  initialPrice,
  clickId,
  onRefreshPrice,
}) => {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [entryPrice, setEntryPrice] = useState<string>(() =>
    initialPrice && initialPrice > 0 ? formatPriceInput(initialPrice) : ''
  );
  const [exitPrice, setExitPrice] = useState<string>('');
  const [margin, setMargin] = useState<string>('100');
  const [leverage, setLeverage] = useState<string>('5');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isEdited, setIsEdited] = useState<boolean>(false);

  // Track previous symbol & clickId to update entry price ONLY ONCE per coin click
  const lastProcessedRef = useRef<{ symbol: string; clickId?: number }>({
    symbol: selectedSymbol,
    clickId,
  });

  // When a coin is clicked from anywhere, update entry price ONCE and clear exit target
  useEffect(() => {
    const isNewSelection =
      selectedSymbol !== lastProcessedRef.current.symbol ||
      (clickId !== undefined && clickId !== lastProcessedRef.current.clickId);

    if (isNewSelection) {
      lastProcessedRef.current = { symbol: selectedSymbol, clickId };
      setIsEdited(false);
      setExitPrice(''); // clear exit price for newly selected coin

      if (initialPrice && initialPrice > 0) {
        setEntryPrice(formatPriceInput(initialPrice));
      } else {
        setEntryPrice('');
      }
    } else if (!entryPrice && initialPrice && initialPrice > 0 && !isEdited) {
      // First load: snapshot arrives
      setEntryPrice(formatPriceInput(initialPrice));
    }
  }, [selectedSymbol, initialPrice, clickId, entryPrice, isEdited]);

  const handleEntryPriceChange = (val: string) => {
    setIsEdited(true);
    setEntryPrice(val);
  };

  const handleSnapPrice = () => {
    setIsEdited(false);
    if (onRefreshPrice) {
      onRefreshPrice();
    } else if (initialPrice && initialPrice > 0) {
      setEntryPrice(formatPriceInput(initialPrice));
    }
  };

  const handleApplyTarget = (percent: number) => {
    const entry = parseFloat(entryPrice);
    if (!entry || isNaN(entry)) return;
    const factor = direction === 'buy' ? 1 + percent / 100 : 1 - percent / 100;
    const target = entry * factor;
    setExitPrice(formatPriceInput(target));
  };

  const handleReset = () => {
    setIsEdited(false);
    setExitPrice('');
    setMargin('100');
    setLeverage('5');
    setDirection('buy');
    if (initialPrice && initialPrice > 0) {
      setEntryPrice(formatPriceInput(initialPrice));
    } else {
      setEntryPrice('');
    }
  };

  // Calculations
  const result = useMemo(() => {
    const entry = parseFloat(entryPrice);
    const exit = parseFloat(exitPrice);
    const m = parseFloat(margin);
    const lev = parseFloat(leverage);

    if (isNaN(entry) || isNaN(exit) || isNaN(m) || isNaN(lev) || entry <= 0 || m <= 0 || lev <= 0) {
      return null;
    }

    const positionSize = m * lev;
    let priceDiffPercent = 0;
    let pnl = 0;

    if (direction === 'buy') {
      // Long / Buy: Profit when Exit > Entry
      priceDiffPercent = ((exit - entry) / entry) * 100;
      pnl = positionSize * ((exit - entry) / entry);
    } else {
      // Short / Sell: Profit when Entry > Exit
      priceDiffPercent = ((entry - exit) / entry) * 100;
      pnl = positionSize * ((entry - exit) / entry);
    }

    const roi = (pnl / m) * 100;

    return {
      positionSize,
      pnl,
      roi,
      priceDiffPercent,
      isProfit: pnl > 0,
      isLoss: pnl < 0,
    };
  }, [entryPrice, exitPrice, margin, leverage, direction]);

  const formatUsd = (val: number) => {
    if (Math.abs(val) < 0.01 && val !== 0) {
      return val > 0 ? `+$${val.toFixed(4)}` : `-$${Math.abs(val).toFixed(4)}`;
    }
    const prefix = val > 0 ? '+$' : val < 0 ? '-$' : '$';
    return `${prefix}${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="bg-[#0b0e14] border border-[#1e2638] rounded-xl overflow-hidden shadow-2xl transition-all">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#121722] border-b border-[#1e2638]">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-600/20 text-blue-400">
            <Calculator className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase">
            Futures Calculator
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-500/40 text-blue-300 font-mono font-bold">
            {selectedSymbol.replace('USDT', '')}
          </span>
          {entryPrice && (
            <span className="text-[10px] font-mono text-slate-400" title="Captured entry price">
              {formatPriceDisplay(entryPrice)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {onRefreshPrice && (
            <button
              onClick={handleSnapPrice}
              className="p-1 text-slate-400 hover:text-blue-300 rounded hover:bg-[#1b2333] transition-colors"
              title="Re-sync entry price to latest market price"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="text-[10px] font-mono text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-[#1b2333] transition-colors"
            title="Reset Calculator"
          >
            Reset
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-[#1b2333] transition-colors"
            title={isCollapsed ? 'Expand Calculator' : 'Collapse Calculator'}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Body */}
      {!isCollapsed && (
        <div className="p-3 flex flex-col gap-2.5">
          {/* Order Type: Buy / Long vs Sell / Short */}
          <div className="grid grid-cols-2 gap-1.5 bg-[#0e131d] p-1 rounded-lg border border-[#1c2436]">
            <button
              onClick={() => setDirection('buy')}
              className={`flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-mono font-bold transition-all ${
                direction === 'buy'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-700/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#151c2a]'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>BUY / LONG</span>
            </button>
            <button
              onClick={() => setDirection('sell')}
              className={`flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-mono font-bold transition-all ${
                direction === 'sell'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-700/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#151c2a]'
              }`}
            >
              <ArrowDownRight className="w-3.5 h-3.5" />
              <span>SELL / SHORT</span>
            </button>
          </div>

          {/* Row: Entry Price & Exit Price */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold">Entry Price</label>
                {isEdited ? (
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300" title="Custom user-edited entry price">
                    Custom
                  </span>
                ) : entryPrice ? (
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-blue-950/60 border border-blue-500/40 text-blue-300" title="Live synced price">
                    Sync
                  </span>
                ) : null}
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">$</span>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={entryPrice}
                  onChange={(e) => handleEntryPriceChange(e.target.value)}
                  className="w-full bg-[#121824] border border-[#232f46] rounded-lg pl-6 pr-2 py-1.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold">Exit Price</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleApplyTarget(2)}
                    className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#161f2e] text-slate-400 hover:text-emerald-400 hover:bg-[#1e2a3f] transition-colors"
                    title={direction === 'buy' ? 'Target +2% profit' : 'Target +2% profit (drop 2%)'}
                  >
                    +2%
                  </button>
                  <button
                    onClick={() => handleApplyTarget(5)}
                    className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#161f2e] text-slate-400 hover:text-emerald-400 hover:bg-[#1e2a3f] transition-colors"
                    title={direction === 'buy' ? 'Target +5% profit' : 'Target +5% profit (drop 5%)'}
                  >
                    +5%
                  </button>
                  <button
                    onClick={() => handleApplyTarget(10)}
                    className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#161f2e] text-slate-400 hover:text-emerald-400 hover:bg-[#1e2a3f] transition-colors"
                    title={direction === 'buy' ? 'Target +10% profit' : 'Target +10% profit (drop 10%)'}
                  >
                    +10%
                  </button>
                </div>
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">$</span>
                <input
                  type="number"
                  step="any"
                  placeholder="Exit target"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  className="w-full bg-[#121824] border border-[#232f46] rounded-lg pl-6 pr-2 py-1.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Row: Margin & Leverage */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
                Margin (USD)
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">$</span>
                <input
                  type="number"
                  step="any"
                  min="1"
                  placeholder="100"
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                  className="w-full bg-[#121824] border border-[#232f46] rounded-lg pl-6 pr-2 py-1.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold">Leverage</label>
                <span className="text-[10px] font-mono text-amber-400 font-bold">{leverage}x</span>
              </div>
              <div className="flex items-center gap-1">
                {LEVERAGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setLeverage(preset.toString())}
                    className={`flex-1 py-1 text-[9.5px] font-mono font-bold rounded transition-colors ${
                      leverage === preset.toString()
                        ? 'bg-amber-500 text-black shadow-sm'
                        : 'bg-[#121824] border border-[#232f46] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {preset}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Position Info Pill */}
          <div className="flex items-center justify-between px-2.5 py-1 rounded-md bg-[#0e1420] border border-[#1e293d] text-[10px] font-mono text-slate-400">
            <span>Position Size:</span>
            <span className="text-slate-200 font-bold">
              ${((parseFloat(margin) || 0) * (parseFloat(leverage) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </span>
          </div>

          {/* Calculated Output Box: PnL & ROI */}
          {result ? (
            <div
              className={`p-2.5 rounded-xl border transition-all ${
                result.isProfit
                  ? 'bg-emerald-950/40 border-emerald-500/50 shadow-lg shadow-emerald-950/30'
                  : result.isLoss
                  ? 'bg-rose-950/40 border-rose-500/50 shadow-lg shadow-rose-950/30'
                  : 'bg-[#121824] border-[#243048]'
              }`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Estimated PnL</span>
                  <span
                    className={`text-lg font-bold font-mono tracking-tight ${
                      result.isProfit
                        ? 'text-emerald-400'
                        : result.isLoss
                        ? 'text-rose-400'
                        : 'text-slate-200'
                    }`}
                  >
                    {formatUsd(result.pnl)}
                  </span>
                </div>

                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">ROI %</span>
                  <span
                    className={`text-lg font-bold font-mono tracking-tight ${
                      result.isProfit
                        ? 'text-emerald-400'
                        : result.isLoss
                        ? 'text-rose-400'
                        : 'text-slate-200'
                    }`}
                  >
                    {result.roi >= 0 ? '+' : ''}{result.roi.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[9.5px] font-mono text-slate-400">
                <span>Price Delta: {result.priceDiffPercent >= 0 ? '+' : ''}{result.priceDiffPercent.toFixed(2)}%</span>
                <span>ROI on ${margin} Margin @ {leverage}x</span>
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl border border-dashed border-[#243048] bg-[#0c1018] text-center">
              <span className="text-[10px] font-mono text-slate-400">
                {entryPrice
                  ? `Entry: $${entryPrice} \u2022 Enter target exit price to calculate PnL & ROI`
                  : 'Select coin or enter Entry and Exit prices'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
