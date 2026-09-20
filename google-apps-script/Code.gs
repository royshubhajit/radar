/**
 * Google Apps Script for Crypto Radar Price Predictions
 * 
 * 1. Automatically formats Google Sheet with 12 columns
 * 2. Receives new predictions via Web App Webhook (doPost)
 * 3. Runs 15-minute automated checks (checkPredictions) using 5-MINUTE CANDLES:
 *    - Scans all 5m candles from logged time to check time (max 72 hours = 864 candles)
 *    - Updates Highest Price & Lowest Price reached across the full window
 *    - If target price reached, updates Right At as the CANDLE END TIME, sets Status='Right', Checking='No', Notes='Target Reached'
 *    - Once 72 hours cross post-logging, sets Checking='No', Notes='72h Expired', and stops checking
 *    - Sets Notes='Error: ...' if an error occurs for manual inspection
 *    - Bulk-fetches tickers and batch-writes to the sheet in 1 single call (under 20s for 150+ rows)
 */

const SHEET_NAME = 'Predictions';

const HEADERS = [
  'Coin Symbol',      // Col 1
  'Logged Time',      // Col 2
  'Current Price',    // Col 3
  'Predicted Price',  // Col 4
  'Change %',         // Col 5
  'Highest Price',    // Col 6
  'Lowest Price',     // Col 7
  'Last Checked At',  // Col 8
  'Status',           // Col 9
  'Right At',         // Col 10
  'Checking',         // Col 11: 'Yes' / 'No'
  'Notes'             // Col 12: 'Active', 'Target Reached', '72h Expired', or 'Error: ...'
];

// Symbol mapping for rebrands and trading pairs
const SYMBOL_MAPPINGS = {
  'SATS': '1000SATSUSDT',
  '1000SATS': '1000SATSUSDT',
  'BEAM': 'BEAMXUSDT',
  'BEAMX': 'BEAMXUSDT',
  'FTM': 'SUSDT',
  'MKR': 'SKYUSDT',
  'KLAY': 'KAIAUSDT',
};

// Delisted on Binance Spot: Binance Spot ticker/price endpoint returns stale frozen 2024 prices (e.g. XMR ~$118)
// These MUST be excluded from Binance Spot queries!
const DELISTED_SPOT_SYMBOLS = new Set([
  'XMRUSDT',
  'XMRBTC',
  'XMRETH',
  'XMRBUSD'
]);

// Routed to Binance USDⓈ-M Futures (fapi.binance.com) where active trading continues with real market price
const FUTURES_PRIORITY_SYMBOLS = new Set([
  'XMRUSDT',
  'HYPEUSDT',
  'KASUSDT',
  '1000SATSUSDT'
]);

// Routed to MEXC (api.mexc.com)
const MEXC_PRIORITY_SYMBOLS = new Set([
  'WBTUSDT',
  'LEOUSDT'
]);

/**
 * Normalizes symbols (e.g., 'XMR' -> 'XMRUSDT', 'SATS' -> '1000SATSUSDT')
 */
function normalizeSymbol(symbol) {
  let sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return '';
  
  if (SYMBOL_MAPPINGS[sym]) {
    return SYMBOL_MAPPINGS[sym];
  }
  
  const base = sym.replace(/USDT$/, '').replace(/USD$/, '');
  if (SYMBOL_MAPPINGS[base]) {
    return SYMBOL_MAPPINGS[base];
  }
  
  if (!sym.endsWith('USDT') && !sym.endsWith('USD')) {
    sym = sym + 'USDT';
  }
  
  return sym;
}

/**
 * Validates whether kline data is fresh and non-empty.
 * Rejects stale/delisted historical data older than 48 hours.
 */
function isValidCandleData(data, nowMs) {
  if (!Array.isArray(data) || data.length === 0) return false;
  const lastCandle = data[data.length - 1];
  if (!lastCandle || !Array.isArray(lastCandle) || !lastCandle[0]) return false;
  const lastCandleTime = lastCandle[0]; // open time in ms
  const twoDaysAgo = (nowMs || new Date().getTime()) - (48 * 60 * 60 * 1000);
  if (lastCandleTime < twoDaysAgo) {
    return false; // Stale history from months/years ago
  }
  return true;
}

/**
 * 1. Initial Setup & Migration: Formats sheet with 12 headers and sets column styling
 * Run this function once from the script editor!
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  
  // Set headers in row 1
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');
  
  // Freeze row 1
  sheet.setFrozenRows(1);
  
  // Format column widths
  sheet.setColumnWidth(1, 110); // Symbol
  sheet.setColumnWidth(2, 170); // Logged Time
  sheet.setColumnWidth(3, 120); // Current Price
  sheet.setColumnWidth(4, 120); // Predicted Price
  sheet.setColumnWidth(5, 100); // Change %
  sheet.setColumnWidth(6, 120); // Highest Price
  sheet.setColumnWidth(7, 120); // Lowest Price
  sheet.setColumnWidth(8, 170); // Last Checked At
  sheet.setColumnWidth(9, 90);  // Status
  sheet.setColumnWidth(10, 170); // Right At (Candle End Time)
  sheet.setColumnWidth(11, 90);  // Checking (Yes / No)
  sheet.setColumnWidth(12, 160); // Notes
  
  // Migrate existing rows if needed (populate Col 11 Checking and Col 12 Notes if blank)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const dataRange = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
    const vals = dataRange.getValues();
    const nowMs = new Date().getTime();
    let updated = false;
    
    for (let r = 0; r < vals.length; r++) {
      const row = vals[r];
      const status = String(row[8] || '').trim();
      let checking = String(row[10] || '').trim();
      let notes = String(row[11] || '').trim();
      
      if (!checking) {
        const loggedMs = parseTimestamp(row[1], nowMs);
        const ageHours = (nowMs - loggedMs) / (1000 * 60 * 60);
        if (status === 'Right') {
          vals[r][10] = 'No';
          vals[r][11] = notes || 'Target Reached';
        } else if (ageHours >= 72) {
          vals[r][10] = 'No';
          vals[r][11] = notes || '72h Expired';
        } else {
          vals[r][10] = 'Yes';
          vals[r][11] = notes || 'Active';
        }
        updated = true;
      }
    }
    if (updated) {
      dataRange.setValues(vals);
      Logger.log('Migrated existing rows with Checking and Notes columns.');
    }
  }
  
  Logger.log('Sheet initialized successfully with 12 headers!');
}

/**
 * 2. Setup Automated 15-Minute Cloud Trigger
 * Run this function once to start automated checks every 15 minutes!
 */
function createFifteenMinuteTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkPredictions') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  ScriptApp.newTrigger('checkPredictions')
    .timeBased()
    .everyMinutes(15)
    .create();
    
  Logger.log('15-minute automated prediction check trigger successfully created!');
}

function createTwoHourTrigger() {
  createFifteenMinuteTrigger();
}

/**
 * 3. Webhook Handler: Receives predictions from the Radar website
 */
function doPost(e) {
  try {
    const contents = e.postData ? e.postData.contents : null;
    if (!contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No payload received' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const data = JSON.parse(contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      setupSheet();
      sheet = ss.getSheetByName(SHEET_NAME);
    }
    
    const symbol = (data.symbol || '').toUpperCase();
    const currentTime = data.currentTime || Utilities.formatDate(new Date(), 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
    const currentPrice = parseFloat(data.currentPrice) || 0;
    const predictedPrice = parseFloat(data.predictedPrice) || 0;
    const changePercent = parseFloat(data.changePercent) || 0;
    
    // Initial highest and lowest price is the price at prediction time
    const highestPrice = currentPrice;
    const lowestPrice = currentPrice;
    const lastCheckedAt = currentTime;
    const status = 'Wrong'; // Starts with Wrong as requested
    const rightAt = '';     // Empty until price touches or exceeds predicted price
    const checking = 'Yes'; // Active checking starts as Yes
    const notes = 'Active'; // Initial note
    
    sheet.appendRow([
      symbol,
      currentTime,
      currentPrice,
      predictedPrice,
      changePercent + '%',
      highestPrice,
      lowestPrice,
      lastCheckedAt,
      status,
      rightAt,
      checking,
      notes
    ]);
    
    // Format the new row
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 9).setFontWeight('bold').setFontColor('#ef4444'); // Red text for Wrong
    sheet.getRange(lastRow, 11).setFontWeight('bold').setFontColor('#3b82f6'); // Blue for Checking: Yes
    sheet.getRange(lastRow, 1, 1, HEADERS.length).setHorizontalAlignment('center');
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Prediction logged successfully',
      row: lastRow
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 4. GET Handler: Allows website to check API status or fetch predictions
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const data = sheet.getDataRange().getValues();
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0]) {
        rows.push({
          symbol: row[0],
          loggedTime: row[1],
          currentPrice: row[2],
          predictedPrice: row[3],
          changePercent: row[4],
          highestPrice: row[5],
          lowestPrice: row[6],
          lastCheckedAt: row[7],
          status: row[8],
          rightAt: row[9],
          checking: row[10] || 'Yes',
          notes: row[11] || ''
        });
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      count: rows.length,
      data: rows
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 5. High-Performance 15-Minute Checker
 * 
 * - Checks only active rows (Checking == 'Yes' AND Status != 'Right')
 * - Automatically expires predictions older than 72 hours -> sets Checking='No', Notes='72h Expired'
 * - Uses 5-minute candles exclusively (max 72h = 864 candles, well under the 1,000 limit)
 * - If target is touched, sets Right At as the 5m candle END time, Status='Right', Checking='No', Notes='Target Reached'
 * - Bulk-fetches live tickers in 1 fast HTTP call
 * - Writes all updates back to the spreadsheet in 1 single batch call (under 20s for 150+ coins)
 */
function checkPredictions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('Predictions sheet not found!');
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('No prediction rows to check.');
    return;
  }
  
  // Read entire data range into memory
  const range = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  const values = range.getValues();
  const now = new Date();
  const nowMs = now.getTime();
  const nowFormatted = Utilities.formatDate(now, 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
  
  Logger.log('Starting checkPredictions at ' + nowFormatted + ' for ' + values.length + ' total rows...');
  
  // Step 1: Bulk-fetch all live market tickers in 1 single HTTP request
  const liveTickersMap = fetchAllLiveTickers();
  Logger.log('Bulk live tickers loaded: ' + liveTickersMap.size + ' symbols.');
  
  let checkedCount = 0;
  let rightCount = 0;
  let expiredCount = 0;
  const newlyRightRows = [];
  const newlyExpiredRows = [];
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowIndex = i + 2;
    
    const rawSymbol = String(row[0] || '').trim().toUpperCase();
    if (!rawSymbol) continue;
    
    const pair = normalizeSymbol(rawSymbol);
    const status = String(row[8] || '').trim();
    let checking = String(row[10] || '').trim();
    
    // If checking is blank, default to 'Yes' unless already marked Right
    if (!checking) {
      checking = status === 'Right' ? 'No' : 'Yes';
      values[i][10] = checking;
    }
    
    // Rule: Skip rows that are already completed (Right or Checking: No)
    if (status === 'Right' || checking.toLowerCase() === 'no') {
      continue;
    }
    
    // Rule: Check 72-Hour Cutoff
    const startMs = parseTimestamp(row[1], nowMs - 24 * 3600 * 1000);
    const ageHours = (nowMs - startMs) / (1000 * 60 * 60);
    
    if (ageHours >= 72) {
      values[i][10] = 'No';
      values[i][11] = '72h Expired';
      values[i][7] = nowFormatted; // Update last checked time
      expiredCount++;
      newlyExpiredRows.push(rowIndex);
      Logger.log('[Row ' + rowIndex + '] ' + rawSymbol + ': 72 hours crossed (' + ageHours.toFixed(1) + 'h) -> Checking marked No.');
      continue;
    }
    
    // This row is active and within 72 hours
    checkedCount++;
    const entryPrice = parseNum(row[2]);
    const predictedPrice = parseNum(row[3]);
    let currentHigh = parseNum(row[5]);
    let currentLow = parseNum(row[6]);
    
    let isRight = false;
    let rightTimestamp = '';
    let errorMessage = '';
    
    // 1. Get live ticker price from bulk multi-exchange map
    let livePrice = liveTickersMap.get(pair) || 0;
    if (livePrice === 0) {
      livePrice = liveTickersMap.get(rawSymbol) || 0;
    }
    if (livePrice === 0) {
      // Fallback: targeted individual query
      livePrice = fetchCurrentPrice(pair);
    }
    
    // Seed true window extremes starting from entry price
    let calcHigh = entryPrice > 0 ? entryPrice : 0;
    let calcLow = entryPrice > 0 ? entryPrice : 0;
    
    if (livePrice > 0) {
      if (calcHigh === 0 || livePrice > calcHigh) calcHigh = livePrice;
      if (calcLow === 0 || livePrice < calcLow) calcLow = livePrice;
      
      // Live price touch target check
      if (predictedPrice > 0 && livePrice >= predictedPrice) {
        isRight = true;
        rightTimestamp = nowFormatted;
      }
    }
    
    // 2. Fetch 5-Minute Candles from logged time to now (max 72h = 864 candles)
    try {
      const candles = fetchFiveMinuteCandles(pair, startMs, nowMs);
      if (candles && candles.length > 0) {
        for (let c = 0; c < candles.length; c++) {
          const candle = candles[c];
          const cOpenTime = candle[0];
          const cHigh = parseFloat(candle[2]);
          const cLow = parseFloat(candle[3]);
          
          if (!isNaN(cHigh) && cHigh > 0) {
            if (calcHigh === 0 || cHigh > calcHigh) calcHigh = cHigh;
          }
          if (!isNaN(cLow) && cLow > 0) {
            if (calcLow === 0 || cLow < calcLow) calcLow = cLow;
          }
          
          // Bullish check: Did candle high touch or exceed predicted price?
          if (predictedPrice > 0 && cHigh >= predictedPrice && !isRight) {
            isRight = true;
            // Candle END time = candle open time + 5 minutes
            const candleEndTimeMs = cOpenTime + (5 * 60 * 1000);
            rightTimestamp = Utilities.formatDate(new Date(candleEndTimeMs), 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
          }
        }
        
        // Auto-heal: Set highest and lowest directly from true continuous 5m candles + entry price
        currentHigh = calcHigh;
        currentLow = calcLow;
      } else {
        // Candles temporarily unavailable: apply live price with anti-corruption guard
        if (livePrice > 0) {
          if (currentHigh <= 0 || livePrice > currentHigh) currentHigh = livePrice;
          // Guard: do not retain an absurdly low price (e.g. 118 when entry was 280)
          if (currentLow <= 0 || (entryPrice > 0 && currentLow < entryPrice * 0.4)) {
            currentLow = livePrice;
          } else if (livePrice < currentLow) {
            currentLow = livePrice;
          }
        }
      }
    } catch (err) {
      errorMessage = 'Error: ' + (err.message || err.toString());
      Logger.log('[Row ' + rowIndex + '] ' + rawSymbol + ' candle fetch error: ' + errorMessage);
    }
    
    // Update row fields in memory
    values[i][5] = currentHigh;
    values[i][6] = currentLow;
    values[i][7] = nowFormatted; // Last Checked At
    
    if (isRight) {
      values[i][8] = 'Right';
      values[i][9] = rightTimestamp || nowFormatted;
      values[i][10] = 'No'; // Stop checking once target is reached!
      values[i][11] = 'Target Reached';
      rightCount++;
      newlyRightRows.push(rowIndex);
      Logger.log('[Row ' + rowIndex + '] ' + rawSymbol + ' TARGET HIT! Right at ' + (rightTimestamp || nowFormatted) + ' (High: $' + currentHigh + ')');
    } else {
      values[i][8] = 'Wrong';
      values[i][10] = 'Yes';
      values[i][11] = errorMessage ? errorMessage : 'Active';
    }
    
    // Polite 100ms pause to prevent burst rate limits
    Utilities.sleep(100);
  }
  
  // Step 3: Write ALL updated rows back to the sheet in ONE single bulk call
  range.setValues(values);
  Logger.log('Batch updated ' + values.length + ' rows to sheet in 1 call.');
  
  // Step 4: Batch-style status cells (green for Right, gray for Expired)
  for (let r = 0; r < newlyRightRows.length; r++) {
    const rowNum = newlyRightRows[r];
    sheet.getRange(rowNum, 9).setFontWeight('bold').setFontColor('#22c55e'); // Green
    sheet.getRange(rowNum, 11).setFontWeight('normal').setFontColor('#94a3b8'); // Gray for No
  }
  for (let e = 0; e < newlyExpiredRows.length; e++) {
    const rowNum = newlyExpiredRows[e];
    sheet.getRange(rowNum, 11).setFontWeight('normal').setFontColor('#94a3b8'); // Gray for No
    sheet.getRange(rowNum, 12).setFontColor('#f59e0b'); // Amber for 72h Expired
  }
  
  Logger.log('checkPredictions completed! Checked: ' + checkedCount + ', Newly Right: ' + rightCount + ', Expired: ' + expiredCount);
}

/**
 * Bulk-fetches all current ticker prices across:
 * 1. Binance Spot (Binance Vision cluster - excludes delisted XMR)
 * 2. Binance Futures (fapi.binance.com - gets real active XMR, HYPE, KAS)
 * 3. MEXC (api.mexc.com - gets WBT, LEO, and any alternative tokens)
 */
function fetchAllLiveTickers() {
  const map = new Map();
  
  // 1. Binance Vision Spot (Non-geo-restricted public cluster)
  try {
    const res = UrlFetchApp.fetch('https://data-api.binance.vision/api/v3/ticker/price', { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const list = JSON.parse(res.getContentText());
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (item && item.symbol && item.price) {
            // CRITICAL: Skip delisted spot pairs so stale 2024 price never enters the map
            if (DELISTED_SPOT_SYMBOLS.has(item.symbol)) continue;
            map.set(item.symbol, parseFloat(item.price) || 0);
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Binance Vision ticker warning: ' + e);
  }
  
  // 2. Binance USDⓈ-M Futures (Real active prices for XMR, HYPE, KAS, etc.)
  try {
    const fRes = UrlFetchApp.fetch('https://fapi.binance.com/fapi/v1/ticker/price', { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fList = JSON.parse(fRes.getContentText());
      if (Array.isArray(fList)) {
        for (let i = 0; i < fList.length; i++) {
          const fItem = fList[i];
          if (fItem && fItem.symbol && fItem.price) {
            const p = parseFloat(fItem.price) || 0;
            // Overwrite if futures priority (XMR, HYPE, KAS) or if not yet in map
            if (FUTURES_PRIORITY_SYMBOLS.has(fItem.symbol) || !map.has(fItem.symbol)) {
              map.set(fItem.symbol, p);
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Binance Futures ticker warning: ' + e);
  }

  // 3. MEXC Spot (Prices for WBT, LEO, etc.)
  try {
    const mRes = UrlFetchApp.fetch('https://api.mexc.com/api/v3/ticker/price', { muteHttpExceptions: true });
    if (mRes.getResponseCode() === 200) {
      const mList = JSON.parse(mRes.getContentText());
      if (Array.isArray(mList)) {
        for (let i = 0; i < mList.length; i++) {
          const mItem = mList[i];
          if (mItem && mItem.symbol && mItem.price) {
            const p = parseFloat(mItem.price) || 0;
            if (MEXC_PRIORITY_SYMBOLS.has(mItem.symbol) || !map.has(mItem.symbol)) {
              map.set(mItem.symbol, p);
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log('MEXC ticker warning: ' + e);
  }
  
  return map;
}

/**
 * Fetches 5-MINUTE CANDLES with intelligent multi-exchange routing:
 * - XMR, HYPE, KAS -> Binance Futures & MEXC
 * - WBT, LEO -> MEXC & Bitfinex
 * - Standard pairs -> Binance Vision Spot -> MEXC -> Binance Futures -> Mirrors
 * Validates freshness to discard any ancient delisted data.
 */
function fetchFiveMinuteCandles(pair, startTime, endTime) {
  const norm = normalizeSymbol(pair);
  const interval = '5m';
  const nowMs = new Date().getTime();
  
  // 1-minute buffer to ensure candle containing exact logged second is included
  const fetchStart = startTime - 60000;
  let fetchEnd = endTime;
  if (fetchStart >= fetchEnd) {
    fetchEnd = fetchStart + 300000; // 5 min forward
  }
  
  // ROUTE A: Futures Priority (XMR, HYPE, KAS)
  if (FUTURES_PRIORITY_SYMBOLS.has(norm)) {
    // A1. Binance Futures (fapi.binance.com)
    try {
      const fUrl = 'https://fapi.binance.com/fapi/v1/klines?symbol=' + encodeURIComponent(norm) +
        '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
      const fRes = UrlFetchApp.fetch(fUrl, { muteHttpExceptions: true });
      if (fRes.getResponseCode() === 200) {
        const fData = JSON.parse(fRes.getContentText());
        if (isValidCandleData(fData, nowMs)) return fData;
      }
    } catch (_) {}
    
    // A2. MEXC Global
    try {
      const mexcUrl = 'https://api.mexc.com/api/v3/klines?symbol=' + encodeURIComponent(norm) +
        '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
      const mexcRes = UrlFetchApp.fetch(mexcUrl, { muteHttpExceptions: true });
      if (mexcRes.getResponseCode() === 200) {
        const mData = JSON.parse(mexcRes.getContentText());
        if (isValidCandleData(mData, nowMs)) return mData;
      }
    } catch (_) {}
    
    return [];
  }
  
  // ROUTE B: MEXC Priority (WBT, LEO)
  if (MEXC_PRIORITY_SYMBOLS.has(norm)) {
    // B1. MEXC Global
    try {
      const mexcUrl = 'https://api.mexc.com/api/v3/klines?symbol=' + encodeURIComponent(norm) +
        '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
      const mexcRes = UrlFetchApp.fetch(mexcUrl, { muteHttpExceptions: true });
      if (mexcRes.getResponseCode() === 200) {
        const mData = JSON.parse(mexcRes.getContentText());
        if (isValidCandleData(mData, nowMs)) return mData;
      }
    } catch (_) {}
    
    // B2. If LEOUSDT, try Bitfinex
    if (norm === 'LEOUSDT') {
      try {
        const bfxUrl = 'https://api-pub.bitfinex.com/v2/candles/trade:5m:tLEOUSD/hist?start=' + fetchStart + '&end=' + fetchEnd + '&limit=1000';
        const bfxRes = UrlFetchApp.fetch(bfxUrl, { muteHttpExceptions: true });
        if (bfxRes.getResponseCode() === 200) {
          const bData = JSON.parse(bfxRes.getContentText());
          if (Array.isArray(bData) && bData.length > 0) {
            const reversed = bData.slice().reverse();
            const mapped = reversed.map(function(c) {
              return [c[0], c[1], c[3], c[4], c[2], c[5]];
            });
            if (isValidCandleData(mapped, nowMs)) return mapped;
          }
        }
      } catch (_) {}
    }
    
    return [];
  }
  
  // ROUTE C: Standard Tokens (BTC, SOL, ETH, DOGE, etc.)
  // C1. Binance Vision Spot (Non-geo-restricted public cluster)
  try {
    const visionUrl = 'https://data-api.binance.vision/api/v3/klines?symbol=' + encodeURIComponent(norm) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
    const visionRes = UrlFetchApp.fetch(visionUrl, { muteHttpExceptions: true });
    if (visionRes.getResponseCode() === 200) {
      const data = JSON.parse(visionRes.getContentText());
      if (isValidCandleData(data, nowMs)) return data;
    }
  } catch (_) {}
  
  // C2. MEXC Global
  try {
    const mexcUrl = 'https://api.mexc.com/api/v3/klines?symbol=' + encodeURIComponent(norm) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
    const mexcRes = UrlFetchApp.fetch(mexcUrl, { muteHttpExceptions: true });
    if (mexcRes.getResponseCode() === 200) {
      const mData = JSON.parse(mexcRes.getContentText());
      if (isValidCandleData(mData, nowMs)) return mData;
    }
  } catch (_) {}
  
  // C3. Binance Futures
  try {
    const fUrl = 'https://fapi.binance.com/fapi/v1/klines?symbol=' + encodeURIComponent(norm) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
    const fRes = UrlFetchApp.fetch(fUrl, { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fData = JSON.parse(fRes.getContentText());
      if (isValidCandleData(fData, nowMs)) return fData;
    }
  } catch (_) {}
  
  // C4. Binance US & Public Mirrors
  const mirrors = ['https://api.binance.us', 'https://api1.binance.com', 'https://api2.binance.com', 'https://api.binance.com'];
  for (let m = 0; m < mirrors.length; m++) {
    try {
      const u = mirrors[m] + '/api/v3/klines?symbol=' + encodeURIComponent(norm) +
        '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
      const r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) {
        const d = JSON.parse(r.getContentText());
        if (isValidCandleData(d, nowMs)) return d;
      }
    } catch (_) {}
  }
  
  return [];
}

// Backward-compatibility aliases
function fetchCandles(pair, startTime, endTime) {
  return fetchFiveMinuteCandles(pair, startTime, endTime);
}

function fetchBinanceCandles(symbol, startTime, endTime) {
  return fetchFiveMinuteCandles(symbol, startTime, endTime);
}

/**
 * Individual ticker price fetcher with multi-exchange fallback
 */
function fetchCurrentPrice(pair) {
  const norm = normalizeSymbol(pair);
  
  // 1. Futures Priority (XMR, HYPE, KAS) -> Check Binance Futures first!
  if (FUTURES_PRIORITY_SYMBOLS.has(norm)) {
    try {
      const res = UrlFetchApp.fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const data = JSON.parse(res.getContentText());
        if (data && data.price) return parseFloat(data.price) || 0;
      }
    } catch (_) {}
  }
  
  // 2. MEXC Priority (WBT, LEO) -> Check MEXC first!
  if (MEXC_PRIORITY_SYMBOLS.has(norm)) {
    try {
      const mRes = UrlFetchApp.fetch('https://api.mexc.com/api/v3/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
      if (mRes.getResponseCode() === 200) {
        const mData = JSON.parse(mRes.getContentText());
        if (mData && mData.price) return parseFloat(mData.price) || 0;
      }
    } catch (_) {}
  }
  
  // 3. Binance Vision Spot (Only if not delisted on spot)
  if (!DELISTED_SPOT_SYMBOLS.has(norm)) {
    try {
      const res = UrlFetchApp.fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const data = JSON.parse(res.getContentText());
        if (data && data.price) return parseFloat(data.price) || 0;
      }
    } catch (_) {}
  }
  
  // 4. Binance Futures general fallback
  try {
    const fRes = UrlFetchApp.fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fData = JSON.parse(fRes.getContentText());
      if (fData && fData.price) return parseFloat(fData.price) || 0;
    }
  } catch (_) {}
  
  // 5. MEXC general fallback
  try {
    const mRes = UrlFetchApp.fetch('https://api.mexc.com/api/v3/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
    if (mRes.getResponseCode() === 200) {
      const mData = JSON.parse(mRes.getContentText());
      if (mData && mData.price) return parseFloat(mData.price) || 0;
    }
  } catch (_) {}
  
  return 0;
}

/**
 * Helper: Safely parses numbers from cells containing commas or formatting
 */
function parseNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]+/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Helper: Safely parses timestamp from Date object or IST/UTC string
 */
function parseTimestamp(cellVal, fallbackMs) {
  if (!cellVal) return fallbackMs;
  if (cellVal instanceof Date) {
    const t = cellVal.getTime();
    return (!isNaN(t) && t > 0) ? t : fallbackMs;
  }
  const str = String(cellVal).trim();
  if (str.includes('IST')) {
    const clean = str.replace(' IST', '').trim().replace(' ', 'T') + '+05:30';
    const ms = new Date(clean).getTime();
    if (!isNaN(ms) && ms > 0) return ms;
  }
  if (str.includes('UTC')) {
    const clean = str.replace(' UTC', 'Z').trim().replace(' ', 'T');
    const ms = new Date(clean).getTime();
    if (!isNaN(ms) && ms > 0) return ms;
  }
  const ms = new Date(str).getTime();
  return (!isNaN(ms) && ms > 0) ? ms : fallbackMs;
}

/**
 * 6. Quick Test Function
 * Select and run this in Apps Script to verify live multi-exchange tickers,
 * specifically verifying that XMR returns real market price (> $200) and NOT stale $118!
 */
function testConnection() {
  Logger.log('--- Testing Multi-Exchange Live Tickers ---');
  const tickers = fetchAllLiveTickers();
  Logger.log('Total tickers loaded: ' + tickers.size);
  
  const btcPrice = tickers.get('BTCUSDT') || fetchCurrentPrice('BTCUSDT');
  const xmrPrice = tickers.get('XMRUSDT') || fetchCurrentPrice('XMRUSDT');
  const hypePrice = tickers.get('HYPEUSDT') || fetchCurrentPrice('HYPEUSDT');
  const wbtPrice = tickers.get('WBTUSDT') || fetchCurrentPrice('WBTUSDT');
  
  Logger.log('BTC Price: $' + btcPrice);
  Logger.log('XMR (Monero) Price: $' + xmrPrice + (xmrPrice > 200 ? ' [VERIFIED CORRECT LIVE PRICE!]' : ' [WARNING: Stale price!]'));
  Logger.log('HYPE Price: $' + hypePrice);
  Logger.log('WBT Price: $' + wbtPrice);
  
  Logger.log('--- Testing 5m Candle Fetch for XMR (Monero) ---');
  const now = new Date().getTime();
  const oneHourAgo = now - 60 * 60 * 1000;
  const xmrCandles = fetchFiveMinuteCandles('XMRUSDT', oneHourAgo, now);
  Logger.log('XMR 5m candles returned: ' + (xmrCandles ? xmrCandles.length : 0));
  if (xmrCandles && xmrCandles.length > 0) {
    const latestCandle = xmrCandles[xmrCandles.length - 1];
    const cHigh = latestCandle[2];
    const cLow = latestCandle[3];
    Logger.log('Latest XMR 5m candle: High=$' + cHigh + ', Low=$' + cLow);
  }
}
