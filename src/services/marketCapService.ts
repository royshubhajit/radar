import { CoinInfo } from '../types';

// Stablecoins, wrapped pegged tokens, synthetic RWAs, and user-excluded coins
const EXCLUDED_SYMBOLS = new Set([
  'USDT', 'USDC', 'FDUSD', 'DAI', 'USDE', 'TUSD', 'BUSD', 'USDD', 
  'PYUSD', 'USDP', 'EUR', 'EURS', 'WBTC', 'WETH', 'STETH', 'WBETH', 
  'WEETH', 'CBETH', 'RETH', 'METH',
  // User excluded tokens:
  'FIGR_HELOC', 'RAIN', 'WBT', 'USDS', 'LEO', 'USD1', 'USDG', 'CRO',
  'XAUT', 'USYC', 'OKB', 'RLUSF', 'BUIDL', 'USDY', 'MNT', 'PAXG',
  'HTX', 'BGB', 'EURSAFO', 'USDG0', 'USDGO', 'USDF', 'U', 'GT', 'KCS',
  'PI', 'EUTBL', 'JAAA', 'USTB', 'GHO', 'BDX', 'FLR', 'USDO', 'YLDS'
]);

// Special symbol mappings to ensure active trading pairs on Binance/exchanges
export const SYMBOL_TO_BINANCE: Record<string, string> = {
  SATS: '1000SATSUSDT',
  '1000SATS': '1000SATSUSDT',
  BEAM: 'BEAMXUSDT',
  BEAMX: 'BEAMXUSDT',
  FTM: 'SUSDT',
  MKR: 'SKYUSDT',
  KLAY: 'KAIAUSDT',
  USELESS: 'USELESSUSDT',
  MARSCOIN: 'MARSCOINUSDT',
  FARTCOIN: 'FARTCOINUSDT',
  PENGU: 'PENGUUSDT',
};

// Priority user coins guaranteed to be included in the watchlist
export const PRIORITY_COINS: Array<{ symbol: string; name: string; binanceSymbol: string }> = [
  { symbol: 'USELESS', name: 'Useless', binanceSymbol: 'USELESSUSDT' },
  { symbol: 'MARSCOIN', name: 'Marscoin', binanceSymbol: 'MARSCOINUSDT' },
  { symbol: 'FARTCOIN', name: 'Fartcoin', binanceSymbol: 'FARTCOINUSDT' },
  { symbol: 'PENGU', name: 'Pudgy Penguins', binanceSymbol: 'PENGUUSDT' },
];

// Top 100 curated fallback list ensures 100% uptime even if CoinGecko/CoinCap rate-limits
const FALLBACK_TOP_100: Array<{ symbol: string; name: string }> = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'TRX', name: 'TRON' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'SUI', name: 'Sui' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'SHIB', name: 'Shiba Inu' },
  { symbol: 'XLM', name: 'Stellar' },
  { symbol: 'DOT', name: 'Polkadot' },
  { symbol: 'BCH', name: 'Bitcoin Cash' },
  { symbol: 'HYPE', name: 'Hyperliquid' },
  { symbol: 'USELESS', name: 'Useless' },
  { symbol: 'MARSCOIN', name: 'Marscoin' },
  { symbol: 'FARTCOIN', name: 'Fartcoin' },
  { symbol: 'PENGU', name: 'Pudgy Penguins' },
  { symbol: 'NEAR', name: 'NEAR Protocol' },
  { symbol: 'UNI', name: 'Uniswap' },
  { symbol: 'LTC', name: 'Litecoin' },
  { symbol: 'PEPE', name: 'Pepe' },
  { symbol: 'APT', name: 'Aptos' },
  { symbol: 'ICP', name: 'Internet Computer' },
  { symbol: 'ETC', name: 'Ethereum Classic' },
  { symbol: 'HBAR', name: 'Hedera' },
  { symbol: 'POL', name: 'Polygon' },
  { symbol: 'RENDER', name: 'Render' },
  { symbol: 'FET', name: 'Artificial Superintelligence' },
  { symbol: 'TAO', name: 'Bittensor' },
  { symbol: 'ATOM', name: 'Cosmos' },
  { symbol: 'KAS', name: 'Kaspa' },
  { symbol: 'XMR', name: 'Monero' },
  { symbol: 'VET', name: 'VeChain' },
  { symbol: 'FIL', name: 'Filecoin' },
  { symbol: 'AAVE', name: 'Aave' },
  { symbol: 'ALGO', name: 'Algorand' },
  { symbol: 'TIA', name: 'Celestia' },
  { symbol: 'ARB', name: 'Arbitrum' },
  { symbol: 'OP', name: 'Optimism' },
  { symbol: 'INJ', name: 'Injective' },
  { symbol: 'STX', name: 'Stacks' },
  { symbol: 'S', name: 'Sonic' },
  { symbol: 'SEI', name: 'Sei' },
  { symbol: 'BONK', name: 'Bonk' },
  { symbol: 'FLOKI', name: 'Floki' },
  { symbol: 'THETA', name: 'Theta Network' },
  { symbol: 'WIF', name: 'dogwifhat' },
  { symbol: 'IMX', name: 'Immutable' },
  { symbol: 'GRT', name: 'The Graph' },
  { symbol: 'RUNE', name: 'THORChain' },
  { symbol: 'SAND', name: 'The Sandbox' },
  { symbol: 'MANA', name: 'Decentraland' },
  { symbol: 'AXS', name: 'Axie Infinity' },
  { symbol: 'RAY', name: 'Raydium' },
  { symbol: 'FLOW', name: 'Flow' },
  { symbol: 'GALA', name: 'Gala' },
  { symbol: 'NEO', name: 'Neo' },
  { symbol: 'KAIA', name: 'Kaia' },
  { symbol: 'CRV', name: 'Curve DAO' },
  { symbol: 'SKY', name: 'Sky' },
  { symbol: 'LDO', name: 'Lido DAO' },
  { symbol: 'QNT', name: 'Quant' },
  { symbol: 'EGLD', name: 'MultiversX' },
  { symbol: 'MINA', name: 'Mina' },
  { symbol: 'DYDX', name: 'dYdX' },
  { symbol: 'SNX', name: 'Synthetix' },
  { symbol: 'CHZ', name: 'Chiliz' },
  { symbol: 'CAKE', name: 'PancakeSwap' },
  { symbol: 'PENDLE', name: 'Pendle' },
  { symbol: 'BLUR', name: 'Blur' },
  { symbol: 'JUP', name: 'Jupiter' },
  { symbol: 'ENA', name: 'Ethena' },
  { symbol: 'ONDO', name: 'Ondo' },
  { symbol: 'WLD', name: 'Worldcoin' },
  { symbol: 'KAVA', name: 'Kava' },
  { symbol: 'ZEC', name: 'Zcash' },
  { symbol: 'COMP', name: 'Compound' },
  { symbol: 'ENJ', name: 'Enjin' },
  { symbol: 'ROSE', name: 'Oasis' },
  { symbol: '1INCH', name: '1inch' },
  { symbol: 'CFX', name: 'Conflux' },
  { symbol: 'ZIL', name: 'Zilliqa' },
  { symbol: 'LUNC', name: 'Terra Classic' },
  { symbol: 'WOO', name: 'WOO' },
  { symbol: 'IOTA', name: 'IOTA' },
  { symbol: 'GNO', name: 'Gnosis' },
  { symbol: 'JASMY', name: 'JasmyCoin' },
  { symbol: 'SUPER', name: 'SuperVerse' },
  { symbol: 'BEAMX', name: 'Beam' },
  { symbol: 'PYTH', name: 'Pyth Network' },
  { symbol: 'NOT', name: 'Notcoin' },
  { symbol: 'STRK', name: 'Starknet' },
  { symbol: 'ORDI', name: 'Ordinals' },
  { symbol: '1000SATS', name: '1000SATS (Ordinals)' },
  { symbol: 'MEME', name: 'Memecoin' },
  { symbol: 'ARKM', name: 'Arkham' },
  { symbol: 'ALT', name: 'Altlayer' },
  { symbol: 'PORTAL', name: 'Portal' },
  { symbol: 'PIXEL', name: 'Pixels' },
  { symbol: 'DYM', name: 'Dymension' },
  { symbol: 'AEVO', name: 'Aevo' }
];

class MarketCapService {
  private cachedCoins: CoinInfo[] = [];
  private lastFetchTime = 0;
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes

  /**
   * Fetches top 100 coins by market cap, filtering stablecoins and mapping to USDT pairs
   */
  public async getTop100Coins(forceRefresh = false): Promise<CoinInfo[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedCoins.length > 0 && now - this.lastFetchTime < this.CACHE_TTL) {
      return this.cachedCoins;
    }

    // 1. Try CoinGecko API first with expanded limit (up to 250) to account for excluded tokens
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false'
      );
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          const list: CoinInfo[] = [];
          for (const item of data) {
            const sym = (item.symbol || '').toUpperCase().trim();
            const id = (item.id || '').toUpperCase().trim();
            if (EXCLUDED_SYMBOLS.has(sym) || EXCLUDED_SYMBOLS.has(id)) continue;

            const binanceSymbol = SYMBOL_TO_BINANCE[sym] || `${sym}USDT`;
            list.push({
              id: item.id || sym.toLowerCase(),
              symbol: sym,
              binanceSymbol,
              name: item.name || sym,
              rank: 0,
              priceUsd: item.current_price || 0,
              change24h: item.price_change_percentage_24h || 0,
              marketCapUsd: item.market_cap || 0,
            });

            if (list.length >= 100) break;
          }

          // Ensure priority user coins are guaranteed in the top 100
          const missingPriority = PRIORITY_COINS.filter(
            (p) => !list.some((c) => c.symbol === p.symbol || c.binanceSymbol === p.binanceSymbol)
          );

          if (list.length + missingPriority.length > 100) {
            list.splice(100 - missingPriority.length);
          }

          for (const p of missingPriority) {
            list.push({
              id: p.symbol.toLowerCase(),
              symbol: p.symbol,
              binanceSymbol: p.binanceSymbol,
              name: p.name,
              rank: 0,
              priceUsd: 0,
              change24h: 0,
              marketCapUsd: 0,
            });
          }

          list.forEach((c, idx) => {
            c.rank = idx + 1;
          });

          if (list.length >= 50) {
            this.cachedCoins = list;
            this.lastFetchTime = now;
            return list;
          }
        }
      }
    } catch (e) {
      console.warn('CoinGecko API unavailable, attempting CoinCap fallback:', e);
    }

    // 2. Try CoinCap API
    try {
      const response = await fetch('https://api.coincap.io/v2/assets?limit=200', {
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) {
        const json = await response.json();
        if (json.data && Array.isArray(json.data)) {
          const list: CoinInfo[] = [];
          for (const item of json.data) {
            const sym = (item.symbol || '').toUpperCase().trim();
            const id = (item.id || '').toUpperCase().trim();
            if (EXCLUDED_SYMBOLS.has(sym) || EXCLUDED_SYMBOLS.has(id)) continue;
            
            const binanceSymbol = SYMBOL_TO_BINANCE[sym] || `${sym}USDT`;
            list.push({
              id: item.id || sym.toLowerCase(),
              symbol: sym,
              binanceSymbol,
              name: item.name || sym,
              rank: 0,
              priceUsd: parseFloat(item.priceUsd) || 0,
              change24h: parseFloat(item.changePercent24Hr) || 0,
              marketCapUsd: parseFloat(item.marketCapUsd) || 0,
            });

            if (list.length >= 100) break;
          }

          // Ensure priority user coins are guaranteed in the top 100
          const missingPriority = PRIORITY_COINS.filter(
            (p) => !list.some((c) => c.symbol === p.symbol || c.binanceSymbol === p.binanceSymbol)
          );

          if (list.length + missingPriority.length > 100) {
            list.splice(100 - missingPriority.length);
          }

          for (const p of missingPriority) {
            list.push({
              id: p.symbol.toLowerCase(),
              symbol: p.symbol,
              binanceSymbol: p.binanceSymbol,
              name: p.name,
              rank: 0,
              priceUsd: 0,
              change24h: 0,
              marketCapUsd: 0,
            });
          }

          list.forEach((c, idx) => {
            c.rank = idx + 1;
          });

          if (list.length >= 50) {
            this.cachedCoins = list;
            this.lastFetchTime = now;
            return list;
          }
        }
      }
    } catch (e) {
      console.warn('CoinCap API unavailable, using built-in curated top 100 fallback:', e);
    }

    // 3. Curated Fallback
    const fallbackList: CoinInfo[] = FALLBACK_TOP_100.map((item, index) => ({
      id: item.symbol.toLowerCase(),
      symbol: item.symbol,
      binanceSymbol: SYMBOL_TO_BINANCE[item.symbol] || `${item.symbol}USDT`,
      name: item.name,
      rank: index + 1,
      priceUsd: 0,
      change24h: 0,
      marketCapUsd: 0,
    }));

    this.cachedCoins = fallbackList;
    this.lastFetchTime = now;
    return fallbackList;
  }
}

export const marketCapService = new MarketCapService();
