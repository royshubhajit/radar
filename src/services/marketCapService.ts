import { CoinInfo } from '../types';

// Stablecoins and wrapped pegged tokens to filter out from drop screener
const EXCLUDED_SYMBOLS = new Set([
  'USDT', 'USDC', 'FDUSD', 'DAI', 'USDE', 'TUSD', 'BUSD', 'USDD', 
  'PYUSD', 'USDP', 'EUR', 'EURS', 'WBTC', 'WETH', 'STETH', 'WBETH', 
  'WEETH', 'CBETH', 'RETH', 'METH'
]);

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
  { symbol: 'LEO', name: 'UNUS SED LEO' },
  { symbol: 'WBT', name: 'WhiteBIT Token' },
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
  { symbol: 'FTM', name: 'Fantom' },
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
  { symbol: 'EOS', name: 'EOS' },
  { symbol: 'FLOW', name: 'Flow' },
  { symbol: 'GALA', name: 'Gala' },
  { symbol: 'NEO', name: 'Neo' },
  { symbol: 'KLAY', name: 'Klaytn' },
  { symbol: 'CRV', name: 'Curve DAO' },
  { symbol: 'MKR', name: 'Maker' },
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
  { symbol: 'BEAM', name: 'Beam' },
  { symbol: 'PYTH', name: 'Pyth Network' },
  { symbol: 'NOT', name: 'Notcoin' },
  { symbol: 'STRK', name: 'Starknet' },
  { symbol: 'ORDI', name: 'Ordinals' },
  { symbol: 'SATS', name: 'SATS' },
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

    // Try CoinCap API
    try {
      const response = await fetch('https://api.coincap.io/v2/assets?limit=120', {
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) {
        const json = await response.json();
        if (json.data && Array.isArray(json.data)) {
          const list: CoinInfo[] = [];
          let rank = 1;
          for (const item of json.data) {
            const sym = (item.symbol || '').toUpperCase();
            if (EXCLUDED_SYMBOLS.has(sym)) continue;
            
            list.push({
              id: item.id || sym.toLowerCase(),
              symbol: sym,
              binanceSymbol: `${sym}USDT`,
              name: item.name || sym,
              rank: rank++,
              priceUsd: parseFloat(item.priceUsd) || 0,
              change24h: parseFloat(item.changePercent24Hr) || 0,
              marketCapUsd: parseFloat(item.marketCapUsd) || 0,
            });

            if (list.length >= 100) break;
          }

          if (list.length >= 50) {
            this.cachedCoins = list;
            this.lastFetchTime = now;
            return list;
          }
        }
      }
    } catch (e) {
      console.warn('CoinCap API unavailable, attempting CoinGecko fallback:', e);
    }

    // Try CoinGecko API fallback
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=120&page=1&sparkline=false'
      );
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          const list: CoinInfo[] = [];
          let rank = 1;
          for (const item of data) {
            const sym = (item.symbol || '').toUpperCase();
            if (EXCLUDED_SYMBOLS.has(sym)) continue;

            list.push({
              id: item.id || sym.toLowerCase(),
              symbol: sym,
              binanceSymbol: `${sym}USDT`,
              name: item.name || sym,
              rank: rank++,
              priceUsd: item.current_price || 0,
              change24h: item.price_change_percentage_24h || 0,
              marketCapUsd: item.market_cap || 0,
            });

            if (list.length >= 100) break;
          }

          if (list.length >= 50) {
            this.cachedCoins = list;
            this.lastFetchTime = now;
            return list;
          }
        }
      }
    } catch (e) {
      console.warn('CoinGecko API unavailable, using built-in curated top 100 fallback:', e);
    }

    // Curated Fallback
    const fallbackList: CoinInfo[] = FALLBACK_TOP_100.map((item, index) => ({
      id: item.symbol.toLowerCase(),
      symbol: item.symbol,
      binanceSymbol: `${item.symbol}USDT`,
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
