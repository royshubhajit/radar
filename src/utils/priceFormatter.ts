/**
 * Unified Price Formatter
 * Ensures 100% precision consistency across Candlestick Chart, Top 100 Watchlist,
 * Crypto Calculator, and Drop Alerts without conflicting rounding rules.
 */

export function cleanPriceString(num: number): string {
  if (isNaN(num) || num <= 0) return '0.00';

  if (num >= 100) {
    // Keep 2 decimals for values >= 100, but preserve 3rd/4th decimal if midpoint has half-cent precision
    const s = num.toFixed(4);
    return s.replace(/(\.\d\d[1-9]*)0+$/, '$1').replace(/(\.\d\d)00$/, '$1');
  }
  if (num >= 1) {
    // Keep up to 5 decimals, at least 2 decimals for values 1 to 99.99 (e.g. 14.50, 7.852, 1.2345)
    const s = num.toFixed(5);
    return s.replace(/(\.\d\d[1-9]*)0+$/, '$1').replace(/(\.\d\d)00$/, '$1');
  }
  if (num >= 0.0001) {
    // Keep up to 6 decimals, at least 4 decimals for values 0.0001 to 0.9999 (e.g. 0.5842, 0.63685, 0.048312)
    const s = num.toFixed(6);
    return s.replace(/(\.\d{4}[1-9]*)0+$/, '$1');
  }
  // 8 decimals for sub-micro coins (e.g. PEPE 0.00001850)
  return num.toFixed(8);
}

export function formatCryptoPrice(
  val: number | string | undefined | null,
  options?: { includeCommas?: boolean; includeDollar?: boolean; isInput?: boolean }
): string {
  if (val === undefined || val === null || val === '') {
    return options?.isInput ? '' : '--';
  }

  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num) || num <= 0) {
    return options?.isInput ? '' : '--';
  }

  const includeCommas = options?.includeCommas ?? false;
  const includeDollar = options?.includeDollar ?? false;
  const prefix = includeDollar ? '$' : '';

  const cleanStr = cleanPriceString(num);

  if (includeCommas) {
    const parts = cleanStr.split('.');
    const integerPart = parseInt(parts[0], 10).toLocaleString('en-US');
    return `${prefix}${integerPart}.${parts[1] || '00'}`;
  }

  return `${prefix}${cleanStr}`;
}

/**
 * Format for Chart and Watchlist display with '$' and thousand separators
 * e.g. "$64,250.37", "$148.25", "$0.5842", "$0.048312"
 */
export function formatPriceDisplay(val: number | string | undefined | null): string {
  return formatCryptoPrice(val, { includeCommas: true, includeDollar: true });
}

/**
 * Format for Calculator number inputs (clean unrounded digits without commas)
 * e.g. "64250.37", "148.25", "0.5842", "0.048312"
 */
export function formatPriceInput(val: number | string | undefined | null): string {
  return formatCryptoPrice(val, { isInput: true });
}

/**
 * High-precision formatter for Drop Alerts open/close prices
 */
export function formatPrice6(val: number | string | undefined | null): string {
  return formatCryptoPrice(val, { includeCommas: true, includeDollar: true });
}
