import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import { Candle, KlineInterval } from '../types';
import { binanceService } from '../services/binanceService';
import { useBinanceWebSocket } from '../hooks/useBinanceWebSocket';
import { Activity, Clock, AlertCircle } from 'lucide-react';
import { formatPriceDisplay } from '../utils/priceFormatter';

interface CandlestickChartProps {
  symbol: string;
  coinName: string;
  defaultInterval?: KlineInterval;
  activeInterval?: KlineInterval;
  onIntervalChange?: (interval: KlineInterval) => void;
  onInitialPriceLoaded?: (symbol: string, price: number) => void;
  onLivePrice?: (symbol: string, price: number) => void;
}

const INTERVALS: { label: string; value: KlineInterval }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1D', value: '1d' },
];

function getPriceFormatOptions(samplePrice: number) {
  if (samplePrice <= 0.0001) {
    return { type: 'price' as const, precision: 8, minMove: 0.00000001 };
  } else if (samplePrice <= 0.01) {
    return { type: 'price' as const, precision: 6, minMove: 0.000001 };
  } else if (samplePrice <= 1) {
    return { type: 'price' as const, precision: 4, minMove: 0.0001 };
  } else if (samplePrice <= 10) {
    return { type: 'price' as const, precision: 4, minMove: 0.0001 };
  } else if (samplePrice <= 100) {
    return { type: 'price' as const, precision: 3, minMove: 0.001 };
  } else {
    return { type: 'price' as const, precision: 2, minMove: 0.01 };
  }
}

function formatPrice(val: number | undefined | null): string {
  const s = formatPriceDisplay(val);
  return s.startsWith('$') ? s.substring(1) : s;
}

function formatVolume(val: number | undefined | null): string {
  if (!val) return '0';
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(2);
}

function formatDateTime(timeSeconds: number, int: KlineInterval): string {
  const d = new Date(timeSeconds * 1000);
  const Y = d.getFullYear();
  const M = (d.getMonth() + 1).toString().padStart(2, '0');
  const D = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  if (int === '1d') {
    return `${Y}-${M}-${D}`;
  } else if (int === '1m') {
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
  } else {
    return `${Y}-${M}-${D} ${h}:${m}`;
  }
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  coinName,
  defaultInterval = '1m',
  activeInterval,
  onIntervalChange,
  onInitialPriceLoaded,
  onLivePrice,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ohlcBarRef = useRef<HTMLDivElement>(null);
  const floatingTooltipRef = useRef<HTMLDivElement>(null);

  const [interval, setInterval] = useState<KlineInterval>(activeInterval || defaultInterval);

  useEffect(() => {
    if (activeInterval) {
      setInterval(activeInterval);
    }
  }, [activeInterval]);

  const handleIntervalSelect = (newInt: KlineInterval) => {
    setInterval(newInt);
    onIntervalChange?.(newInt);
  };

  const [isLoading, setIsLoading] = useState(true);
  const [hasNoData, setHasNoData] = useState(false);
  const [lastClosePrice, setLastClosePrice] = useState<number | null>(null);
  const [istTime, setIstTime] = useState<string>('');
  const [candleCountdown, setCandleCountdown] = useState<string>('');
  const [visibleCandlesCount, setVisibleCandlesCount] = useState<number>(96);
  const [customCandleCount, setCustomCandleCount] = useState<string>('96');
  const totalBarsRef = useRef<number>(0);
  const visibleCandlesCountRef = useRef<number>(96);
  visibleCandlesCountRef.current = visibleCandlesCount;

  const handleCandleCountChange = (count: number) => {
    setVisibleCandlesCount(count);
    visibleCandlesCountRef.current = count;
    setCustomCandleCount(count.toString());
    if (chartRef.current && totalBarsRef.current > 0) {
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBarsRef.current - count,
        to: totalBarsRef.current + 2,
      });
    }
  };

  const handleCustomCandleCountBlur = () => {
    const parsed = parseInt(customCandleCount, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 500) {
      handleCandleCountChange(parsed);
    } else {
      setCustomCandleCount(visibleCandlesCount.toString());
    }
  };

  // IST Clock and Next Candle Countdown
  useEffect(() => {
    const updateTimes = () => {
      const now = new Date();
      const istStr = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setIstTime(istStr);

      let intervalMs = 60 * 1000;
      if (interval === '1m') intervalMs = 60 * 1000;
      else if (interval === '5m') intervalMs = 5 * 60 * 1000;
      else if (interval === '15m') intervalMs = 15 * 60 * 1000;
      else if (interval === '1h') intervalMs = 60 * 60 * 1000;
      else if (interval === '4h') intervalMs = 4 * 60 * 60 * 1000;
      else if (interval === '1d') intervalMs = 24 * 60 * 60 * 1000;

      const currentMs = now.getTime();
      const nextBoundary = Math.ceil(currentMs / intervalMs) * intervalMs;
      const diffSec = Math.max(0, Math.floor((nextBoundary - currentMs) / 1000));

      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;

      if (hours > 0) {
        setCandleCountdown(`${hours}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`);
      } else {
        setCandleCountdown(`${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`);
      }
    };

    updateTimes();
    const timer = window.setInterval(updateTimes, 1000);
    return () => window.clearInterval(timer);
  }, [interval]);

  // Live WebSocket update callback
  const handleCandleUpdate = useCallback((candle: Candle) => {
    if (candleSeriesRef.current && volumeSeriesRef.current) {
      candleSeriesRef.current.update({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });

      const isBullish = candle.close >= candle.open;
      volumeSeriesRef.current.update({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: isBullish ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
      });

      if (candle.close > 0) {
        onLivePrice?.(symbol, candle.close);
      }
    }
  }, [symbol, onLivePrice]);

  const { isConnected, currentPrice, priceDirection } = useBinanceWebSocket({
    symbol,
    interval,
    onCandleUpdate: handleCandleUpdate,
  });

  // Keep live candle building continuously as fresh data arrives every 30 seconds
  useEffect(() => {
    const pollInterval = window.setInterval(() => {
      binanceService.getKlines(symbol, interval, 5).then((recentCandles) => {
        if (recentCandles.length > 0 && candleSeriesRef.current && volumeSeriesRef.current) {
          for (const c of recentCandles) {
            candleSeriesRef.current.update({
              time: c.time as UTCTimestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            });
            volumeSeriesRef.current.update({
              time: c.time as UTCTimestamp,
              value: c.volume,
              color: c.close >= c.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
            });
          }
          const latest = recentCandles[recentCandles.length - 1];
          if (latest && latest.close > 0) {
            setLastClosePrice(latest.close);
            onLivePrice?.(symbol, latest.close);
          }
        }
      });
    }, 30000);

    return () => window.clearInterval(pollInterval);
  }, [symbol, interval, onLivePrice]);

  // Reset top bar to idle default
  const resetOhlcBar = useCallback(() => {
    if (ohlcBarRef.current) {
      ohlcBarRef.current.innerHTML = `<span class="text-slate-400 italic">Hover anywhere on graph for exact Price, Date/Time, OHLC &amp; Volume &bull; ${visibleCandlesCount} candles in view</span>`;
    }
    if (floatingTooltipRef.current) {
      floatingTooltipRef.current.style.opacity = '0';
    }
  }, [visibleCandlesCount]);

  // Initialize and rebuild chart when interval or symbol changes
  useEffect(() => {
    if (!chartContainerRef.current) return;

    setIsLoading(true);
    setHasNoData(false);
    setLastClosePrice(null);

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#94a3b8',
        fontSize: 12,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(42, 50, 69, 0.35)' },
        horzLines: { color: 'rgba(42, 50, 69, 0.35)' },
      },
      // Ultra-smooth continuous crosshair (CoinGecko / TradingView Normal mode)
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(148, 163, 184, 0.6)',
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: 'rgba(148, 163, 184, 0.6)',
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: '#1e293b',
        },
      },
      timeScale: {
        borderColor: '#2a3245',
        timeVisible: true,
        secondsVisible: interval === '1m',
        rightOffset: 3,
        barSpacing: 12,
        minBarSpacing: 3,
      },
      rightPriceScale: {
        autoScale: true,
        borderColor: '#2a3245',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: false,
        },
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    candleSeriesRef.current = candleSeries;

    // Volume histogram series
    const volumeSeries = chart.addHistogramSeries({
      color: '#3b82f6',
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // Continuously auto-scale y-axis to visible viewport candles as canvas is moved left/right
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      chart.priceScale('right').applyOptions({
        autoScale: true,
      });

      const count = Math.round(range.to - range.from + 1);
      if (count > 0 && ohlcBarRef.current && ohlcBarRef.current.innerHTML.includes('candles in view')) {
        ohlcBarRef.current.innerHTML = `<span class="text-slate-400 italic">Hover anywhere on graph for exact Price, Date/Time, OHLC &amp; Volume &bull; ${count} candles in view</span>`;
      }
    });

    // Ultra-smooth zero-lag crosshair move tracking (Direct DOM manipulation at 60fps/120fps)
    chart.subscribeCrosshairMove((param) => {
      const container = chartContainerRef.current;
      const tooltip = floatingTooltipRef.current;
      const bar = ohlcBarRef.current;
      if (!container) return;

      if (
        !param ||
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        if (tooltip) tooltip.style.opacity = '0';
        if (bar) {
          bar.innerHTML = `<span class="text-slate-400 italic">Hover anywhere on graph for exact Price, Date/Time, OHLC &amp; Volume &bull; ${visibleCandlesCount} candles in view</span>`;
        }
        return;
      }

      const candle = param.seriesData.get(candleSeries) as any;
      const vol = param.seriesData.get(volumeSeries) as any;
      const cursorYPrice = candleSeries.coordinateToPrice(param.point.y);

      if (candle) {
        const isBull = candle.close >= candle.open;
        const chgVal = ((candle.close - candle.open) / (candle.open || 1)) * 100;
        const chgSign = chgVal >= 0 ? '+' : '';
        const chgColor = isBull ? 'text-emerald-400' : 'text-rose-400';
        const dateStr = formatDateTime(Number(param.time), interval);
        const volumeVal = vol?.value ?? candle.volume ?? 0;
        const midPrice = (candle.open + candle.close) / 2;

        // 1. Instant top bar update (zero React lag)
        if (bar) {
          bar.innerHTML = `
            <span class="text-slate-400">TF: <strong class="text-blue-400 font-bold">${interval}</strong></span>
            ${cursorYPrice !== null && !isNaN(cursorYPrice) ? `<span class="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 font-bold">Cursor: $${formatPrice(cursorYPrice)}</span>` : ''}
            <span class="text-slate-300">Time: <strong class="text-amber-400 font-medium">${dateStr}</strong></span>
            <span>Mid: <strong class="text-white font-bold">$${formatPrice(midPrice)}</strong></span>
            <span>O: <strong class="text-slate-200">$${formatPrice(candle.open)}</strong></span>
            <span>H: <strong class="text-emerald-400">$${formatPrice(candle.high)}</strong></span>
            <span>L: <strong class="text-rose-400">$${formatPrice(candle.low)}</strong></span>
            <span>C: <strong class="${chgColor}">$${formatPrice(candle.close)}</strong></span>
            <span>Chg: <strong class="${chgColor}">${chgSign}${chgVal.toFixed(2)}%</strong></span>
            <span>Vol: <strong class="text-slate-200">${formatVolume(volumeVal)}</strong></span>
          `;
        }

        // 2. CoinGecko-style floating tooltip (glides with cursor)
        if (tooltip) {
          const tooltipW = 215;
          const tooltipH = 140;
          const cW = container.clientWidth;
          const cH = container.clientHeight;

          let left = param.point.x + 18;
          if (left + tooltipW > cW - 65) {
            left = param.point.x - tooltipW - 18;
          }
          if (left < 10) left = 10;

          let top = param.point.y - 50;
          if (top < 10) top = 10;
          if (top + tooltipH > cH - 30) {
            top = cH - tooltipH - 30;
          }

          tooltip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
          tooltip.style.opacity = '1';
          tooltip.innerHTML = `
            <div class="flex items-center justify-between text-[11px] font-mono mb-1">
              <span class="text-amber-400 font-medium">${dateStr}</span>
              <span class="px-1.5 py-0.2 rounded bg-[#1b2333] text-[10px] text-slate-400">${interval}</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 mb-2 pb-1.5 border-b border-[#222d42]">
              <div class="flex items-baseline gap-1.5">
                <span class="text-[10px] uppercase font-mono text-slate-400 font-semibold">Mid:</span>
                <span class="text-lg font-bold font-mono text-white tracking-tight">$${formatPrice(midPrice)}</span>
              </div>
              <span class="text-xs font-mono font-bold ${chgColor}">${chgSign}${chgVal.toFixed(2)}%</span>
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] font-mono text-slate-400">
              <div class="flex justify-between"><span>Open:</span> <span class="text-slate-200 font-medium">$${formatPrice(candle.open)}</span></div>
              <div class="flex justify-between"><span>High:</span> <span class="text-emerald-400 font-medium">$${formatPrice(candle.high)}</span></div>
              <div class="flex justify-between"><span>Low:</span> <span class="text-rose-400 font-medium">$${formatPrice(candle.low)}</span></div>
              <div class="flex justify-between"><span>Close:</span> <span class="text-slate-200 font-medium">$${formatPrice(candle.close)}</span></div>
            </div>
            <div class="flex justify-between pt-1 mt-1 border-t border-white/5 text-[9.5px] text-slate-400 font-mono">
              <span>Vol:</span> <span class="text-slate-300 font-medium">${formatVolume(volumeVal)}</span>
            </div>
          `;
        }
      } else {
        if (tooltip) tooltip.style.opacity = '0';
      }
    });

    // Resize observer
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    // Fetch initial historical candles (500 bars so user can scroll left/right)
    let isMounted = true;
    binanceService.getKlines(symbol, interval, 500).then((candles) => {
      if (!isMounted || !candleSeriesRef.current || !volumeSeriesRef.current) return;

      if (candles.length === 0) {
        setHasNoData(true);
        setIsLoading(false);
        return;
      }

      setHasNoData(false);
      const lastPrice = candles[candles.length - 1].close;
      setLastClosePrice(lastPrice);
      onInitialPriceLoaded?.(symbol, lastPrice);
      onLivePrice?.(symbol, lastPrice);
      candleSeries.applyOptions({
        priceFormat: getPriceFormatOptions(lastPrice),
      });

      const candleData = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
      }));

      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);

      totalBarsRef.current = candleData.length;
      const totalBars = candleData.length;
      const count = visibleCandlesCountRef.current || 96;
      if (totalBars > count) {
        chart.timeScale().setVisibleLogicalRange({
          from: totalBars - count,
          to: totalBars + 2,
        });
      } else {
        chart.timeScale().fitContent();
      }

      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [symbol, interval]);

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] border border-[#1e2638] rounded-xl overflow-hidden shadow-2xl">
      {/* Chart Top Header & Controls */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#121722] border-b border-[#1e2638] gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight text-white">{symbol.replace('USDT', '')}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#1c2333] text-slate-400 font-medium">USDT</span>
            {binanceService.getSymbolSource(symbol) === 'binance_futures' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-500/40 text-purple-300 font-mono font-semibold">
                Binance Futures
              </span>
            )}
            {binanceService.getSymbolSource(symbol) === 'mexc' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono font-semibold">
                MEXC
              </span>
            )}
            {binanceService.getSymbolSource(symbol) === 'bitfinex' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-950/80 border border-teal-500/40 text-teal-300 font-mono font-semibold">
                Bitfinex
              </span>
            )}
            {binanceService.getSymbolSource(symbol) === 'binance_spot' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2333] border border-[#2b374e] text-slate-400 font-mono">
                Spot
              </span>
            )}
            <span className="text-xs text-slate-400 truncate max-w-[120px]">{coinName}</span>
          </div>

          {/* Current Live Price */}
          <div className="flex items-center gap-2 pl-3 border-l border-[#242e42]">
            <span
              className={`font-mono text-base font-bold transition-colors duration-300 ${
                priceDirection === 'up'
                  ? 'text-bullish'
                  : priceDirection === 'down'
                  ? 'text-bearish'
                  : 'text-slate-100'
              }`}
            >
              ${formatPrice(currentPrice ?? lastClosePrice)}
            </span>
          </div>

          {/* Live Status + IST Time + Next Candle Countdown */}
          <div className="flex items-center gap-2 pl-3 border-l border-[#242e42] flex-wrap">
            {/* Live Indicator */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#161f30] border border-[#23314d]" title={isConnected ? "WebSocket Stream Connected" : "Connecting..."}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-bullish animate-pulse' : 'bg-amber-400'}`}></span>
              <span className={`text-[11px] font-mono font-bold ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                LIVE
              </span>
            </div>

            {/* Current IST Time */}
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#0e1420] border border-[#20293d] text-[11px] font-mono" title="Current time in Indian Standard Time (IST, UTC+5:30)">
              <span className="text-slate-500 font-semibold">IST:</span>
              <span className="text-blue-400 font-bold tracking-wider">{istTime}</span>
            </div>

            {/* Next Candle Countdown */}
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#141b29] border border-[#24324c] text-[11px] font-mono" title={`Time remaining until current ${interval} candle closes and next candle appears`}>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400 hidden sm:inline">Next {interval} in:</span>
              <span className="text-amber-400 font-bold">{candleCountdown}</span>
            </div>
          </div>
        </div>

        {/* Right side controls: Viewport Bars & Timeframe */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Viewport Bars (16, 24, 48, 72, 96, Custom) */}
          <div className="flex items-center gap-1 bg-[#0b0e14] p-1 rounded-lg border border-[#1e2638]">
            <span className="text-[10px] font-mono text-slate-400 px-1.5 hidden md:inline">View:</span>
            {[16, 24, 48, 72, 96].map((count) => (
              <button
                key={count}
                onClick={() => handleCandleCountChange(count)}
                className={`px-2 py-0.5 text-xs font-mono font-medium rounded transition-colors ${
                  visibleCandlesCount === count
                    ? 'bg-purple-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#192233]'
                }`}
                title={`Display ${count} candles in view`}
              >
                {count}
              </button>
            ))}
            <div className="flex items-center pl-1 pr-1 border-l border-[#242e42] ml-0.5">
              <input
                type="number"
                min="10"
                max="500"
                value={customCandleCount}
                onChange={(e) => setCustomCandleCount(e.target.value)}
                onBlur={handleCustomCandleCountBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleCustomCandleCountBlur()}
                title="Custom candles in viewport (10 - 500)"
                placeholder="Bars"
                className="w-12 bg-[#161c29] border border-[#2b374e] rounded px-1 py-0.5 text-xs font-mono text-purple-300 text-center focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Timeframe Switcher */}
          <div className="flex items-center gap-1 bg-[#0b0e14] p-1 rounded-lg border border-[#1e2638]">
            {INTERVALS.map((int) => (
              <button
                key={int.value}
                onClick={() => handleIntervalSelect(int.value)}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors ${
                  interval === int.value
                    ? 'bg-blue-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#192233]'
                }`}
              >
                {int.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* OHLC Bar with Cursor Exact Price, Date/Time and Volume (Direct DOM ref for 0ms lag) */}
      <div
        ref={ohlcBarRef}
        className="flex items-center gap-3 px-4 py-1.5 bg-[#0e131d] border-b border-[#1a2130] text-[11px] font-mono text-slate-400 overflow-x-auto whitespace-nowrap min-h-[33px]"
      >
        <span className="text-slate-400 italic">
          Hover anywhere on graph for exact Price, Date/Time, OHLC &amp; Volume &bull; {visibleCandlesCount} candles in view
        </span>
      </div>

      {/* Chart Canvas & CoinGecko Floating Tooltip */}
      <div className="relative flex-1 w-full min-h-[360px]">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0b0e14]/80 backdrop-blur-sm">
            <Activity className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <span className="text-xs font-mono text-slate-400">Loading {symbol} Candlesticks...</span>
          </div>
        )}
        {hasNoData && !isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0b0e14]/90 p-6 text-center">
            <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
            <span className="text-sm font-semibold text-slate-200">No candle data available for {symbol}</span>
            <span className="text-xs text-slate-400 mt-1 max-w-sm">
              This token has no recorded candle history on supported exchanges for the {interval} interval.
            </span>
          </div>
        )}

        {/* CoinGecko Ultra-Smooth Floating Tooltip (glides with mouse at 60fps/120fps via transform) */}
        <div
          ref={floatingTooltipRef}
          className="absolute top-0 left-0 z-30 pointer-events-none opacity-0 transition-opacity duration-150 p-2.5 rounded-xl bg-[#0b0f19]/95 backdrop-blur-md border border-[#222f46] shadow-2xl shadow-black text-slate-100 will-change-transform select-none"
          style={{ width: 205 }}
        />

        <div
          ref={chartContainerRef}
          onMouseLeave={resetOhlcBar}
          className="w-full h-full"
        />
      </div>
    </div>
  );
};
