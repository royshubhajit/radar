import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { scannerEngine } from './services/scannerEngine';
import { binanceService } from './services/binanceService';
import { Header } from './components/Header';
import { CandlestickChart } from './components/CandlestickChart';
import { AlertFeed } from './components/AlertFeed';
import { WatchlistSidebar } from './components/WatchlistSidebar';
import { CryptoCalculator } from './components/CryptoCalculator';
import { PricePredictionCard } from './components/PricePredictionCard';
import { Target, Calculator, BarChart2, BellRing, ListFilter, LayoutGrid } from 'lucide-react';
import { AlertItem, AlertTimeframe, CoinInfo, KlineInterval, MiniCandle, ScannerConfig, ScannerStatus } from './types';
import { formatTabTitlePrice } from './utils/priceFormatter';

export const App: React.FC = () => {
  const [config, setConfig] = useState<ScannerConfig>(scannerEngine.getConfig());
  const [status, setStatus] = useState<ScannerStatus>(scannerEngine.getStatus());
  const [coins, setCoins] = useState<CoinInfo[]>(scannerEngine.getCoins());
  const [alerts, setAlerts] = useState<AlertItem[]>(scannerEngine.getAlerts());
  const [history16Map, setHistory16Map] = useState<Map<string, MiniCandle[]>>(scannerEngine.getHistory16Map());

  // Currently viewed symbol & interval on Candlestick chart
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedName, setSelectedName] = useState('Bitcoin');
  const [chartInterval, setChartInterval] = useState<KlineInterval>('15m');
  const [activeCoinPrice, setActiveCoinPrice] = useState<number>(0);
  const [bottomUtilityTab, setBottomUtilityTab] = useState<'prediction' | 'calculator'>('prediction');
  const [mobileTab, setMobileTab] = useState<'chart' | 'alerts' | 'watchlist' | 'utility' | 'all'>('chart');

  // Resolved active price fallback so price is never 0 even before websocket ticks
  const resolvedActivePrice = useMemo(() => {
    if (activeCoinPrice > 0) return activeCoinPrice;
    const match = coins.find((c) => c.binanceSymbol === selectedSymbol);
    return match && match.priceUsd > 0 ? match.priceUsd : 0;
  }, [activeCoinPrice, coins, selectedSymbol]);

  // Calculator target: captured ONLY ONCE on coin click
  const [calculatorTarget, setCalculatorTarget] = useState<{
    symbol: string;
    price: number;
    clickId: number;
  }>({
    symbol: 'BTCUSDT',
    price: 0,
    clickId: 1,
  });

  useEffect(() => {
    // Subscribe to scanner engine state updates
    const unsubscribe = scannerEngine.subscribe(() => {
      setConfig(scannerEngine.getConfig());
      setStatus(scannerEngine.getStatus());
      setCoins(scannerEngine.getCoins());
      setAlerts(scannerEngine.getAlerts());
      setHistory16Map(new Map(scannerEngine.getHistory16Map()));
    });

    // Start scanner engine
    scannerEngine.start();

    return () => {
      unsubscribe();
      scannerEngine.stop();
    };
  }, []);

  const handleSelectCoin = (
    symbol: string,
    name: string,
    timeframeOrPrice?: AlertTimeframe | number,
    maybePrice?: number
  ) => {
    setSelectedSymbol(symbol);
    setSelectedName(name);

    // On mobile screens, automatically show chart when selecting a coin
    if (typeof window !== 'undefined' && window.innerWidth < 1280 && mobileTab !== 'all') {
      setMobileTab('chart');
    }

    let tf: AlertTimeframe | undefined;
    let price: number | undefined;

    if (typeof timeframeOrPrice === 'number') {
      price = timeframeOrPrice;
    } else if (typeof timeframeOrPrice === 'string') {
      tf = timeframeOrPrice;
      price = maybePrice;
    }

    if (tf) {
      setChartInterval(tf as KlineInterval);
    }

    // Determine snapshot price at the exact moment of selection
    const fallbackCoin = coins.find((c) => c.binanceSymbol === symbol);
    const resolvedPrice =
      price && price > 0
        ? price
        : fallbackCoin && fallbackCoin.priceUsd > 0
        ? fallbackCoin.priceUsd
        : 0;

    if (resolvedPrice && resolvedPrice > 0) {
      setActiveCoinPrice(resolvedPrice);
    }

    // Snapshot is set ONLY ONCE upon coin click
    setCalculatorTarget((prev) => ({
      symbol,
      price: resolvedPrice,
      clickId: prev.clickId + 1,
    }));
  };

  // If price was 0 on click (e.g. unlisted token on first load), chart's first klines close populates it ONCE
  const handleInitialPriceLoaded = useCallback((symbol: string, price: number) => {
    if (symbol === selectedSymbol && price > 0) {
      setActiveCoinPrice(price);
    }
    setCalculatorTarget((prev) => {
      if (prev.symbol === symbol && (!prev.price || prev.price === 0)) {
        return { ...prev, price };
      }
      return prev;
    });
  }, [selectedSymbol]);

  // Manual re-sync trigger for the calculator snapshot
  const handleRefreshCalculatorPrice = useCallback(async () => {
    try {
      const recent = await binanceService.getKlines(selectedSymbol, '1m', 1);
      if (recent.length > 0) {
        const latestPrice = recent[recent.length - 1].close;
        setActiveCoinPrice(latestPrice);
        setCalculatorTarget((prev) => ({
          symbol: selectedSymbol,
          price: latestPrice,
          clickId: prev.clickId + 1,
        }));
      }
    } catch (_) {}
  }, [selectedSymbol]);

  // Keep active chart coin in sync with Top 100 list on 30s update and live WS ticks
  const handleLivePrice = useCallback((symbol: string, price: number) => {
    if (symbol === selectedSymbol && price > 0) {
      setActiveCoinPrice(price);
    }
    setCoins((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.binanceSymbol === symbol && Math.abs(c.priceUsd - price) > 0.00000001) {
          changed = true;
          return { ...c, priceUsd: price };
        }
        return c;
      });
      return changed ? next : prev;
    });
  }, [selectedSymbol]);

  // Sync activeCoinPrice immediately from Watchlist when available
  useEffect(() => {
    if (!activeCoinPrice || activeCoinPrice === 0) {
      const match = coins.find((c) => c.binanceSymbol === selectedSymbol);
      if (match && match.priceUsd > 0) {
        setActiveCoinPrice(match.priceUsd);
      }
    }
  }, [coins, selectedSymbol, activeCoinPrice]);

  // Dynamically update browser tab title (Binance style: e.g. "81,272.00 | BTC", "112.00 | SOL", "0.00001850 | PEPE")
  useEffect(() => {
    const cleanSym = selectedSymbol.replace('USDT', '');
    if (activeCoinPrice && activeCoinPrice > 0) {
      const formatted = formatTabTitlePrice(activeCoinPrice);
      document.title = `${formatted} | ${cleanSym}`;
    } else {
      document.title = `${cleanSym} | DropRadar`;
    }
  }, [activeCoinPrice, selectedSymbol]);

  const handleUpdateConfig = (newConfig: Partial<ScannerConfig>) => {
    scannerEngine.updateConfig(newConfig);
  };

  const handleTriggerScan = () => {
    scannerEngine.runScan();
  };

  const handleLowerThreshold = (newVal: number) => {
    scannerEngine.updateConfig({ thresholdPercent: newVal });
  };

  const handleTimeframeChange = (tf: AlertTimeframe) => {
    scannerEngine.updateConfig({ timeframe: tf });
  };

  // Set of alerted symbols for fast lookup in watchlist
  const alertedSymbols = useMemo(() => {
    return new Set(alerts.map((a) => a.symbol));
  }, [alerts]);

  return (
    <div className="flex flex-col min-h-screen xl:h-screen w-full bg-[#07090e] text-slate-100 overflow-x-hidden xl:overflow-hidden select-none">
      {/* Top Header */}
      <Header
        config={config}
        status={status}
        onUpdateConfig={handleUpdateConfig}
        onTriggerScan={handleTriggerScan}
        totalAlertsCount={alerts.length}
      />

      {/* Mobile & Tablet Navigation Tab Bar (Hidden on desktop/laptop xl+) */}
      <div className="xl:hidden flex items-center bg-[#10141d] border-b border-[#1e2638] px-2 py-1.5 gap-1 overflow-x-auto no-scrollbar shrink-0">
        <button
          onClick={() => setMobileTab('chart')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            mobileTab === 'chart'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c28]'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Chart</span>
        </button>

        <button
          onClick={() => setMobileTab('alerts')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            mobileTab === 'alerts'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c28]'
          }`}
        >
          <BellRing className="w-3.5 h-3.5" />
          <span>Alerts</span>
          {alerts.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                mobileTab === 'alerts' ? 'bg-black/40 text-rose-200' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {alerts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setMobileTab('watchlist')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            mobileTab === 'watchlist'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c28]'
          }`}
        >
          <ListFilter className="w-3.5 h-3.5" />
          <span>Watchlist</span>
        </button>

        <button
          onClick={() => setMobileTab('utility')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            mobileTab === 'utility'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c28]'
          }`}
        >
          <Target className="w-3.5 h-3.5 text-amber-300" />
          <span>Predict / Calc</span>
        </button>

        <button
          onClick={() => setMobileTab('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            mobileTab === 'all'
              ? 'bg-slate-700 text-white shadow-md font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c28]'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>All Views</span>
        </button>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-2 sm:gap-2.5 p-2 sm:p-2.5 min-h-0 xl:overflow-hidden overflow-y-auto">
        {/* Left / Center Area: Chart (Top) & Alert Feed (Bottom) */}
        <div
          className={`xl:col-span-8 2xl:col-span-9 flex flex-col gap-2 sm:gap-2.5 min-h-0 h-full ${
            mobileTab === 'chart' || mobileTab === 'alerts' || mobileTab === 'all'
              ? 'flex'
              : 'hidden xl:flex'
          }`}
        >
          {/* Top Half: Real-time Candlestick Chart */}
          <div
            className={`flex-[1.15] min-h-[300px] xl:min-h-0 ${
              mobileTab === 'chart'
                ? 'h-[calc(100vh-130px)] min-h-[440px]'
                : mobileTab === 'all'
                ? 'h-[48vh] min-h-[340px]'
                : 'hidden xl:flex xl:flex-col'
            }`}
          >
            <CandlestickChart
              symbol={selectedSymbol}
              coinName={selectedName}
              activeInterval={chartInterval}
              onIntervalChange={setChartInterval}
              onInitialPriceLoaded={handleInitialPriceLoaded}
              onLivePrice={handleLivePrice}
            />
          </div>

          {/* Bottom Half: Live Descending Drop Alert Feed */}
          <div
            className={`flex-1 min-h-[250px] xl:min-h-0 ${
              mobileTab === 'alerts'
                ? 'h-[calc(100vh-130px)] min-h-[440px]'
                : mobileTab === 'all'
                ? 'h-[46vh] min-h-[300px]'
                : 'hidden xl:flex xl:flex-col'
            }`}
          >
            <AlertFeed
              alerts={alerts}
              selectedSymbol={selectedSymbol}
              onSelectCoin={handleSelectCoin}
              thresholdPercent={config.thresholdPercent}
              timeframe={config.timeframe}
              isScanning={status.isScanning}
              onLowerThreshold={handleLowerThreshold}
              onTimeframeChange={handleTimeframeChange}
            />
          </div>
        </div>

        {/* Right Sidebar: Top 100 Watchlist & PnL Calculator / Target Prediction */}
        <div
          className={`xl:col-span-4 2xl:col-span-3 flex flex-col gap-2 sm:gap-2.5 min-h-0 h-full pr-0.5 xl:overflow-hidden ${
            mobileTab === 'watchlist' || mobileTab === 'utility' || mobileTab === 'all'
              ? 'flex'
              : 'hidden xl:flex'
          }`}
        >
          {/* Top: Watchlist */}
          <div
            className={`flex-1 min-h-[220px] xl:min-h-0 overflow-hidden flex flex-col ${
              mobileTab === 'watchlist'
                ? 'h-[calc(100vh-130px)] min-h-[440px]'
                : mobileTab === 'all'
                ? 'h-[42vh] min-h-[300px]'
                : 'hidden xl:flex'
            }`}
          >
            <WatchlistSidebar
              coins={coins}
              selectedSymbol={selectedSymbol}
              onSelectCoin={handleSelectCoin}
              alertedSymbols={alertedSymbols}
              history16Map={history16Map}
            />
          </div>

          {/* Bottom Right: Tabbed Utility Widget (Target Prediction & Futures Calculator) */}
          <div
            className={`shrink-0 flex flex-col gap-1.5 ${
              mobileTab === 'utility'
                ? 'min-h-[440px]'
                : mobileTab === 'all'
                ? ''
                : 'hidden xl:flex'
            }`}
          >
            {/* Tab Selector Buttons */}
            <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-1 gap-1 shadow-lg shrink-0">
              <button
                onClick={() => setBottomUtilityTab('prediction')}
                className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  bottomUtilityTab === 'prediction'
                    ? 'bg-gradient-to-r from-amber-600 to-emerald-600 text-white shadow-md shadow-amber-900/30 ring-1 ring-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Target className="w-3.5 h-3.5 text-amber-300" />
                <span>Target Prediction</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                  Sheet
                </span>
              </button>

              <button
                onClick={() => setBottomUtilityTab('calculator')}
                className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  bottomUtilityTab === 'calculator'
                    ? 'bg-slate-700 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Calculator className="w-3.5 h-3.5 text-slate-300" />
                <span>Futures Calculator</span>
              </button>
            </div>

            {/* Active Tab View */}
            {bottomUtilityTab === 'prediction' ? (
              <PricePredictionCard
                selectedSymbol={selectedSymbol}
                currentPrice={resolvedActivePrice}
              />
            ) : (
              <CryptoCalculator
                selectedSymbol={calculatorTarget.symbol}
                initialPrice={calculatorTarget.price}
                clickId={calculatorTarget.clickId}
                onRefreshPrice={handleRefreshCalculatorPrice}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
