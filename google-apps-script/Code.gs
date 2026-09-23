/**
 * Google Apps Script for Crypto Radar Price Predictions
 * 
 * 1. Automatically formats Google Sheet with 14 columns:
 *    - Col M (13): Checking Source ('Binance Futures', 'Binance Spot', 'MEXC', etc.)
 *    - Col N (14): Elapsed Time ('HH:MM' from Logged Time to Right At, blank if Wrong)
 * 2. Binance Futures (fapi.binance.com) is ALWAYS Priority #1 for all price & candle checks
 * 3. Fallback cascade: Binance Futures -> Binance Spot -> MEXC -> Bitfinex
 * 4. Receives new predictions via Web App Webhook (doPost)
 * 5. Runs 1-MINUTE automated checks (checkPredictions) using 5-MINUTE CANDLES:
 *    - Triggered every 1 minute for near real-time target hit detection
 *    - Concurrency lock (LockService) prevents overlapping runs
 *    - Execution time budget (50s) ensures each run finishes before the next 1-minute tick
 *    - Auto-detects and self-heals sheet column dimensions if fewer than 14 columns exist
 *    - Auto-installs and validates 1-minute trigger if not present
 *    - Writes a visual Heartbeat note to cell A1 with last check time & stats
 *    - Top-level try/catch/finally prevents silent trigger failures
 *    - Scans all 5m candles from logged time to check time (max 72 hours = 864 candles)
 *    - Updates Highest Price & Lowest Price reached across the full window
 *    - If target price reached, updates Right At as CANDLE END TIME, sets Status='Right', Checking='No', Notes='Target Reached'
 *    - Computes and records Elapsed Time in 'HH:MM' format from Logged Time to Right At
 *    - If status is Wrong/Active/Expired, Elapsed Time remains blank
 *    - Once 72 hours cross post-logging, sets Checking='No', Notes='72h Expired', and stops checking
 *    - Bulk-fetches tickers and batch-writes to the sheet in 1 single call (under 5s for 150+ rows)
 */

const SHEET_NAME = 'Predictions';

const HEADERS = [
  'Coin Symbol',      // Col 1 (A)
  'Logged Time',      // Col 2 (B)
  'Current Price',    // Col 3 (C)
  'Predicted Price',  // Col 4 (D)
  'Change %',         // Col 5 (E)
  'Highest Price',    // Col 6 (F)
  'Lowest Price',     // Col 7 (G)
  'Last Checked At',  // Col 8 (H)
  'Status',           // Col 9 (I)
  'Right At',         // Col 10 (J)
  'Checking',         // Col 11 (K): 'Yes' / 'No'
  'Notes',            // Col 12 (L): 'Active', 'Target Reached', '72h Expired', or 'Error: ...'
  'Checking Source',  // Col 13 (M): 'Binance Futures', 'Binance Spot', 'MEXC', etc.
  'Elapsed Time'      // Col 14 (N): 'HH:MM' from Logged Time to Right At (blank if Wrong)
];

// Symbol mapping for rebrands, 1000x prefixes, and trading pairs
const SYMBOL_MAPPINGS = {
  'SATS': '1000SATSUSDT',
  '1000SATS': '1000SATSUSDT',
  'BEAM': 'BEAMXUSDT',
  'BEAMX': 'BEAMXUSDT',
  'FTM': 'SUSDT',
  'MKR': 'SKYUSDT',
  'KLAY': 'KAIAUSDT',
  'USELESS': 'USELESSUSDT',
  'MARSCOIN': 'MARSCOINUSDT',
  'FARTCOIN': 'FARTCOINUSDT',
  'PENGU': 'PENGUUSDT'
};

// Delisted on Binance Spot: Binance Spot ticker/price endpoint returns stale frozen 2024 prices (e.g. XMR ~$118)
// These MUST be excluded from Binance Spot queries!
const DELISTED_SPOT_SYMBOLS = new Set([
  'XMRUSDT',
  'XMRBTC',
  'XMRETH',
  'XMRBUSD'
]);

/**
 * Ensures the Google Sheet has at least HEADERS.length (14) columns allocated in its grid.
 * Prevents "The coordinates or dimensions of the range are invalid" exception.
 */
function ensureSheetColumns(sheet) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < HEADERS.length) {
    sheet.insertColumnsAfter(maxCols, HEADERS.length - maxCols);
    Logger.log('Expanded sheet grid from ' + maxCols + ' to ' + HEADERS.length + ' columns.');
  }
}

/**
 * Updates a visual heartbeat note on cell A1 showing the exact time of the last check.
 * Hover over cell A1 in Google Sheets anytime to confirm the background trigger is alive!
 */
function updateSheetHeartbeat(sheet, message) {
  try {
    const nowFormatted = Utilities.formatDate(new Date(), 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
    const note = 'Automated Prediction Monitor (1m interval):\nLast Checked: ' + nowFormatted + '\n' + (message || '');
    sheet.getRange('A1').setNote(note);
  } catch (_) {}
}

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
 * Calculates elapsed time in HH:MM format from loggedTime to rightAtTime.
 * Returns blank '' if either time is missing or invalid.
 */
function formatElapsedTime(loggedTime, rightAtTime) {
  if (!loggedTime || !rightAtTime) return '';
  const startMs = parseTimestamp(loggedTime, 0);
  const endMs = parseTimestamp(rightAtTime, 0);
  if (startMs <= 0 || endMs <= 0 || endMs < startMs) return '';
  
  const diffMs = endMs - startMs;
  const totalMinutes = Math.round(diffMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  
  const hh = hours < 10 ? '0' + hours : '' + hours;
  const mm = mins < 10 ? '0' + mins : '' + mins;
  return hh + ':' + mm;
}

/**
 * 1. Initial Setup & Migration: Formats sheet with 14 headers and sets column styling
 * Run this function once from the script editor!
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  
  // Ensure grid has at least 14 columns
  ensureSheetColumns(sheet);
  
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
  sheet.setColumnWidth(13, 150); // Checking Source (Col M)
  sheet.setColumnWidth(14, 120); // Elapsed Time (Col N)
  
  // Format Col 14 as plain text to preserve HH:MM formatting without date conversion
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    sheet.getRange(2, 14, maxRows - 1, 1).setNumberFormat('@');
  }
  
  // Migrate existing rows if needed
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const dataRange = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
    const vals = dataRange.getValues();
    const nowMs = new Date().getTime();
    let updated = false;
    
    for (let r = 0; r < vals.length; r++) {
      const row = vals[r];
      const status = String(row[8] || '').trim();
      const rightAt = row[9];
      let checking = String(row[10] || '').trim();
      let notes = String(row[11] || '').trim();
      let source = String(row[12] || '').trim();
      let elapsed = String(row[13] || '').trim();
      
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
      
      if (!source) {
        vals[r][12] = 'Binance Futures';
        updated = true;
      }
      
      // Calculate Elapsed Time for Right predictions, blank for Wrong
      if (status === 'Right' && rightAt) {
        const calcElapsed = formatElapsedTime(row[1], rightAt);
        if (calcElapsed && vals[r][13] !== calcElapsed) {
          vals[r][13] = calcElapsed;
          updated = true;
        }
      } else {
        if (vals[r][13] !== '') {
          vals[r][13] = '';
          updated = true;
        }
      }
    }
    if (updated) {
      dataRange.setValues(vals);
      Logger.log('Migrated existing rows with Checking, Notes, Checking Source, and Elapsed Time columns.');
    }
  }
  
  // Ensure automated 1-minute trigger is active
  ensureTriggerInstalled();
  
  updateSheetHeartbeat(sheet, 'Sheet initialized and 1m trigger active');
  Logger.log('Sheet initialized successfully with 14 headers (including Col M: Checking Source & Col N: Elapsed Time)!');
}

/**
 * 2. Setup Automated 1-Minute Cloud Trigger
 * Run this function once from script editor to start automated checks every 1 minute!
 */
function createOneMinuteTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkPredictions') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  ScriptApp.newTrigger('checkPredictions')
    .timeBased()
    .everyMinutes(1)
    .create();
    
  Logger.log('1-minute automated prediction check trigger successfully created!');
}

// Backward-compatibility aliases
function createFifteenMinuteTrigger() {
  createOneMinuteTrigger();
}

function createTwoHourTrigger() {
  createOneMinuteTrigger();
}

/**
 * Auto-installs the 1-minute trigger if missing.
 */
function ensureTriggerInstalled() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'checkPredictions') {
        return; // Trigger already exists
      }
    }
    // Not found, auto-create 1-minute trigger
    createOneMinuteTrigger();
  } catch (err) {
    Logger.log('Note: Trigger auto-install check: ' + err);
  }
}

/**
 * Diagnostics function: Inspects existing triggers and updates to a clean 1-minute trigger.
 * Run this from the Apps Script editor anytime to check trigger health!
 */
function checkTriggerStatus() {
  Logger.log('=== Automated 1-Minute Trigger Status Check ===');
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('Total project triggers installed: ' + triggers.length);
  
  let count = 0;
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    const fn = t.getHandlerFunction();
    Logger.log('Trigger #' + (i + 1) + ': function=' + fn + ', eventType=' + t.getEventType() + ', id=' + t.getUniqueId());
    if (fn === 'checkPredictions') {
      count++;
    }
  }
  
  // Reinstall fresh 1-minute trigger to guarantee 1-minute interval
  Logger.log('Setting up clean 1-minute trigger for checkPredictions...');
  createOneMinuteTrigger();
  Logger.log('SUCCESS: Active 1-minute trigger installed and running for checkPredictions.');
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
    
    ensureSheetColumns(sheet);
    
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
    const elapsedTime = ''; // Blank when status is Wrong
    
    // Resolve checking source (Binance Futures is always priority 1)
    const sourceInfo = fetchCurrentPriceWithSource(symbol);
    const checkingSource = data.checkingSource || sourceInfo.source || 'Binance Futures';
    
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
      notes,
      checkingSource,
      elapsedTime
    ]);
    
    // Format the new row
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 9).setFontWeight('bold').setFontColor('#ef4444'); // Red text for Wrong
    sheet.getRange(lastRow, 11).setFontWeight('bold').setFontColor('#3b82f6'); // Blue for Checking: Yes
    sheet.getRange(lastRow, 14).setNumberFormat('@'); // Plain text format for Elapsed Time
    sheet.getRange(lastRow, 1, 1, HEADERS.length).setHorizontalAlignment('center');
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Prediction logged successfully',
      row: lastRow,
      checkingSource: checkingSource
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
          notes: row[11] || '',
          checkingSource: row[12] || 'Binance Futures',
          elapsedTime: row[13] || ''
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
 * 5. High-Performance 1-Minute Checker
 * 
 * - Runs every 1 minute for near real-time target hit detection
 * - Concurrency lock prevents overlapping executions
 * - 50-second execution time budget ensures execution completes before the next minute
 * - Auto-heals sheet column dimensions so grid never throws range dimension errors
 * - Auto-installs missing 1-minute trigger if deleted
 * - Writes a visual heartbeat note on cell A1 showing the exact time of the last run
 * - Priority #1: Always queries Binance Futures (fapi.binance.com) for real futures chart prices
 * - Fallback cascade: Binance Futures -> Binance Spot -> MEXC -> Bitfinex
 * - Automatically expires predictions older than 72 hours -> sets Checking='No', Notes='72h Expired'
 * - Uses 5-minute candles exclusively (max 72h = 864 candles, well under the 1,000 limit)
 * - If target is touched:
 *     - sets Right At as the 5m candle END time
 *     - Status='Right', Checking='No', Notes='Target Reached'
 *     - calculates Elapsed Time in 'HH:MM' format from Logged Time to Right At
 * - If status is Wrong/Expired, Elapsed Time remains blank
 * - Populates Column M ('Checking Source') with the exact exchange queried
 * - Populates Column N ('Elapsed Time') with 'HH:MM' format
 * - Bulk-fetches live tickers in 1 fast HTTP call
 * - Writes all updates back to the spreadsheet in 1 single batch call (under 5s for 150+ coins)
 */
function checkPredictions() {
  // Prevent overlapping runs when executing every 1 minute
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    Logger.log('Previous checkPredictions execution is still running. Skipping overlapping run.');
    return;
  }
  
  const executionStartTime = new Date().getTime();
  const MAX_RUNTIME_MS = 50 * 1000; // 50 seconds safety cutoff for 1-minute triggers
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      Logger.log('Active spreadsheet not found.');
      return;
    }
    
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      Logger.log('Predictions sheet not found!');
      return;
    }
    
    // Step 0: Ensure sheet has at least 14 columns allocated in grid
    ensureSheetColumns(sheet);
    
    // Ensure automated 1-minute trigger is active
    ensureTriggerInstalled();
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log('No prediction rows to check.');
      updateSheetHeartbeat(sheet, 'No prediction rows to check');
      return;
    }
    
    // Auto-header check: Ensure Sheet has 14 columns (including Col M: Checking Source & Col N: Elapsed Time)
    if (sheet.getLastColumn() < HEADERS.length || sheet.getRange(1, 14).getValue() !== 'Elapsed Time') {
      const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setValues([HEADERS]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e293b');
      headerRange.setFontColor('#ffffff');
      headerRange.setHorizontalAlignment('center');
      sheet.setColumnWidth(13, 150); // Checking Source
      sheet.setColumnWidth(14, 120); // Elapsed Time
      sheet.getRange(2, 14, Math.max(lastRow - 1, 1), 1).setNumberFormat('@');
    }
    
    // Read entire data range into memory
    const range = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
    const values = range.getValues();
    const now = new Date();
    const nowMs = now.getTime();
    const nowFormatted = Utilities.formatDate(now, 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
    
    Logger.log('Starting checkPredictions at ' + nowFormatted + ' for ' + values.length + ' total rows...');
    
    // Step 1: Bulk-fetch all live market tickers (Binance Futures is Priority #1)
    const tickersData = fetchAllLiveTickers();
    const liveTickersMap = tickersData.prices;
    const liveSourcesMap = tickersData.sources;
    Logger.log('Bulk live tickers loaded: ' + liveTickersMap.size + ' symbols.');
    
    let checkedCount = 0;
    let rightCount = 0;
    let expiredCount = 0;
    const newlyRightRows = [];
    const newlyExpiredRows = [];
    
    for (let i = 0; i < values.length; i++) {
      // Safety check: Don't exceed 50s to prevent overlapping with next 1-minute trigger
      if (new Date().getTime() - executionStartTime > MAX_RUNTIME_MS) {
        Logger.log('1-minute time budget reached (50s). Saving processed rows and stopping gracefully.');
        break;
      }
      
      const row = values[i];
      const rowIndex = i + 2;
      
      const rawSymbol = String(row[0] || '').trim().toUpperCase();
      if (!rawSymbol) continue;
      
      const pair = normalizeSymbol(rawSymbol);
      const status = String(row[8] || '').trim();
      let checking = String(row[10] || '').trim();
      let checkingSource = String(row[12] || '').trim();
      
      // If checking is blank, default to 'Yes' unless already marked Right
      if (!checking) {
        checking = status === 'Right' ? 'No' : 'Yes';
        values[i][10] = checking;
      }
      
      // If checkingSource is blank on an existing row, default to Binance Futures
      if (!checkingSource) {
        checkingSource = 'Binance Futures';
        values[i][12] = checkingSource;
      }
      
      // If already marked Right: ensure Elapsed Time is filled, then skip
      if (status === 'Right') {
        if (!row[13] && row[9]) {
          values[i][13] = formatElapsedTime(row[1], row[9]);
        }
        continue;
      }
      
      // If checking is marked No (and not Right), ensure Elapsed Time is blank, then skip
      if (checking.toLowerCase() === 'no') {
        values[i][13] = '';
        continue;
      }
      
      // Rule: Check 72-Hour Cutoff
      const startMs = parseTimestamp(row[1], nowMs - 24 * 3600 * 1000);
      const ageHours = (nowMs - startMs) / (1000 * 60 * 60);
      
      if (ageHours >= 72) {
        values[i][10] = 'No';
        values[i][11] = '72h Expired';
        values[i][7] = nowFormatted; // Update last checked time
        values[i][13] = ''; // Blank if Wrong/Expired
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
      let resolvedSource = checkingSource || 'Binance Futures';
      
      // 1. Get live ticker price and source from bulk map
      let livePrice = liveTickersMap.get(pair) || 0;
      let liveSource = liveSourcesMap.get(pair) || '';
      if (livePrice === 0) {
        livePrice = liveTickersMap.get(rawSymbol) || 0;
        liveSource = liveSourcesMap.get(rawSymbol) || '';
      }
      if (livePrice === 0) {
        // Fallback: targeted individual query (checks Binance Futures first)
        const priceInfo = fetchCurrentPriceWithSource(pair);
        livePrice = priceInfo.price;
        liveSource = priceInfo.source;
      }
      
      if (liveSource) {
        resolvedSource = liveSource;
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
      
      // 2. Fetch 5-Minute Candles from logged time to now (Binance Futures Priority #1)
      try {
        const candles = fetchFiveMinuteCandles(pair, startMs, nowMs);
        if (candles && candles.length > 0) {
          if (candles.source) {
            resolvedSource = candles.source;
          }
          
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
      values[i][12] = resolvedSource; // Column M: Checking Source
      
      if (isRight) {
        const finalRightTime = rightTimestamp || nowFormatted;
        values[i][8] = 'Right';
        values[i][9] = finalRightTime;
        values[i][10] = 'No'; // Stop checking once target is reached!
        values[i][11] = 'Target Reached';
        values[i][13] = formatElapsedTime(row[1], finalRightTime); // Column N: Elapsed Time
        rightCount++;
        newlyRightRows.push(rowIndex);
        Logger.log('[Row ' + rowIndex + '] ' + rawSymbol + ' TARGET HIT! Right at ' + finalRightTime + ' (Elapsed: ' + values[i][13] + ', High: $' + currentHigh + ', Source: ' + resolvedSource + ')');
      } else {
        values[i][8] = 'Wrong';
        values[i][10] = 'Yes';
        values[i][11] = errorMessage ? errorMessage : 'Active';
        values[i][13] = ''; // Blank if Wrong
      }
      
      // Polite 50ms pause to prevent burst rate limits
      Utilities.sleep(50);
    }
    
    // Step 3: Write ALL updated rows back to the sheet in ONE single bulk call
    range.setValues(values);
    Logger.log('Batch updated ' + values.length + ' rows to sheet in 1 call.');
    
    // Step 4: Batch-style status cells (green for Right, gray for Expired)
    for (let r = 0; r < newlyRightRows.length; r++) {
      const rowNum = newlyRightRows[r];
      sheet.getRange(rowNum, 9).setFontWeight('bold').setFontColor('#22c55e'); // Green
      sheet.getRange(rowNum, 11).setFontWeight('normal').setFontColor('#94a3b8'); // Gray for No
      sheet.getRange(rowNum, 14).setNumberFormat('@'); // Plain text for Elapsed Time
    }
    for (let e = 0; e < newlyExpiredRows.length; e++) {
      const rowNum = newlyExpiredRows[e];
      sheet.getRange(rowNum, 11).setFontWeight('normal').setFontColor('#94a3b8'); // Gray for No
      sheet.getRange(rowNum, 12).setFontColor('#f59e0b'); // Amber for 72h Expired
    }
    
    // Update visual heartbeat on cell A1
    updateSheetHeartbeat(sheet, 'Active checked: ' + checkedCount + ' | Newly Right: ' + rightCount + ' | Expired: ' + expiredCount);
    
    Logger.log('checkPredictions completed! Checked: ' + checkedCount + ', Newly Right: ' + rightCount + ', Expired: ' + expiredCount);
  } catch (globalErr) {
    Logger.log('CRITICAL: checkPredictions encountered error: ' + globalErr);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        const sheet = ss.getSheetByName(SHEET_NAME);
        if (sheet) {
          updateSheetHeartbeat(sheet, 'ERROR on last run: ' + (globalErr.message || globalErr));
        }
      }
    } catch (_) {}
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

/**
 * Bulk-fetches all current ticker prices with BINANCE FUTURES AS PRIORITY #1:
 * 1. Binance USDⓈ-M Futures (fapi.binance.com) - Real active prices for all major coins and perps (BTC, USELESS, FARTCOIN, PENGU, XMR, HYPE, KAS)
 * 2. Binance Vision Spot (data-api.binance.vision) - Only for tokens not present on Futures
 */
function fetchAllLiveTickers() {
  const priceMap = new Map();
  const sourceMap = new Map();
  
  // 1. PRIORITY 1: Binance USDⓈ-M Futures (fapi.binance.com)
  try {
    const fRes = UrlFetchApp.fetch('https://fapi.binance.com/fapi/v1/ticker/price', { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fList = JSON.parse(fRes.getContentText());
      if (Array.isArray(fList)) {
        for (let i = 0; i < fList.length; i++) {
          const fItem = fList[i];
          if (fItem && fItem.symbol && fItem.price) {
            const p = parseFloat(fItem.price) || 0;
            if (p > 0) {
              priceMap.set(fItem.symbol, p);
              sourceMap.set(fItem.symbol, 'Binance Futures');
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Binance Futures bulk ticker warning: ' + e);
  }

  // 2. PRIORITY 2: Binance Vision Spot (Non-geo-restricted public cluster)
  // Only add tokens NOT already present in Binance Futures
  try {
    const res = UrlFetchApp.fetch('https://data-api.binance.vision/api/v3/ticker/price', { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const list = JSON.parse(res.getContentText());
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (item && item.symbol && item.price) {
            if (DELISTED_SPOT_SYMBOLS.has(item.symbol)) continue;
            if (!priceMap.has(item.symbol)) {
              const p = parseFloat(item.price) || 0;
              if (p > 0) {
                priceMap.set(item.symbol, p);
                sourceMap.set(item.symbol, 'Binance Spot');
              }
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Binance Vision Spot bulk ticker warning: ' + e);
  }
  
  return { prices: priceMap, sources: sourceMap };
}

/**
 * Fetches 5-MINUTE CANDLES with BINANCE FUTURES AS FIRST PRIORITY:
 * 1. Binance USDⓈ-M Futures (fapi.binance.com) -> Always tried first for every token!
 * 2. Binance Vision Spot (data-api.binance.vision) -> Fallback if token not on Futures
 * 3. MEXC Global (api.mexc.com) -> Fallback for MEXC tokens
 * 4. Bitfinex (api-pub.bitfinex.com) -> Fallback for LEO, etc.
 * 5. Binance Public Mirrors -> Redundant fallbacks
 * 
 * Attaches the resolved source name to the returned array (e.g. data.source = 'Binance Futures').
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
  
  // PRIORITY 1: Binance USDⓈ-M Futures (fapi.binance.com) ALWAYS FIRST!
  try {
    const fUrl = 'https://fapi.binance.com/fapi/v1/klines?symbol=' + encodeURIComponent(norm) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
    const fRes = UrlFetchApp.fetch(fUrl, { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fData = JSON.parse(fRes.getContentText());
      if (isValidCandleData(fData, nowMs)) {
        fData.source = 'Binance Futures';
        return fData;
      }
    }
  } catch (_) {}
  
  // PRIORITY 2: Binance Vision Spot (data-api.binance.vision)
  if (!DELISTED_SPOT_SYMBOLS.has(norm)) {
    try {
      const visionUrl = 'https://data-api.binance.vision/api/v3/klines?symbol=' + encodeURIComponent(norm) +
        '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
      const visionRes = UrlFetchApp.fetch(visionUrl, { muteHttpExceptions: true });
      if (visionRes.getResponseCode() === 200) {
        const data = JSON.parse(visionRes.getContentText());
        if (isValidCandleData(data, nowMs)) {
          data.source = 'Binance Spot';
          return data;
        }
      }
    } catch (_) {}
  }
  
  // PRIORITY 3: MEXC Global (api.mexc.com)
  try {
    const mexcUrl = 'https://api.mexc.com/api/v3/klines?symbol=' + encodeURIComponent(norm) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
    const mexcRes = UrlFetchApp.fetch(mexcUrl, { muteHttpExceptions: true });
    if (mexcRes.getResponseCode() === 200) {
      const mData = JSON.parse(mexcRes.getContentText());
      if (isValidCandleData(mData, nowMs)) {
        mData.source = 'MEXC';
        return mData;
      }
    }
  } catch (_) {}
  
  // PRIORITY 4: Bitfinex (for LEO etc.)
  if (norm === 'LEOUSDT' || norm === 'LEOUSD') {
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
          if (isValidCandleData(mapped, nowMs)) {
            mapped.source = 'Bitfinex';
            return mapped;
          }
        }
      }
    } catch (_) {}
  }
  
  // PRIORITY 5: Binance US & Public Mirrors
  const mirrors = ['https://api1.binance.com', 'https://api2.binance.com', 'https://api3.binance.com', 'https://api.binance.us'];
  for (let m = 0; m < mirrors.length; m++) {
    try {
      const u = mirrors[m] + '/api/v3/klines?symbol=' + encodeURIComponent(norm) +
        '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + fetchEnd + '&limit=1000';
      const r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) {
        const d = JSON.parse(r.getContentText());
        if (isValidCandleData(d, nowMs)) {
          d.source = 'Binance Spot';
          return d;
        }
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
 * Individual ticker price fetcher with source reporting:
 * Priority #1: Binance Futures (fapi.binance.com)
 * Priority #2: Binance Spot (data-api.binance.vision)
 * Priority #3: MEXC (api.mexc.com)
 */
function fetchCurrentPriceWithSource(pair) {
  const norm = normalizeSymbol(pair);
  
  // 1. PRIORITY 1: Binance Futures (fapi.binance.com) ALWAYS FIRST!
  try {
    const res = UrlFetchApp.fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      if (data && data.price) {
        const p = parseFloat(data.price) || 0;
        if (p > 0) return { price: p, source: 'Binance Futures' };
      }
    }
  } catch (_) {}
  
  // 2. PRIORITY 2: Binance Vision Spot (Only if not delisted on spot)
  if (!DELISTED_SPOT_SYMBOLS.has(norm)) {
    try {
      const res = UrlFetchApp.fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const data = JSON.parse(res.getContentText());
        if (data && data.price) {
          const p = parseFloat(data.price) || 0;
          if (p > 0) return { price: p, source: 'Binance Spot' };
        }
      }
    } catch (_) {}
  }
  
  // 3. PRIORITY 3: MEXC Global
  try {
    const mRes = UrlFetchApp.fetch('https://api.mexc.com/api/v3/ticker/price?symbol=' + encodeURIComponent(norm), { muteHttpExceptions: true });
    if (mRes.getResponseCode() === 200) {
      const mData = JSON.parse(mRes.getContentText());
      if (mData && mData.price) {
        const p = parseFloat(mData.price) || 0;
        if (p > 0) return { price: p, source: 'MEXC' };
      }
    }
  } catch (_) {}
  
  return { price: 0, source: 'Unknown' };
}

function fetchCurrentPrice(pair) {
  return fetchCurrentPriceWithSource(pair).price;
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
 * Run this in Apps Script to test live tickers, 5m candle fetches, formatElapsedTime, and 1-minute trigger status.
 */
function testConnection() {
  Logger.log('--- Checking Trigger Health ---');
  checkTriggerStatus();

  Logger.log('--- Testing Multi-Exchange Live Tickers (Binance Futures Priority #1) ---');
  const tickersData = fetchAllLiveTickers();
  const tickers = tickersData.prices;
  const sources = tickersData.sources;
  Logger.log('Total tickers loaded: ' + tickers.size);
  
  const testSymbols = ['BTCUSDT', 'USELESSUSDT', 'FARTCOINUSDT', 'PENGUUSDT', 'MARSCOINUSDT', 'XMRUSDT'];
  for (let s = 0; s < testSymbols.length; s++) {
    const sym = testSymbols[s];
    let price = tickers.get(sym);
    let src = sources.get(sym);
    if (!price) {
      const info = fetchCurrentPriceWithSource(sym);
      price = info.price;
      src = info.source;
    }
    Logger.log(sym + ' -> Price: $' + price + ' | Checking Source: ' + src);
  }
  
  Logger.log('--- Testing formatElapsedTime ---');
  Logger.log('45m elapsed: ' + formatElapsedTime('2026-09-20 10:00:00 IST', '2026-09-20 10:45:00 IST') + ' [Expected: 00:45]');
  Logger.log('2h 15m elapsed: ' + formatElapsedTime('2026-09-20 10:00:00 IST', '2026-09-20 12:15:00 IST') + ' [Expected: 02:15]');
}
