/**
 * Google Apps Script for Crypto Radar Price Predictions
 * 
 * 1. Automatically formats Google Sheet with two sheets:
 *    - 'Predictions': 14 columns (including Col M: Checking Source & Col N: Elapsed Time)
 *    - 'Config': User-controlled check frequency (e.g. 10 minutes) and settings
 * 2. Dynamic Frequency from 'Config' Sheet:
 *    - Change cell B2 in 'Config' sheet to 1, 5, 10, 15, or 30 minutes
 *    - Automatically syncs and updates the background cloud trigger
 * 3. Quota-Preserving Architecture (Zero wasted urlfetch calls):
 *    - Pre-scans sheet: if all predictions are completed/inactive, SKIPS all HTTP fetches entirely (0 calls)
 *    - Only queries Binance Spot if an active coin is not found on Binance Futures
 *    - Uses less than 3% of Google's daily 20,000 urlfetch quota at 10-minute intervals
 * 4. Binance Futures (fapi.binance.com) is ALWAYS Priority #1 for all price & candle checks
 * 5. Automated Checks (checkPredictions) using 5-MINUTE CANDLES:
 *    - Concurrency lock (LockService) prevents overlapping runs
 *    - Scans all 5m candles from logged time to check time (max 72 hours = 864 candles)
 *    - Updates Highest Price & Lowest Price reached across the full window
 *    - If target price reached, updates Right At as CANDLE END TIME, sets Status='Right', Checking='No', Notes='Target Reached'
 *    - Computes and records Elapsed Time in 'HH:MM' format from Logged Time to Right At
 *    - If status is Wrong/Active/Expired, Elapsed Time remains blank
 *    - Once 72 hours cross post-logging, sets Checking='No', Notes='72h Expired', and stops checking
 *    - Visual Heartbeat note on cell A1 with last check time & quota status
 */

const SHEET_NAME = 'Predictions';
const CONFIG_SHEET_NAME = 'Config';

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
 * Creates or updates the Config sheet with user-adjustable settings.
 */
function setupConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET_NAME);
  }
  
  if (sheet.getLastRow() < 1) {
    const configHeaders = [
      ['Setting', 'Value', 'Notes / Allowed Options', 'Current Status']
    ];
    const headerRange = sheet.getRange(1, 1, 1, 4);
    headerRange.setValues(configHeaders);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1e293b');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');
    
    const defaultRows = [
      ['Check Frequency (Minutes)', 10, 'Allowed: 1, 5, 10, 15, or 30 minutes', 'Active (Trigger every 10m)'],
      ['Priority Exchange', 'Binance Futures', 'Binance Futures (Primary) / Spot', 'Active'],
      ['72h Cutoff', 'Yes', 'Yes / No (stops checking after 72h)', 'Active']
    ];
    
    sheet.getRange(2, 1, defaultRows.length, 4).setValues(defaultRows);
    sheet.getRange(2, 2, defaultRows.length, 1).setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(2, 4, defaultRows.length, 1).setFontColor('#22c55e').setFontWeight('bold');
    
    sheet.setColumnWidth(1, 230); // Setting
    sheet.setColumnWidth(2, 90);  // Value
    sheet.setColumnWidth(3, 280); // Notes
    sheet.setColumnWidth(4, 250); // Status
    
    sheet.setFrozenRows(1);
    Logger.log('Config sheet created with default 10-minute check frequency.');
  }
  
  return sheet;
}

/**
 * Reads the configured check frequency from the Config sheet.
 * Validates against Google Apps Script allowed intervals: 1, 5, 10, 15, 30.
 * Defaults to 10 if invalid or empty.
 */
function getConfiguredFrequency() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return 10;
    
    let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    if (!configSheet) {
      configSheet = setupConfigSheet();
    }
    
    const val = configSheet.getRange('B2').getValue();
    const parsed = parseInt(val, 10);
    
    // Google Apps Script timeBased().everyMinutes() ONLY accepts: 1, 5, 10, 15, 30
    const allowed = [1, 5, 10, 15, 30];
    if (allowed.includes(parsed)) {
      return parsed;
    }
    
    // Snap to closest valid interval
    if (parsed <= 2) return 1;
    if (parsed <= 7) return 5;
    if (parsed <= 12) return 10;
    if (parsed <= 20) return 15;
    return 30;
  } catch (err) {
    Logger.log('Error reading config frequency: ' + err);
    return 10;
  }
}

/**
 * Synchronizes the automated trigger with the frequency specified in the Config sheet.
 * Automatically called when checkPredictions runs, or can be run manually anytime!
 */
function syncTriggerFromConfig() {
  const targetMinutes = getConfiguredFrequency();
  const propKey = 'CURRENT_TRIGGER_MINUTES';
  const currentMinutes = parseInt(PropertiesService.getScriptProperties().getProperty(propKey) || '0', 10);
  
  const triggers = ScriptApp.getProjectTriggers();
  let matchingTriggerCount = 0;
  
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if (t.getHandlerFunction() === 'checkPredictions') {
      if (currentMinutes === targetMinutes && matchingTriggerCount === 0) {
        matchingTriggerCount++;
      } else {
        // Delete older or duplicate triggers
        ScriptApp.deleteTrigger(t);
      }
    }
  }
  
  if (matchingTriggerCount === 0) {
    ScriptApp.newTrigger('checkPredictions')
      .timeBased()
      .everyMinutes(targetMinutes)
      .create();
      
    PropertiesService.getScriptProperties().setProperty(propKey, targetMinutes.toString());
    Logger.log('Installed automated trigger for checkPredictions every ' + targetMinutes + ' minute(s)!');
    
    // Update status in Config sheet
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
      if (configSheet) {
        const nowFormatted = Utilities.formatDate(new Date(), 'GMT+5:30', 'HH:mm:ss');
        configSheet.getRange('B2').setValue(targetMinutes);
        configSheet.getRange('D2').setValue('Active (Trigger every ' + targetMinutes + 'm @ ' + nowFormatted + ')');
        configSheet.getRange('D2').setFontColor('#22c55e');
      }
    } catch (_) {}
  }
}

/**
 * Ensures the Google Sheet has at least HEADERS.length (14) columns allocated in its grid.
 */
function ensureSheetColumns(sheet) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < HEADERS.length) {
    sheet.insertColumnsAfter(maxCols, HEADERS.length - maxCols);
    Logger.log('Expanded sheet grid from ' + maxCols + ' to ' + HEADERS.length + ' columns.');
  }
}

/**
 * Updates a visual heartbeat note on cell A1 showing the exact time and status of the last check.
 */
function updateSheetHeartbeat(sheet, message) {
  try {
    const nowFormatted = Utilities.formatDate(new Date(), 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
    const freq = getConfiguredFrequency();
    const note = 'Automated Prediction Monitor (' + freq + 'm interval):\nLast Check: ' + nowFormatted + '\n' + (message || '');
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
 * 1. Initial Setup: Formats 'Predictions' sheet (14 columns) and 'Config' sheet
 * Run this function once from script editor!
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
      Logger.log('Migrated existing rows.');
    }
  }
  
  // Setup Config sheet
  setupConfigSheet();
  
  // Sync trigger frequency from Config sheet
  syncTriggerFromConfig();
  
  updateSheetHeartbeat(sheet, 'Initialized with Config sheet');
  Logger.log('Setup completed successfully!');
}

/**
 * 2. Setup Trigger from Config
 * Reads frequency from Config sheet and creates a single clean trigger.
 */
function createConfiguredTrigger() {
  syncTriggerFromConfig();
}

// Aliases
function createOneMinuteTrigger() {
  syncTriggerFromConfig();
}

function createFifteenMinuteTrigger() {
  syncTriggerFromConfig();
}

function createTwoHourTrigger() {
  syncTriggerFromConfig();
}

/**
 * Diagnostic function: Inspects triggers and syncs with Config sheet.
 */
function checkTriggerStatus() {
  Logger.log('=== Automated Trigger Status Check ===');
  setupConfigSheet();
  const freq = getConfiguredFrequency();
  Logger.log('Config sheet requested frequency: ' + freq + ' minute(s).');
  
  // Re-sync trigger to ensure exact match
  syncTriggerFromConfig();
  Logger.log('SUCCESS: Active trigger verified for checkPredictions every ' + freq + ' minute(s).');
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
    
    const highestPrice = currentPrice;
    const lowestPrice = currentPrice;
    const lastCheckedAt = currentTime;
    const status = 'Wrong';
    const rightAt = '';
    const checking = 'Yes';
    const notes = 'Active';
    const elapsedTime = '';
    
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
    
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 9).setFontWeight('bold').setFontColor('#ef4444');
    sheet.getRange(lastRow, 11).setFontWeight('bold').setFontColor('#3b82f6');
    sheet.getRange(lastRow, 14).setNumberFormat('@');
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
 * 5. High-Performance Quota-Optimized Checker
 * 
 * - Frequency controlled by 'Config' sheet (default 10 minutes)
 * - Concurrency lock prevents overlapping runs
 * - Pre-scans rows: If 0 active predictions exist, skips all HTTP calls to conserve quota
 * - Only queries Binance Spot if an active coin is missing from Binance Futures
 * - Scans 5m candles to detect target touch and computes exact elapsed time
 */
function checkPredictions() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    Logger.log('Previous checkPredictions execution is still running. Skipping overlapping run.');
    return;
  }
  
  const executionStartTime = new Date().getTime();
  const MAX_RUNTIME_MS = 45 * 1000; // 45 seconds safety budget
  
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
    
    // Ensure sheet has at least 14 columns
    ensureSheetColumns(sheet);
    
    // Sync trigger frequency from Config sheet
    syncTriggerFromConfig();
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log('No prediction rows in sheet.');
      updateSheetHeartbeat(sheet, 'No prediction rows to check (0 fetches used)');
      return;
    }
    
    // Auto-header check
    if (sheet.getLastColumn() < HEADERS.length || sheet.getRange(1, 14).getValue() !== 'Elapsed Time') {
      const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setValues([HEADERS]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e293b');
      headerRange.setFontColor('#ffffff');
      headerRange.setHorizontalAlignment('center');
      sheet.setColumnWidth(13, 150);
      sheet.setColumnWidth(14, 120);
      sheet.getRange(2, 14, Math.max(lastRow - 1, 1), 1).setNumberFormat('@');
    }
    
    // Read entire data range into memory
    const range = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
    const values = range.getValues();
    const now = new Date();
    const nowMs = now.getTime();
    const nowFormatted = Utilities.formatDate(now, 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
    
    // =========================================================================
    // QUOTA OPTIMIZATION 1: Pre-scan for active rows before ANY network calls!
    // If no active coins exist, DO NOT call UrlFetchApp at all!
    // =========================================================================
    const activeIndices = [];
    const activeSymbols = new Set();
    
    for (let i = 0; i < values.length; i++) {
      const rawSymbol = String(values[i][0] || '').trim().toUpperCase();
      if (!rawSymbol) continue;
      
      const status = String(values[i][8] || '').trim();
      let checking = String(values[i][10] || '').trim();
      
      if (!checking) {
        checking = status === 'Right' ? 'No' : 'Yes';
        values[i][10] = checking;
      }
      
      // If already Right: ensure Elapsed Time is filled
      if (status === 'Right') {
        if (!values[i][13] && values[i][9]) {
          values[i][13] = formatElapsedTime(values[i][1], values[i][9]);
        }
        continue;
      }
      
      if (checking.toLowerCase() === 'no') {
        values[i][13] = '';
        continue;
      }
      
      // Active row found
      activeIndices.push(i);
      activeSymbols.add(normalizeSymbol(rawSymbol));
    }
    
    if (activeIndices.length === 0) {
      Logger.log('checkPredictions: All rows completed or inactive. Zero network calls needed.');
      range.setValues(values);
      updateSheetHeartbeat(sheet, 'All predictions completed/inactive (0 HTTP calls used)');
      return;
    }
    
    Logger.log('Found ' + activeIndices.length + ' active prediction rows to check.');
    
    // =========================================================================
    // QUOTA OPTIMIZATION 2: Only fetch bulk tickers for active symbols
    // =========================================================================
    const tickersData = fetchAllLiveTickers(activeSymbols);
    const liveTickersMap = tickersData.prices;
    const liveSourcesMap = tickersData.sources;
    
    let checkedCount = 0;
    let rightCount = 0;
    let expiredCount = 0;
    const newlyRightRows = [];
    const newlyExpiredRows = [];
    
    for (let idx = 0; idx < activeIndices.length; idx++) {
      if (new Date().getTime() - executionStartTime > MAX_RUNTIME_MS) {
        Logger.log('Time budget reached. Saving processed rows and stopping gracefully.');
        break;
      }
      
      const i = activeIndices[idx];
      const row = values[i];
      const rowIndex = i + 2;
      
      const rawSymbol = String(row[0] || '').trim().toUpperCase();
      const pair = normalizeSymbol(rawSymbol);
      let checkingSource = String(row[12] || '').trim();
      
      if (!checkingSource) {
        checkingSource = 'Binance Futures';
        values[i][12] = checkingSource;
      }
      
      // 72-Hour Cutoff check
      const startMs = parseTimestamp(row[1], nowMs - 24 * 3600 * 1000);
      const ageHours = (nowMs - startMs) / (1000 * 60 * 60);
      
      if (ageHours >= 72) {
        values[i][10] = 'No';
        values[i][11] = '72h Expired';
        values[i][7] = nowFormatted;
        values[i][13] = '';
        expiredCount++;
        newlyExpiredRows.push(rowIndex);
        Logger.log('[Row ' + rowIndex + '] ' + rawSymbol + ': 72 hours crossed -> Checking marked No.');
        continue;
      }
      
      checkedCount++;
      const entryPrice = parseNum(row[2]);
      const predictedPrice = parseNum(row[3]);
      let currentHigh = parseNum(row[5]);
      let currentLow = parseNum(row[6]);
      
      let isRight = false;
      let rightTimestamp = '';
      let errorMessage = '';
      let resolvedSource = checkingSource || 'Binance Futures';
      
      // Live ticker price
      let livePrice = liveTickersMap.get(pair) || liveTickersMap.get(rawSymbol) || 0;
      let liveSource = liveSourcesMap.get(pair) || liveSourcesMap.get(rawSymbol) || '';
      
      if (livePrice === 0) {
        const priceInfo = fetchCurrentPriceWithSource(pair);
        livePrice = priceInfo.price;
        liveSource = priceInfo.source;
      }
      
      if (liveSource) {
        resolvedSource = liveSource;
      }
      
      let calcHigh = entryPrice > 0 ? entryPrice : 0;
      let calcLow = entryPrice > 0 ? entryPrice : 0;
      
      if (livePrice > 0) {
        if (calcHigh === 0 || livePrice > calcHigh) calcHigh = livePrice;
        if (calcLow === 0 || livePrice < calcLow) calcLow = livePrice;
        
        if (predictedPrice > 0 && livePrice >= predictedPrice) {
          isRight = true;
          rightTimestamp = nowFormatted;
        }
      }
      
      // Fetch 5-Minute Candles (Priority #1 Binance Futures)
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
            
            if (predictedPrice > 0 && cHigh >= predictedPrice && !isRight) {
              isRight = true;
              const candleEndTimeMs = cOpenTime + (5 * 60 * 1000);
              rightTimestamp = Utilities.formatDate(new Date(candleEndTimeMs), 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
            }
          }
          
          currentHigh = calcHigh;
          currentLow = calcLow;
        } else {
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
      
      values[i][5] = currentHigh;
      values[i][6] = currentLow;
      values[i][7] = nowFormatted;
      values[i][12] = resolvedSource;
      
      if (isRight) {
        const finalRightTime = rightTimestamp || nowFormatted;
        values[i][8] = 'Right';
        values[i][9] = finalRightTime;
        values[i][10] = 'No';
        values[i][11] = 'Target Reached';
        values[i][13] = formatElapsedTime(row[1], finalRightTime);
        rightCount++;
        newlyRightRows.push(rowIndex);
        Logger.log('[Row ' + rowIndex + '] ' + rawSymbol + ' TARGET HIT! Right at ' + finalRightTime + ' (Elapsed: ' + values[i][13] + ')');
      } else {
        values[i][8] = 'Wrong';
        values[i][10] = 'Yes';
        values[i][11] = errorMessage ? errorMessage : 'Active';
        values[i][13] = '';
      }
      
      Utilities.sleep(50);
    }
    
    // Batch write to sheet
    range.setValues(values);
    Logger.log('Batch updated ' + values.length + ' rows to sheet in 1 call.');
    
    for (let r = 0; r < newlyRightRows.length; r++) {
      const rowNum = newlyRightRows[r];
      sheet.getRange(rowNum, 9).setFontWeight('bold').setFontColor('#22c55e');
      sheet.getRange(rowNum, 11).setFontWeight('normal').setFontColor('#94a3b8');
      sheet.getRange(rowNum, 14).setNumberFormat('@');
    }
    for (let e = 0; e < newlyExpiredRows.length; e++) {
      const rowNum = newlyExpiredRows[e];
      sheet.getRange(rowNum, 11).setFontWeight('normal').setFontColor('#94a3b8');
      sheet.getRange(rowNum, 12).setFontColor('#f59e0b');
    }
    
    updateSheetHeartbeat(sheet, 'Checked: ' + checkedCount + ' active | Newly Right: ' + rightCount + ' | Expired: ' + expiredCount);
    Logger.log('checkPredictions completed! Checked: ' + checkedCount + ', Newly Right: ' + rightCount + ', Expired: ' + expiredCount);
  } catch (globalErr) {
    const errStr = (globalErr.message || globalErr).toString();
    Logger.log('CRITICAL: checkPredictions encountered error: ' + errStr);
    
    let userMsg = 'ERROR on last run: ' + errStr;
    if (errStr.includes('Service invoked too many times')) {
      userMsg = 'Google Quota Limit: Daily urlfetch exceeded. Resets automatically at midnight PST.';
    }
    
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        const sheet = ss.getSheetByName(SHEET_NAME);
        if (sheet) {
          updateSheetHeartbeat(sheet, userMsg);
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
 * Bulk-fetches current ticker prices with quota conservation:
 * 1. Queries Binance USDⓈ-M Futures (fapi.binance.com) in 1 single call
 * 2. Only queries Binance Spot if an active coin was not found on Futures
 */
function fetchAllLiveTickers(activeSymbolsSet) {
  const priceMap = new Map();
  const sourceMap = new Map();
  
  // 1. Binance USDⓈ-M Futures (fapi.binance.com)
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
    Logger.log('Binance Futures ticker notice: ' + e);
  }

  // Check if any active symbol is missing from Futures
  let needsSpot = false;
  if (activeSymbolsSet && activeSymbolsSet.size > 0) {
    for (const sym of activeSymbolsSet) {
      if (!priceMap.has(sym)) {
        needsSpot = true;
        break;
      }
    }
  }

  // 2. Binance Vision Spot: ONLY fetched if an active coin is not on Futures!
  if (needsSpot) {
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
      Logger.log('Binance Spot ticker notice: ' + e);
    }
  }
  
  return { prices: priceMap, sources: sourceMap };
}

/**
 * Fetches 5-MINUTE CANDLES with BINANCE FUTURES AS FIRST PRIORITY:
 * Returns immediately upon first successful fetch to conserve quota.
 */
function fetchFiveMinuteCandles(pair, startTime, endTime) {
  const norm = normalizeSymbol(pair);
  const interval = '5m';
  const nowMs = new Date().getTime();
  
  const fetchStart = startTime - 60000;
  let fetchEnd = endTime;
  if (fetchStart >= fetchEnd) {
    fetchEnd = fetchStart + 300000;
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
 * Individual ticker price fetcher with source reporting.
 */
function fetchCurrentPriceWithSource(pair) {
  const norm = normalizeSymbol(pair);
  
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
 * Quick Test & Diagnostic Function
 */
function testConnection() {
  Logger.log('--- Testing Config Sheet & Trigger Sync ---');
  checkTriggerStatus();

  Logger.log('--- Testing Multi-Exchange Live Tickers ---');
  const tickersData = fetchAllLiveTickers(new Set(['BTCUSDT', 'USELESSUSDT']));
  const tickers = tickersData.prices;
  const sources = tickersData.sources;
  Logger.log('Total tickers loaded: ' + tickers.size);
  
  const testSymbols = ['BTCUSDT', 'USELESSUSDT', 'FARTCOINUSDT'];
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
}
