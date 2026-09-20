/**
 * Google Apps Script for Crypto Radar Price Predictions
 * 
 * 1. Automatically formats Google Sheet with the required columns
 * 2. Receives new predictions via Web App Webhook (doPost)
 * 3. Runs 15-minute automated checks (checkPredictions) querying Binance APIs
 *    to update Highest Price, Lowest Price, and mark status as Right/Wrong.
 */

const SHEET_NAME = 'Predictions';

const HEADERS = [
  'Coin Symbol',
  'Logged Time',
  'Current Price',
  'Predicted Price',
  'Change %',
  'Highest Price',
  'Lowest Price',
  'Last Checked At',
  'Status',
  'Right At'
];

/**
 * 1. Initial Setup: Creates and styles the sheet headers
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
  sheet.setColumnWidth(1, 120); // Symbol
  sheet.setColumnWidth(2, 170); // Logged Time
  sheet.setColumnWidth(3, 130); // Current Price
  sheet.setColumnWidth(4, 130); // Predicted Price
  sheet.setColumnWidth(5, 110); // Change %
  sheet.setColumnWidth(6, 130); // Highest Price
  sheet.setColumnWidth(7, 130); // Lowest Price
  sheet.setColumnWidth(8, 170); // Last Checked At
  sheet.setColumnWidth(9, 100); // Status
  sheet.setColumnWidth(10, 170); // Right At
  
  Logger.log('Sheet initialized successfully with headers!');
}

/**
 * 2. Setup Automated 15-Minute Cloud Trigger
 * Run this function once to start automated checks every 15 minutes!
 */
function createFifteenMinuteTrigger() {
  // Delete existing check triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkPredictions') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Create new 15-minute trigger
  ScriptApp.newTrigger('checkPredictions')
    .timeBased()
    .everyMinutes(15)
    .create();
    
  Logger.log('15-minute automated prediction check trigger successfully created!');
}

// Backward-compatibility alias so running createTwoHourTrigger also sets 15 minutes
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
      rightAt
    ]);
    
    // Format the new row
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 9).setFontWeight('bold').setFontColor('#ef4444'); // Red text for Wrong
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
          rightAt: row[9]
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
 * 5. Automated 15-Minute Checker
 * Iterates through all predictions where status == 'Wrong', fetches Binance candles and current price,
 * updates highest/lowest, and sets status to 'Right' if price hit or exceeded predicted price.
 */
function checkPredictions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // Only headers
  
  const range = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  const values = range.getValues();
  const now = new Date();
  const nowFormatted = Utilities.formatDate(now, 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowIndex = i + 2;
    const status = String(row[8] || '').trim();
    
    // Only check rows that are currently 'Wrong'
    if (status !== 'Wrong') continue;
    
    const symbol = String(row[0] || '').trim().toUpperCase();
    const startMs = parseTimestamp(row[1], now.getTime() - 24 * 3600 * 1000);
    const endMs = now.getTime();
    
    const entryPrice = parseNum(row[2]);
    const predictedPrice = parseNum(row[3]);
    let currentHigh = parseNum(row[5]);
    let currentLow = parseNum(row[6]);
    
    if (currentHigh <= 0) currentHigh = entryPrice;
    if (currentLow <= 0) currentLow = entryPrice;
    
    let pair = symbol;
    if (!pair.endsWith('USDT') && !pair.endsWith('USD')) pair = pair + 'USDT';
    if (pair === 'SATSUSDT') pair = '1000SATSUSDT';
    if (pair === 'BEAMUSDT') pair = 'BEAMXUSDT';
    if (pair === 'FTMUSDT') pair = 'SUSDT';
    if (pair === 'MKRUSDT') pair = 'SKYUSDT';
    if (pair === 'KLAYUSDT') pair = 'KAIAUSDT';
    
    let isRight = false;
    let rightTimestamp = '';
    
    // 1. Check real-time live ticker price
    const livePrice = fetchCurrentPrice(pair);
    if (livePrice > 0) {
      if (livePrice > currentHigh) currentHigh = livePrice;
      if (currentLow === 0 || livePrice < currentLow) currentLow = livePrice;
      if (predictedPrice > 0 && livePrice >= predictedPrice) {
        isRight = true;
        rightTimestamp = nowFormatted;
      }
    }
    
    // 2. Fetch candle history (1m/5m/15m) from logged time to now
    const candles = fetchBinanceCandles(symbol, startMs, endMs);
    if (candles && candles.length > 0) {
      for (let c = 0; c < candles.length; c++) {
        const candle = candles[c];
        const cOpenTime = candle[0];
        const cHigh = parseFloat(candle[2]);
        const cLow = parseFloat(candle[3]);
        
        if (cHigh > currentHigh) currentHigh = cHigh;
        if (currentLow === 0 || cLow < currentLow) currentLow = cLow;
        
        // Bullish check: Did price reach or exceed predicted price?
        if (predictedPrice > 0 && cHigh >= predictedPrice && !isRight) {
          isRight = true;
          rightTimestamp = Utilities.formatDate(new Date(cOpenTime), 'GMT+5:30', 'yyyy-MM-dd HH:mm:ss') + ' IST';
        }
      }
    }
    
    // Update Highest Price (Col 6)
    sheet.getRange(rowIndex, 6).setValue(currentHigh);
    // Update Lowest Price (Col 7)
    sheet.getRange(rowIndex, 7).setValue(currentLow);
    // Update Last Checked At (Col 8)
    sheet.getRange(rowIndex, 8).setValue(nowFormatted);
    
    if (isRight) {
      // Status -> 'Right' (Col 9)
      const statusCell = sheet.getRange(rowIndex, 9);
      statusCell.setValue('Right');
      statusCell.setFontColor('#22c55e'); // Vibrant green
      statusCell.setFontWeight('bold');
      
      // Right At (Col 10)
      sheet.getRange(rowIndex, 10).setValue(rightTimestamp || nowFormatted);
    }
    
    // Small pause to avoid hitting rate limits
    Utilities.sleep(150);
  }
}

/**
 * Helper: Safely parses numbers from cells that may contain currency symbols or commas
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
 * Helper: Fetches live ticker price from Binance Spot or Futures
 */
function fetchCurrentPrice(pair) {
  try {
    const res = UrlFetchApp.fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + encodeURIComponent(pair), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      if (data && data.price) return parseFloat(data.price) || 0;
    }
  } catch (_) {}
  try {
    const fRes = UrlFetchApp.fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=' + encodeURIComponent(pair), { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fData = JSON.parse(fRes.getContentText());
      if (fData && fData.price) return parseFloat(fData.price) || 0;
    }
  } catch (_) {}
  return 0;
}

/**
 * Helper: Fetches candles from Binance Spot with fallback to Binance Futures
 */
function fetchBinanceCandles(rawSymbol, startTime, endTime) {
  let pair = rawSymbol;
  if (!pair.endsWith('USDT') && !pair.endsWith('USD')) {
    pair = pair + 'USDT';
  }
  
  // Special mappings
  if (pair === 'SATSUSDT') pair = '1000SATSUSDT';
  if (pair === 'BEAMUSDT') pair = 'BEAMXUSDT';
  if (pair === 'FTMUSDT') pair = 'SUSDT';
  if (pair === 'MKRUSDT') pair = 'SKYUSDT';
  if (pair === 'KLAYUSDT') pair = 'KAIAUSDT';
  
  // Choose interval: 1m for recent windows (<16h), 5m for 16-80h, 15m for >80h
  let interval = '1m';
  const diffHours = (endTime - startTime) / (1000 * 60 * 60);
  if (diffHours > 16 && diffHours <= 80) {
    interval = '5m';
  } else if (diffHours > 80) {
    interval = '15m';
  }
  
  // Subtract 1 minute to ensure the candle containing the exact logged second is included
  const fetchStart = startTime - 60000;
  
  // 1. Try Binance Spot
  try {
    const spotUrl = 'https://api.binance.com/api/v3/klines?symbol=' + encodeURIComponent(pair) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + endTime + '&limit=1000';
    const spotRes = UrlFetchApp.fetch(spotUrl, { muteHttpExceptions: true });
    if (spotRes.getResponseCode() === 200) {
      const data = JSON.parse(spotRes.getContentText());
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e) {
    Logger.log('Spot fetch error for ' + pair + ': ' + e);
  }
  
  // 2. Fallback to Binance Futures (for XMR, HYPE, KAS, etc.)
  try {
    const fUrl = 'https://fapi.binance.com/fapi/v1/klines?symbol=' + encodeURIComponent(pair) +
      '&interval=' + interval + '&startTime=' + fetchStart + '&endTime=' + endTime + '&limit=1000';
    const fRes = UrlFetchApp.fetch(fUrl, { muteHttpExceptions: true });
    if (fRes.getResponseCode() === 200) {
      const fData = JSON.parse(fRes.getContentText());
      if (Array.isArray(fData) && fData.length > 0) {
        return fData;
      }
    }
  } catch (e) {
    Logger.log('Futures fetch error for ' + pair + ': ' + e);
  }
  
  return [];
}
