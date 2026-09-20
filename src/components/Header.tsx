import React, { useState } from 'react';
import { ScannerConfig, ScannerStatus } from '../types';
import { soundService } from '../services/soundService';
import {
  Flame,
  Volume2,
  VolumeX,
  RefreshCw,
  Clock,
  Sliders,
  BellRing
} from 'lucide-react';

interface HeaderProps {
  config: ScannerConfig;
  status: ScannerStatus;
  onUpdateConfig: (newConfig: Partial<ScannerConfig>) => void;
  onTriggerScan: () => void;
  totalAlertsCount: number;
}

const PRESET_THRESHOLDS = [0.4, 0.8, 1.0, 1.2];

export const Header: React.FC<HeaderProps> = ({
  config,
  status,
  onUpdateConfig,
  onTriggerScan,
  totalAlertsCount,
}) => {
  const [customThreshold, setCustomThreshold] = useState<string>(config.thresholdPercent.toString());

  const handleThresholdSelect = (val: number) => {
    setCustomThreshold(val.toString());
    onUpdateConfig({ thresholdPercent: val });
  };

  const handleCustomThresholdBlur = () => {
    const parsed = parseFloat(customThreshold);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 90) {
      onUpdateConfig({ thresholdPercent: parsed });
    } else {
      setCustomThreshold(config.thresholdPercent.toString());
    }
  };

  const toggleSound = () => {
    const nextVal = !config.isSoundEnabled;
    onUpdateConfig({ isSoundEnabled: nextVal });
    if (nextVal) {
      soundService.playDropAlert(config.soundVolume);
    }
  };

  const formatCountdown = (secs: number) => {
    if (secs <= 0) return 'Scanning...';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    if (m > 0) {
      return `${m}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${s}s`;
  };

  return (
    <header className="bg-[#10141d] border-b border-[#1e2638] px-3 sm:px-4 py-2 sm:py-2.5 select-none shrink-0">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-2.5 lg:gap-4">
        {/* Brand & Stats */}
        <div className="flex items-center justify-between w-full lg:w-auto gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-rose-500/20 to-red-600/30 border border-rose-500/40 flex items-center justify-center shadow-lg shadow-rose-950/40 shrink-0">
              <Flame className="w-5 h-5 text-rose-500 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-white font-mono">
                  DROP<span className="text-rose-500">RADAR</span>
                </h1>
                <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 font-mono font-semibold">
                  TOP 100
                </span>
              </div>
              <p className="hidden sm:block text-[10px] sm:text-[11px] text-slate-400">
                Live 1m Candlestick &amp; Closed Candle Red Drop Scanner
              </p>
            </div>
          </div>

          {/* Active Alert Count Badge (Mobile only) */}
          <div className="flex lg:hidden items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-lg">
            <BellRing className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-xs font-mono font-bold text-rose-400">{totalAlertsCount} Hits</span>
          </div>
        </div>

        {/* Configuration Controls Bar */}
        <div className="flex flex-wrap items-center justify-center lg:justify-end gap-1.5 sm:gap-2.5 w-full lg:w-auto">
          {/* Active Screener Timeframe Indicator */}
          <div className="flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl bg-[#0b0e14] border border-[#242e42] text-[10px] sm:text-[11px] font-mono" title="Filter timeframe using the tabs directly on the Live Drop Alerts panel">
            <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-rose-400" />
            <span className="text-slate-400 hidden xs:inline">Scan:</span>
            <span className="text-rose-400 font-bold">{config.timeframe}</span>
          </div>

          {/* Drop Threshold Config (x% Drop) */}
          <div className="flex items-center bg-[#0b0e14] border border-[#242e42] p-0.5 sm:p-1 rounded-lg sm:rounded-xl gap-0.5 sm:gap-1">
            <span className="text-[10px] sm:text-[11px] font-mono text-slate-400 px-1 sm:px-2 flex items-center gap-1">
              <Sliders className="w-3 h-3 sm:w-3.5 sm:h-3.5 hidden xs:inline" /> &ge;
            </span>
            {PRESET_THRESHOLDS.map((val) => (
              <button
                key={val}
                onClick={() => handleThresholdSelect(val)}
                className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[11px] sm:text-xs font-mono font-medium rounded transition-all ${
                  config.thresholdPercent === val
                    ? 'bg-amber-500 text-black font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c29]'
                }`}
              >
                {val}%
              </button>
            ))}
            <div className="flex items-center pl-1 pr-1 border-l border-[#242e42] ml-0.5">
              <input
                type="number"
                min="0.1"
                max="90"
                step="0.1"
                value={customThreshold}
                onChange={(e) => setCustomThreshold(e.target.value)}
                onBlur={handleCustomThresholdBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleCustomThresholdBlur()}
                placeholder="%"
                className="w-11 sm:w-13 bg-[#161c29] border border-[#2b374e] rounded px-1 py-0.5 text-[11px] sm:text-xs font-mono text-amber-400 text-right focus:outline-none focus:border-amber-500"
              />
              <span className="text-[10px] sm:text-xs font-mono text-slate-400 ml-0.5">%</span>
            </div>
          </div>

          {/* Sound Alert Toggle & Test */}
          <div className="flex items-center bg-[#0b0e14] border border-[#242e42] p-0.5 sm:p-1 rounded-lg sm:rounded-xl">
            <button
              onClick={toggleSound}
              className={`p-1 sm:p-1.5 rounded text-xs flex items-center gap-1 transition-all ${
                config.isSoundEnabled
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={config.isSoundEnabled ? "Sound Alert ON (Click to Mute)" : "Sound Alert MUTED (Click to Enable)"}
            >
              {config.isSoundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          </div>

          {/* Scan Status & Manual Scan Button */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onTriggerScan}
              disabled={status.isScanning}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl font-mono text-[11px] sm:text-xs font-semibold border transition-all ${
                status.isScanning
                  ? 'bg-blue-600/30 border-blue-500/40 text-blue-300 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-600/20 active:scale-95'
              }`}
            >
              <RefreshCw className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${status.isScanning ? 'animate-spin' : ''}`} />
              <span className="hidden xs:inline">{status.isScanning ? 'Scanning...' : 'Scan Now'}</span>
              <span className="xs:hidden">{status.isScanning ? '...' : 'Scan'}</span>
            </button>

            {/* Countdown to Next Candle Close Scan */}
            <div
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-[#0b0e14] border border-[#242e42] text-[10px] sm:text-[11px] font-mono text-slate-400"
              title={`Auto-scans top 100 coins strictly when each ${config.timeframe} candle closes`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
              <span className="text-slate-400 hidden sm:inline">Close:</span>
              <span className="text-blue-400 font-bold">{formatCountdown(status.nextScanIn)}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
