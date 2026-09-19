import { useEffect, useRef, useState } from 'react';
import { Candle, KlineInterval } from '../types';
import { binanceService } from '../services/binanceService';

interface UseBinanceWebSocketOptions {
  symbol: string;
  interval: KlineInterval;
  onCandleUpdate?: (candle: Candle, isClosed: boolean) => void;
}

export function useBinanceWebSocket({ symbol, interval, onCandleUpdate }: UseBinanceWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!symbol) return;

    let isMounted = true;
    const source = binanceService.getSymbolSource(symbol);

    if (source === 'binance_spot' || source === 'binance_futures') {
      const lowerSymbol = symbol.toLowerCase();
      const streamName = `${lowerSymbol}@kline_${interval}`;
      const wsUrl = source === 'binance_futures'
        ? `wss://fstream.binance.com/ws/${streamName}`
        : `wss://stream.binance.com:9443/ws/${streamName}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.e === 'kline' && data.k) {
            const k = data.k;
            const closePrice = parseFloat(k.c);
            
            if (prevPriceRef.current !== null) {
              if (closePrice > prevPriceRef.current) {
                setPriceDirection('up');
              } else if (closePrice < prevPriceRef.current) {
                setPriceDirection('down');
              }
            }
            prevPriceRef.current = closePrice;
            setCurrentPrice(closePrice);

            const candle: Candle = {
              time: Math.floor(k.t / 1000), // in seconds
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: closePrice,
              volume: parseFloat(k.v),
            };

            if (onCandleUpdate) {
              onCandleUpdate(candle, k.x);
            }
          }
        } catch (err) {
          console.warn('Error parsing WS message:', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('Binance WebSocket error:', err);
        if (isMounted) setIsConnected(false);
      };

      ws.onclose = () => {
        if (isMounted) setIsConnected(false);
      };

      return () => {
        isMounted = false;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };
    } else {
      // Non-Binance token (e.g. MEXC or Bitfinex): provide smooth polling every 4 seconds
      setIsConnected(true);

      const pollLatest = async () => {
        try {
          const recentCandles = await binanceService.getKlines(symbol, interval, 2);
          if (!isMounted || recentCandles.length === 0) return;

          const latest = recentCandles[recentCandles.length - 1];
          if (prevPriceRef.current !== null) {
            if (latest.close > prevPriceRef.current) {
              setPriceDirection('up');
            } else if (latest.close < prevPriceRef.current) {
              setPriceDirection('down');
            }
          }
          prevPriceRef.current = latest.close;
          setCurrentPrice(latest.close);

          if (onCandleUpdate) {
            onCandleUpdate(latest, false);
          }
        } catch (err) {
          console.warn('Polling error for', symbol, err);
        }
      };

      pollLatest();
      const intervalId = window.setInterval(pollLatest, 4000);

      return () => {
        isMounted = false;
        window.clearInterval(intervalId);
      };
    }
  }, [symbol, interval, onCandleUpdate]);

  return { isConnected, currentPrice, priceDirection };
}
