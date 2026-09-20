import React, { useState, useEffect, useMemo } from 'react';
import { Target, TrendingUp, Settings, ExternalLink, ChevronDown, ChevronUp, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { formatPriceInput, formatPriceDisplay } from '../utils/priceFormatter';
import { predictionService } from '../services/predictionService';
import { PredictionItem } from '../types';

interface PricePredictionCardProps {
  selectedSymbol: string;
  currentPrice: number;
}

const PRESET_GAINS = [2, 5, 10, 20, 50];

export const PricePredictionCard: React.FC<PricePredictionCardProps> = ({
  selectedSymbol,
  currentPrice,
}) => {
  const [predictedPrice, setPredictedPrice] = useState<string>('');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  // Settings modal
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [sheetUrl, setSheetUrl] = useState<string>('');
  
  // Recent predictions
  const [recentList, setRecentList] = useState<PredictionItem[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // Load config and initial predictions
  useEffect(() => {
    const config = predictionService.getConfig();
    setWebhookUrl(config.webhookUrl || '');
    setSheetUrl(config.sheetUrl || '');
    setRecentList(predictionService.getRecentPredictions());
  }, []);

  const lastSymbolRef = React.useRef(selectedSymbol);
  const isUserEditedRef = React.useRef(false);

  // When selected coin changes, auto-suggest a 5% bullish target
  useEffect(() => {
    const isNewSymbol = selectedSymbol !== lastSymbolRef.current;
    if (isNewSymbol) {
      lastSymbolRef.current = selectedSymbol;
      isUserEditedRef.current = false;
      if (currentPrice > 0) {
        setPredictedPrice(formatPriceInput(currentPrice * 1.05));
      } else {
        setPredictedPrice('');
      }
    } else if (!isUserEditedRef.current && currentPrice > 0 && !predictedPrice) {
      setPredictedPrice(formatPriceInput(currentPrice * 1.05));
    }
  }, [selectedSymbol, currentPrice, predictedPrice]);

  const baseSymbol = useMemo(() => {
    return selectedSymbol.replace(/USDT?$/, '');
  }, [selectedSymbol]);

  // Calculate percentage change from current to predicted price
  const calc = useMemo(() => {
    const pred = parseFloat(predictedPrice);
    if (!currentPrice || isNaN(pred) || pred <= 0) {
      return { changePercent: 0, diffUsd: 0, isValid: false };
    }
    const diffUsd = pred - currentPrice;
    const changePercent = ((pred - currentPrice) / currentPrice) * 100;
    return {
      changePercent,
      diffUsd,
      isValid: pred > currentPrice, // strictly bullish
    };
  }, [currentPrice, predictedPrice]);

  const handleApplyPreset = (percent: number) => {
    if (!currentPrice || currentPrice <= 0) return;
    const target = currentPrice * (1 + percent / 100);
    setPredictedPrice(formatPriceInput(target));
  };

  const handleSaveSettings = () => {
    predictionService.saveConfig({
      webhookUrl: webhookUrl.trim(),
      sheetUrl: sheetUrl.trim(),
    });
    setShowSettings(false);
    setFeedback({
      type: 'info',
      text: 'Settings saved! Webhook configured.',
    });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleSubmit = async () => {
    let pred = parseFloat(predictedPrice);
    if ((!pred || isNaN(pred) || pred <= currentPrice) && currentPrice > 0) {
      pred = currentPrice * 1.05;
      setPredictedPrice(formatPriceInput(pred));
    }

    if (!pred || isNaN(pred) || pred <= currentPrice) {
      setFeedback({
        type: 'error',
        text: 'Please select a coin or enter a bullish target price higher than the current price.',
      });
      setTimeout(() => setFeedback(null), 4000);
      return;
    }

    const calculatedChange = ((pred - currentPrice) / currentPrice) * 100;

    setIsSubmitting(true);
    setFeedback(null);

    const res = await predictionService.submitPrediction({
      symbol: baseSymbol,
      currentPrice,
      predictedPrice: pred,
      changePercent: parseFloat(calculatedChange.toFixed(2)),
    });

    setIsSubmitting(false);
    setRecentList(predictionService.getRecentPredictions());

    setFeedback({
      type: res.savedLocallyOnly ? 'info' : 'success',
      text: res.message,
    });
    setTimeout(() => setFeedback(null), 5000);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl backdrop-blur-sm flex flex-col transition-all">
      {/* Card Header */}
      <div className="border-b border-slate-800 bg-slate-800/40 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-amber-500/10 text-amber-400">
            <Target className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200 tracking-wide">Target Prediction</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {baseSymbol}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors"
              title="Open Connected Google Sheet"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded transition-colors ${
              showSettings ? 'text-amber-400 bg-slate-800' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Configure Google Sheet Webhook"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
            title={isCollapsed ? 'Expand Prediction Card' : 'Collapse Prediction Card'}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Card Body */}
      {!isCollapsed && (
        <div className="p-3 space-y-3">
          {/* Settings Sub-Drawer */}
          {showSettings && (
            <div className="p-2.5 rounded-lg bg-slate-950/80 border border-amber-500/30 space-y-2 text-xs">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                <Settings className="w-3 h-3" />
                Google Sheet Webhook Settings
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Google Apps Script Web App URL</label>
                <input
                  type="text"
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Google Sheet Spreadsheet URL (Optional)</label>
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[9px] text-slate-400">Code in /google-apps-script/Code.gs</span>
                <button
                  onClick={handleSaveSettings}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-[11px] transition-colors"
                >
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {/* Current vs Predicted Price Row */}
          <div className="grid grid-cols-2 gap-2">
            {/* Current Price */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Current Price</span>
              <div className="text-sm font-mono font-bold text-slate-100 mt-1">
                {currentPrice > 0 ? formatPriceDisplay(currentPrice) : '---'}
              </div>
            </div>

            {/* Target / Predicted Price Input */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">Target Price</span>
                {calc.isValid && (
                  <span className="text-[10px] font-bold font-mono text-emerald-400">
                    +{calc.changePercent.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="relative mt-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs">$</span>
                <input
                  type="number"
                  step="any"
                  value={predictedPrice}
                  onChange={(e) => setPredictedPrice(e.target.value)}
                  placeholder="Target price"
                  className="w-full bg-slate-900 border border-slate-700/80 focus:border-amber-500 rounded pl-4 pr-1 py-0.5 text-xs font-mono text-slate-100 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 shrink-0">Quick Target:</span>
            <div className="flex-1 grid grid-cols-5 gap-1">
              {PRESET_GAINS.map((gain) => (
                <button
                  key={gain}
                  onClick={() => handleApplyPreset(gain)}
                  className="py-0.5 text-[10px] font-mono font-medium rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-emerald-300 border border-slate-700/60 transition-colors"
                >
                  +{gain}%
                </button>
              ))}
            </div>
          </div>

          {/* Feedback Banner */}
          {feedback && (
            <div
              className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : feedback.type === 'error'
                  ? 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                  : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              ) : feedback.type === 'error' ? (
                <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              )}
              <span className="text-[11px] leading-tight">{feedback.text}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer ${
              calc.isValid
                ? 'bg-gradient-to-r from-amber-500 via-emerald-600 to-teal-500 hover:from-amber-400 hover:to-emerald-400 text-white shadow-emerald-950/40 ring-1 ring-emerald-400/40'
                : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-amber-950/40'
            }`}
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : calc.isValid ? (
              <>
                <TrendingUp className="w-4 h-4 text-white" />
                <span className="text-sm font-bold tracking-wide">Log Prediction to Sheet</span>
              </>
            ) : (
              <>
                <Target className="w-4 h-4 text-white" />
                <span className="text-xs font-bold tracking-wide">
                  {currentPrice > 0
                    ? `Log +5% Target ($${formatPriceDisplay(currentPrice * 1.05)})`
                    : 'Log Prediction to Sheet'}
                </span>
              </>
            )}
          </button>

          {/* Recent Predictions Accordion / Drawer */}
          {recentList.length > 0 && (
            <div className="pt-1 border-t border-slate-800/80">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 py-1 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>Recent Predictions ({recentList.length})</span>
                </div>
                {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {showHistory && (
                <div className="mt-1.5 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {recentList.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="p-1.5 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-200">{item.symbol}</span>
                        <span className="text-[10px] text-slate-400">
                          {item.loggedTime.slice(5, 16)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-[11px] text-slate-300">
                          ${item.predictedPrice.toLocaleString()}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            item.status === 'Right'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
