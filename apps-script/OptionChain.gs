// ⚙️ SETUP (ek baar):
// Apps Script editor → ⚙️ Project Settings → Script Properties → ye 2 add karo:
//   DHAN_TOKEN      = Dhan access token
//   DHAN_CLIENT_ID  = Dhan client id
// Token expire ho jaye to sirf wahan value badlo, code chhedne ki zarurat nahi.
//
// Ye functions doosri .gs file me hone chahiye (is file me nahi hain):
// updateHistory, getHistory, getMovementTrend, getDirectionBy100, updateDirection,
// prepareFinalViewRow_Z2H, runEntryExitEngine_Z2H, writeSRSnapshotToFinalView_Z2H

var ss = SpreadsheetApp.getActiveSpreadsheet();

var SCRIP_MAP_Z2H = { "NIFTY": 13, "BANKNIFTY": 25, "FINNIFTY": 27 };
var STEP_MAP_Z2H = { "NIFTY": 50, "BANKNIFTY": 100, "FINNIFTY": 50 };

// UI option chain table = A6:M90
var TABLE_FIRST_ROW_Z2H = 6;
var TABLE_ROWS_Z2H = 85;

// symbol / expiry / din badalne par ye sab reset hote hain
var RUN_STATE_KEYS_Z2H = [
  "PREV_CE", "PREV_PE", "RUN_HISTORY",
  "PREV_DIFF_MARKET", "DIFF_MARKET_HISTORY",
  "MARKET_LAST", "MARKET_START",
  "CE_RESULT_LAST", "CE_RESULT_START"
];

var FINAL_VIEW_HEADERS_AN_Z2H = [
  "MARKET", "DURATION", "TIME",
  "CE OI ", "CE OI RES",
  "CE VOL ", "CE VOL RES",
  "CE FINAL",
  "PE OI ", "PE OI RES",
  "PE VOL ", "PE VOL RES",
  "PE FINAL",
  "RESULT TIME"
];

var FINAL_VIEW_HEADERS_PY_Z2H = [
  "TIME", "MARKET", "SHIFT", "CLUSTER",
  "ΔCE (S)", "ΔPE (D)",
  "CE POWER (S)", "PE POWER (D)",
  "DIFF", "FINAL"
];


function formatNumber(num) {
  if (!num) return 0;
  var abs = Math.abs(num);
  var sign = num < 0 ? "-" : "";
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(2) + "M";
  if (abs >= 1000) return sign + (abs / 1000).toFixed(2) + "K";
  return num;
}


function percent(part, total) {
  if (!total || total == 0) return "0.00%";
  var value = (Math.abs(part || 0) / total) * 100;
  return value.toFixed(2) + "%";
}


// ✅ ab ye bahar hai, isliye trigger me select ho sakta hai
function liveIndicator(status) {

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UI");
  if (!sheet) return;

  var cell = sheet.getRange("C3");

  if (status == "ON") {

    if (cell.getValue() == "🟢 LIVE") {
      cell.setValue("⚪").setBackground("#ffffff").setFontColor("#000000");
    } else {
      cell.setValue("🟢 LIVE").setBackground("#00ff00").setFontColor("#000000");
    }

  } else {
    cell.setValue("🔴 ERROR").setBackground("#ff0000").setFontColor("#ffffff");
  }
}

function blinkRun() {
  liveIndicator("ON");
}


// ✅ TRIGGER ISKO HI LAGAO
function loadOptionChain() {

  // pichhla run abhi chal raha hai to ye run skip (PREV_* data kharab na ho)
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    loadOptionChainCore_();
  } finally {
    lock.releaseLock();
  }
}


function loadOptionChainCore_() {

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("UI");
  if (!sheet) return;

  var tz = Session.getScriptTimeZone();

  var symbol = sheet.getRange("B1").getValue().toString().trim().toUpperCase();
  var expiry = readExpiry_Z2H(sheet.getRange("B2").getValue(), spreadsheet.getSpreadsheetTimeZone());

  var underlyingScrip = SCRIP_MAP_Z2H[symbol];
  if (!underlyingScrip) {
    showError_Z2H(sheet, "❌ SYMBOL GALAT: " + symbol);
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    showError_Z2H(sheet, "❌ EXPIRY YYYY-MM-DD CHAHIYE");
    return;
  }

  // 🔐 TOKEN Script Properties se
  var props = PropertiesService.getScriptProperties();
  var token = (props.getProperty("DHAN_TOKEN") || "").trim();
  var client = (props.getProperty("DHAN_CLIENT_ID") || "").trim();

  if (!token || !client) {
    showError_Z2H(sheet, "❌ TOKEN MISSING");
    return;
  }

  // 🔥 API CALL
  var response = UrlFetchApp.fetch("https://api.dhan.co/v2/optionchain", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      "access-token": token,
      "client-id": client
    },
    payload: JSON.stringify({
      UnderlyingScrip: underlyingScrip,
      UnderlyingSeg: "IDX_I",
      Expiry: expiry
    })
  });

  var code = response.getResponseCode();
  var text = response.getContentText();
  Logger.log(text);

  // ❌ ERROR HANDLE
  if (code !== 200) {
    var tokenError = code == 401 || code == 403 || text.indexOf("DH-901") >= 0;
    showError_Z2H(sheet, tokenError ? "❌ ERROR TOKEN" : "❌ API ERROR " + code);
    throw new Error("API ERROR " + code + ": " + text);
  }

  var json = JSON.parse(text);
  if (!json.data || !json.data.oc) {
    showError_Z2H(sheet, "❌ NO DATA");
    return;
  }

  var oc = json.data.oc;
  var spot = json.data.last_price;

  // "25000.000000" jaisi keys → number
  var keyByStrike = {};
  Object.keys(oc).forEach(function(k) {
    keyByStrike[Number(k)] = k;
  });

  var strikes = Object.keys(keyByStrike).map(Number).sort(function(a, b) {
    return a - b;
  });

  if (!strikes.length || !spot) {
    showError_Z2H(sheet, "❌ NO DATA");
    return;
  }

  // ✅ SUCCESS
  showSuccess_Z2H(sheet, tz);

  // symbol / expiry / naya din → purani state reset
  resetStateIfContextChanged_Z2H(symbol, expiry, tz);

  var atm = strikes.reduce(function(prev, curr) {
    return Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev;
  });

  var step = STEP_MAP_Z2H[symbol] || 50;
  var range = 40 * step;

  var filtered = strikes.filter(function(s) {
    return s >= atm - range && s <= atm + range;
  });

  sheet.getRange("D1:E2").setValues([
    ["SPOT:", spot],
    ["ATM:", atm]
  ]);

  sheet.getRange(5, 1, 1, 13).setValues([[
    "CALL OI", "CALL CHNG OI", "CALL VOL", "CALL IV", "CALL LTP", "CALL CHNG",
    "STRIKE",
    "PUT CHNG", "PUT LTP", "PUT IV", "PUT VOL", "PUT CHNG OI", "PUT OI"
  ]]);

  sheet.getRange("A5:M5")
    .setBackground("#000")
    .setFontColor("#fff")
    .setFontWeight("bold");

  sheet.getRange("A5:M90").setHorizontalAlignment("center");

  // ===== PASS 1: TOTAL + MAX =====

  var maxCallOI = 0, maxPutOI = 0, maxCallVol = 0, maxPutVol = 0, maxCallChg = 0, maxPutChg = 0;
  var totalCallOI = 0, totalPutOI = 0, totalCallVol = 0, totalPutVol = 0;
  var items = [];

  filtered.forEach(function(strike) {
    var row = oc[keyByStrike[strike]];
    if (!row) return;

    var ce = row.ce || {}, pe = row.pe || {};
    var ceChgOI = getOIChange_Z2H(ce);
    var peChgOI = getOIChange_Z2H(pe);

    totalCallOI += ce.oi || 0;
    totalPutOI += pe.oi || 0;
    totalCallVol += ce.volume || 0;
    totalPutVol += pe.volume || 0;

    maxCallOI = Math.max(maxCallOI, ce.oi || 0);
    maxPutOI = Math.max(maxPutOI, pe.oi || 0);
    maxCallVol = Math.max(maxCallVol, ce.volume || 0);
    maxPutVol = Math.max(maxPutVol, pe.volume || 0);

    // negative change bhi gino, warna % 100 se upar chala jaata hai
    maxCallChg = Math.max(maxCallChg, Math.abs(ceChgOI));
    maxPutChg = Math.max(maxPutChg, Math.abs(peChgOI));

    items.push({ strike: strike, ce: ce, pe: pe, ceChgOI: ceChgOI, peChgOI: peChgOI });
  });

  // ===== PASS 2: TABLE + COLOR (sheet par ek hi baar likhna) =====

  var ceOI_data = {};
  var peOI_data = {};
  var ceVol_data = {};
  var peVol_data = {};

  var values = [];
  var backgrounds = [];

  items.slice(0, TABLE_ROWS_Z2H).forEach(function(it) {

    var strike = it.strike, ce = it.ce, pe = it.pe;

    var ceOI_per = (ce.oi || 0) / (maxCallOI || 1) * 100;
    var ceVol_per = (ce.volume || 0) / (maxCallVol || 1) * 100;
    var peOI_per = (pe.oi || 0) / (maxPutOI || 1) * 100;
    var peVol_per = (pe.volume || 0) / (maxPutVol || 1) * 100;

    // 🔥 DATA STORE
    ceOI_data[strike] = ceOI_per;
    peOI_data[strike] = peOI_per;
    ceVol_data[strike] = ceVol_per;
    peVol_data[strike] = peVol_per;

    // 🔥 HISTORY SAVE
    updateHistory("CE_OI_" + strike, ceOI_per);
    updateHistory("PE_OI_" + strike, peOI_per);
    updateHistory("CE_VOL_" + strike, ceVol_per);
    updateHistory("PE_VOL_" + strike, peVol_per);

    values.push([
      percent(ce.oi, maxCallOI) + "\n" + formatNumber(ce.oi),
      percent(it.ceChgOI, maxCallChg) + "\n" + formatNumber(it.ceChgOI),
      percent(ce.volume, maxCallVol) + "\n" + formatNumber(ce.volume),
      ce.implied_volatility || "",
      ce.last_price || "",
      getPriceChange_Z2H(ce),
      strike,
      getPriceChange_Z2H(pe),
      pe.last_price || "",
      pe.implied_volatility || "",
      percent(pe.volume, maxPutVol) + "\n" + formatNumber(pe.volume),
      percent(it.peChgOI, maxPutChg) + "\n" + formatNumber(it.peChgOI),
      percent(pe.oi, maxPutOI) + "\n" + formatNumber(pe.oi)
    ]);

    // BASE COLOR (STRIKE column bhi reset, taaki purana ATM rang na bache)
    var bg = new Array(13).fill("#f3e3c3");
    bg[6] = "#ffffff";

    // ATM
    if (strike == atm) bg = new Array(13).fill("#ffe599");

    // 🔴 CE OI
    if (ceOI_per >= 75) bg[0] = "#fff200";
    if (ceOI_per == 100) bg[0] = "#ff0000";

    // 🟢 PE OI
    if (peOI_per >= 75) bg[12] = "#fff200";
    if (peOI_per == 100) bg[12] = "#00ff00";

    // 🔴 CALL VOLUME
    if (ceVol_per >= 75) bg[2] = "#fff200";
    if (ceVol_per == 100) bg[2] = "#ff0000";

    // 🟢 PUT VOLUME
    if (peVol_per >= 75) bg[10] = "#fff200";
    if (peVol_per == 100) bg[10] = "#00ff00";

    backgrounds.push(bg);
  });

  // bachi hui rows khaali → purana data aur rang saaf
  while (values.length < TABLE_ROWS_Z2H) {
    values.push(new Array(13).fill(""));
    backgrounds.push(new Array(13).fill("#ffffff"));
  }

  var table = sheet.getRange(TABLE_FIRST_ROW_Z2H, 1, TABLE_ROWS_Z2H, 13);
  table.setValues(values);
  table.setBackgrounds(backgrounds);

  // 🔥 TOP PANEL
  sheet.getRange("I1").setValue("CE OI");
  sheet.getRange("K1").setValue("PE OI");
  sheet.getRange("I2").setValue("CE VOL");
  sheet.getRange("K2").setValue("PE VOL");

  updateDirection(sheet, totalCallOI, totalPutOI, totalCallVol, totalPutVol);

  // ===== DELTA CALC =====

  var prevCE = props.getProperty("PREV_CE");
  var prevPE = props.getProperty("PREV_PE");
  var hasPrev = prevCE !== null && prevPE !== null;

  // pehle run me purani value nahi hai → delta 0
  var deltaCE = hasPrev ? totalCallOI - Number(prevCE) : 0;
  var deltaPE = hasPrev ? totalPutOI - Number(prevPE) : 0;

  props.setProperty("PREV_CE", String(totalCallOI));
  props.setProperty("PREV_PE", String(totalPutOI));

  // ===== RUN RESULT =====

  var runResult = "CONFUSION";

  if (deltaPE > deltaCE) runResult = "UP";
  else if (deltaCE > deltaPE) runResult = "DOWN";

  // ===== SHIFT + CLUSTER =====

  var history = hasPrev ? updateRunHistory(runResult) : getRunHistory_Z2H();
  var sc = getShiftCluster(history);

  // ===== DIRECTION =====

  var ceOI_dir = getDirectionBy100(ceOI_data, "CE_OI");
  var peOI_dir = getDirectionBy100(peOI_data, "PE_OI");

  var ceVol_dir = getDirectionBy100(ceVol_data, "CE_VOL");
  var peVol_dir = getDirectionBy100(peVol_data, "PE_VOL");

  var ceFinal = combineDirection(ceOI_dir, ceVol_dir);
  var peFinal = combineDirection(peOI_dir, peVol_dir);

  var market = getMarketPattern(ceFinal, peFinal);

  var diffMarket = getMarketByDiffVoting(totalCallOI - totalPutOI);

  // ✅ headers pakke, phir FINAL_VIEW ki row
  getFinalViewSheet_Z2H();
  var finalViewRow = prepareFinalViewRow_Z2H();

  saveFinalViewUltra({

    market: diffMarket,   // FINAL_VIEW Q me DIFF MARKET

    shift: sc.shift,
    cluster: sc.cluster,

    deltaCE: deltaCE,
    deltaPE: deltaPE,

    cePower: totalCallOI,
    pePower: totalPutOI

  }, finalViewRow);

  var ceOI_text = getStrikeDisplay(ceOI_data, "CE_OI");
  var ceVol_text = getStrikeDisplay(ceVol_data, "CE_VOL");

  var peOI_text = getStrikeDisplay(peOI_data, "PE_OI");
  var peVol_text = getStrikeDisplay(peVol_data, "PE_VOL");

  // 🕒 TIME
  var logTime = Utilities.formatDate(new Date(), tz, "HH:mm:ss");

  // 🔥 MARKET DURATION
  var duration = trackMarketTime(market);

  // 🔥 RESULT TIME (CE)
  var resultTime = trackResultTime("CE_RESULT", ceFinal);

  saveFinalViewPro({

    market: market,
    duration: duration,
    time: logTime,

    ceOI_text: ceOI_text,
    ceOI_dir: ceOI_dir,

    ceVol_text: ceVol_text,
    ceVol_dir: ceVol_dir,

    ceFinal: ceFinal,
    resultTime: resultTime,

    peFinal: peFinal,

    peOI_text: peOI_text,
    peOI_dir: peOI_dir,

    peVol_text: peVol_text,
    peVol_dir: peVol_dir

  }, finalViewRow);

  // ✅ Z2H ENTRY EXIT ENGINE
  runEntryExitEngine_Z2H({
    spot: spot,
    aMarket: market,
    qMarket: diffMarket,
    ceFinal: ceFinal,
    peFinal: peFinal
  }, finalViewRow);

  // ✅ SAME FINAL_VIEW ROW ME LATEST S&R STORE
  writeSRSnapshotToFinalView_Z2H(finalViewRow);

  // 📊 UI Output
  sheet.getRange("N2:P2").setValues([[
    "CE: " + ceFinal,
    "PE: " + peFinal,
    "MARKET: " + market
  ]]);

  showActiveRange_OR();

  // ✅ purani rows sabse END me delete, taaki upar ke saare writes sahi row par jaayein
  trimFinalView_Z2H();
}


// date cell ho ya text, Dhan ko YYYY-MM-DD hi jaana chahiye
function readExpiry_Z2H(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz, "yyyy-MM-dd");
  return String(value || "").trim();
}


// Dhan v2 me "oi_change" nahi aata to oi - previous_oi
function getOIChange_Z2H(o) {
  if (typeof o.oi_change === "number") return o.oi_change;
  if (typeof o.previous_oi === "number") return (o.oi || 0) - o.previous_oi;
  return 0;
}


// Dhan v2 me "change" nahi aata to last_price - previous_close_price
function getPriceChange_Z2H(o) {
  if (typeof o.change === "number") return o.change;
  if (o.last_price && o.previous_close_price) {
    return Math.round((o.last_price - o.previous_close_price) * 100) / 100;
  }
  return "";
}


function showError_Z2H(sheet, msg) {
  sheet.getRange("A3").setValue("").setBackground(null).setFontColor(null);
  sheet.getRange("A4").setValue(msg).setBackground("#ff0000").setFontColor("#ffffff");
  liveIndicator("ERROR");
}


function showSuccess_Z2H(sheet, tz) {
  liveIndicator("ON");

  sheet.getRange("A3").setValue("✅ DATA RECEIVED").setBackground("#00ff00").setFontColor("#000000");

  // purana error message hatao
  sheet.getRange("A4").setValue("").setBackground(null).setFontColor(null);

  sheet.getRange("G3").setValue(Utilities.formatDate(new Date(), tz, "HH:mm:ss"));
}


function resetStateIfContextChanged_Z2H(symbol, expiry, tz) {

  var props = PropertiesService.getScriptProperties();

  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var context = symbol + "|" + expiry + "|" + today;

  if (props.getProperty("RUN_CONTEXT") === context) return false;

  RUN_STATE_KEYS_Z2H.forEach(function(k) {
    props.deleteProperty(k);
  });

  props.setProperty("RUN_CONTEXT", context);
  return true;
}


function combineDirection(oiDir, volDir) {


  if (oiDir == "UP" && volDir == "UP") return "UP";
  if (oiDir == "DOWN" && volDir == "DOWN") return "DOWN";


  if (oiDir == "CONFUSION") return volDir;
  if (volDir == "CONFUSION") return oiDir;


  return "CONFUSION";
}

function getMarketPattern(ceDir, peDir) {

  // ✅ STRONG BUY
  if (ceDir == "UP" && peDir == "UP") {
    return "STRONG BUY";
  }

  // ✅ STRONG SELL
  if (ceDir == "DOWN" && peDir == "DOWN") {
    return "STRONG SELL";
  }

  // ✅ RANGE
  if (ceDir == "UP" && peDir == "DOWN") {
    return "RANGE";
  }

  if (ceDir == "DOWN" && peDir == "UP") {
    return "RANGE";
  }

  // ✅ AAPKA MISSING CASE 1
  if (ceDir == "CONFUSION" && peDir == "UP") {
    return "BUY";
  }

  // ✅ AAPKA MISSING CASE 2
  if (ceDir == "DOWN" && peDir == "CONFUSION") {
    return "SELL";
  }

  // ✅ baaki single BUY case
  if (ceDir == "UP" && peDir == "CONFUSION") {
    return "BUY";
  }

  // ✅ baaki single SELL case
  if (ceDir == "CONFUSION" && peDir == "DOWN") {
    return "SELL";
  }

  // ✅ dono confusion
  if (ceDir == "CONFUSION" && peDir == "CONFUSION") {
    return "NO TRADE";
  }

  return "NO TRADE";
}


// ✅ WEB APP ENTRY POINT
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index');
}
// 📈 OPTION DATA FUNCTION
function getOptionChainClean() {


  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UI");


  var data = sheet.getRange("A6:M90").getDisplayValues();


  var result = [];


  data.forEach(function(r) {


    result.push({
      ceoi: r[0],
      cechg: r[1],
      cevol: r[2],
      ceiv: r[3],
      celtp: r[4],
      cechg2: r[5],


      strike: r[6],


      pechg2: r[7],
      peltp: r[8],
      peiv: r[9],
      pevol: r[10],
      pechg: r[11],
      peoi: r[12]
    });


  });


  return result;
}


// ✅ FINAL_VIEW sheet + dono header (A:N aur P:Y) pakke
var FINAL_VIEW_SHEET_Z2H = null;

function getFinalViewSheet_Z2H() {

  if (FINAL_VIEW_SHEET_Z2H) return FINAL_VIEW_SHEET_Z2H;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("FINAL_VIEW") || spreadsheet.insertSheet("FINAL_VIEW");

  var header = sheet.getRange("A1:Y1").getDisplayValues()[0];

  if (!header[0]) sheet.getRange("A1:N1").setValues([FINAL_VIEW_HEADERS_AN_Z2H]);
  if (!header[15]) sheet.getRange("P1:Y1").setValues([FINAL_VIEW_HEADERS_PY_Z2H]);

  FINAL_VIEW_SHEET_Z2H = sheet;
  return sheet;
}


// 1000 se zyada rows → upar ki purani rows delete (run ke END me hi call karna)
function trimFinalView_Z2H() {

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FINAL_VIEW");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow > 1000) {
    sheet.deleteRows(2, lastRow - 1000);
  }
}


function saveFinalViewPro(data, row) {

  var sheet = getFinalViewSheet_Z2H();

  sheet.getRange(row, 1, 1, 14).setValues([[

    data.market,
    data.duration,
    data.time,

    data.ceOI_text,
    data.ceOI_dir,

    data.ceVol_text,
    data.ceVol_dir,

    data.ceFinal,

    data.peOI_text,
    data.peOI_dir,

    data.peVol_text,
    data.peVol_dir,

    data.peFinal,

    data.resultTime
  ]]);

  // wrap enable
  sheet.getRange(row, 4, 1, 10).setWrap(true);

  var bg = new Array(14).fill("#ffffff");
  var font = new Array(14).fill("#000000");

  // 🎨 UP/BUY green, DOWN/SELL red, baaki yellow
  function setColor(i, value) {

    value = String(value == null ? "" : value);

    if (value.includes("UP") || value.includes("BUY")) {
      bg[i] = "#00ff00";
      font[i] = "#000000";
    }
    else if (value.includes("DOWN") || value.includes("SELL")) {
      bg[i] = "#ff0000";
      font[i] = "#ffffff";
    }
    else {
      bg[i] = "#fff200";
      font[i] = "#000000";
    }
  }

  // 🎨 STRIKE COLOR
  function colorStrike(i, text) {

    text = String(text == null ? "" : text);

    if (text.includes("↑")) bg[i] = "#ccffcc";
    else if (text.includes("↓")) bg[i] = "#ffcccc";
    else bg[i] = "#fff9cc";
  }

  setColor(0, data.market);        // MARKET
  colorStrike(3, data.ceOI_text);  // CE OI
  setColor(4, data.ceOI_dir);      // CE OI RESULT
  colorStrike(5, data.ceVol_text); // CE VOL
  setColor(6, data.ceVol_dir);     // CE VOL RESULT
  setColor(7, data.ceFinal);       // CE FINAL
  colorStrike(8, data.peOI_text);  // PE OI
  setColor(9, data.peOI_dir);      // PE OI RESULT
  colorStrike(10, data.peVol_text);// PE VOL
  setColor(11, data.peVol_dir);    // PE VOL RESULT
  setColor(12, data.peFinal);      // PE FINAL

  // APPLY (single call)
  sheet.getRange(row, 1, 1, 14).setBackgrounds([bg]).setFontColors([font]);
}


function trackStateTime_Z2H(key, value) {

  var props = PropertiesService.getScriptProperties();

  var prev = props.getProperty(key + "_LAST");
  var start = Number(props.getProperty(key + "_START"));
  var now = Date.now();

  // pehli baar (ya purana HH:mm:ss format pada ho)
  if (prev === null || !start) {
    props.setProperty(key + "_LAST", value);
    props.setProperty(key + "_START", String(now));
    return "START";
  }

  // same chal raha hai
  if (prev == value) {
    return formatDuration_Z2H(now - start);
  }

  // change hua
  props.setProperty(key + "_LAST", value);
  props.setProperty(key + "_START", String(now));

  return "CHANGED";
}


function trackResultTime(key, value) {
  return trackStateTime_Z2H(key, value);
}


function trackMarketTime(market) {
  return trackStateTime_Z2H("MARKET", market);
}


function formatDuration_Z2H(ms) {

  var diff = Math.max(0, Math.floor(ms / 1000));

  var min = Math.floor(diff / 60);
  var sec = diff % 60;

  return min + "m " + sec + "s";
}


function getTimeDiff(start, end) {


  if (!start || !end) return "0s";


  var s = start.split(":");
  var e = end.split(":");


  var startSec = (+s[0]) * 3600 + (+s[1]) * 60 + (+s[2]);
  var endSec = (+e[0]) * 3600 + (+e[1]) * 60 + (+e[2]);


  var diff = endSec - startSec;


  if (diff < 0) diff = 0;


  var min = Math.floor(diff / 60);
  var sec = diff % 60;


  return min + "m " + sec + "s";
}
function getStrikeDisplay(data, type) {


  var list = [];
  var temp = [];


  for (var strike in data) {


    var val = data[strike];


    // ❌ 100% skip
    if (val < 75 || val >= 100) continue;


    var history = getHistory(type + "_" + strike);
    var move = getMovementTrend(history);


    var arrow = "=";
    if (move == "UP") arrow = "↑";
    if (move == "DOWN") arrow = "↓";


    temp.push({
      strike: strike,
      val: val,
      text: strike + " (" + val.toFixed(2) + "% " + arrow + ")"
    });
  }


  // sort high to low
  temp.sort(function(a, b) {
    return b.val - a.val;
  });


  temp.forEach(function(item) {
    list.push(item.text);
  });


  return list.join("\n");
}
function extractNumber(val) {
  if (!val) return 0;
  return parseFloat(val.toString().replace(/[^0-9.]/g, "")) || 0;
}


function parsePercentFromCellZ2H(v) {
  if (v === null || v === undefined || v === "") return 0;

  if (typeof v === "number") return v;

  var s = v.toString().trim();

  // agar cell me "75.20%\n12.5K" hai to sirf 75.20 lega
  var firstLine = s.split("\n")[0];
  firstLine = firstLine.replace("%", "").replace(/,/g, "").trim();

  var n = Number(firstLine);
  return isNaN(n) ? 0 : n;
}


function parseNumberZ2H(v) {
  if (v === null || v === undefined || v === "") return 0;

  if (typeof v === "number") return v;

  var s = v.toString().trim().replace(/,/g, "");

  if (s.endsWith("M")) return Number(s.replace("M", "")) * 1000000;
  if (s.endsWith("K")) return Number(s.replace("K", "")) * 1000;
  if (s.endsWith("%")) return Number(s.replace("%", ""));

  var n = Number(s);
  return isNaN(n) ? 0 : n;
}


function showActiveRange_OR() {

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("UI");

  if (!sheet) return;

  // ✅ purana gamma O:R clean
  sheet.getRange("O5:R100").clearContent().clearFormat();

  var spot = parseNumberZ2H(sheet.getRange("E1").getValue());
  var symbol = sheet.getRange("B1").getValue().toString().trim().toUpperCase();

  if (!spot) {
    sheet.getRange("O5:R5").setValues([[
      "SPOT NOT FOUND", "", "", ""
    ]]);
    sheet.getRange("O5:R5")
      .setBackground("#ff0000")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    return;
  }

  // ✅ loadOptionChain wala hi step aur ATM (E2)
  var step = STEP_MAP_Z2H[symbol] || (symbol.includes("BANK") ? 100 : 50);
  var atm = parseNumberZ2H(sheet.getRange("E2").getValue()) || Math.round(spot / step) * step;

  // UI option chain data A6:M90
  var data = sheet.getRange("A6:M90").getDisplayValues();

  var rows = [];

  for (var i = 0; i < data.length; i++) {

    var r = data[i];

    var strike = parseNumberZ2H(r[6]); // G = STRIKE
    if (!strike) continue;

    rows.push({
      strike: strike,

      // A = CALL OI
      ceOI: parsePercentFromCellZ2H(r[0]),

      // C = CALL VOL
      ceVol: parsePercentFromCellZ2H(r[2]),

      // E = CALL LTP
      ceLtp: parseNumberZ2H(r[4]),

      // I = PUT LTP
      peLtp: parseNumberZ2H(r[8]),

      // K = PUT VOL
      peVol: parsePercentFromCellZ2H(r[10]),

      // M = PUT OI
      peOI: parsePercentFromCellZ2H(r[12])
    });
  }

  if (rows.length < 3) {
    sheet.getRange("O5:R5").setValues([[
      "NOT ENOUGH DATA", "", "", ""
    ]]);
    sheet.getRange("O5:R5")
      .setBackground("#ff0000")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    return;
  }

  rows.sort(function(a, b) {
    return a.strike - b.strike;
  });

  // ✅ ATM / current active strike index
  var centerIndex = 0;
  var minDiff = Math.abs(rows[0].strike - atm);

  for (var j = 1; j < rows.length; j++) {
    var diff = Math.abs(rows[j].strike - atm);
    if (diff < minDiff) {
      minDiff = diff;
      centerIndex = j;
    }
  }

  // ✅ 6 strike niche + center + 6 strike upar
  var startIndex = Math.max(1, centerIndex - 6);
  var endIndex = Math.min(rows.length - 2, centerIndex + 6);

  var output = [];

  output.push([
    "STRIKE",
    "ACTIVE LOW",
    "ACTIVE HIGH",
    "STATUS"
  ]);

  for (var k = startIndex; k <= endIndex; k++) {

    var prev = rows[k - 1];
    var cur = rows[k];
    var next = rows[k + 1];

    var baseLow = (prev.strike + cur.strike) / 2;
    var baseHigh = (cur.strike + next.strike) / 2;

    var cePower = cur.ceOI + cur.ceVol;
    var pePower = cur.peOI + cur.peVol;
    var totalPower = cePower + pePower;

    var score = 0;
    if (totalPower > 0) {
      score = ((pePower - cePower) / totalPower) * 100;
    }

    var premiumBias = cur.ceLtp - cur.peLtp;

    var shift = 0;

    // PE strong = support strong = range upar shift
    if (score > 15) shift += 8;

    // CE strong = resistance strong = range niche shift
    if (score < -15) shift -= 8;

    // premium bias
    if (premiumBias > 0) shift += 4;
    if (premiumBias < 0) shift -= 4;

    var activeLow = Math.round(baseLow + shift);
    var activeHigh = Math.round(baseHigh + shift);

    var status = "WAIT";

    if (spot >= activeLow && spot <= activeHigh) {
      status = "ACTIVE";
    } else if (spot > activeHigh) {
      status = "ABOVE";
    } else if (spot < activeLow) {
      status = "BELOW";
    }

    output.push([
      cur.strike,
      activeLow,
      activeHigh,
      status
    ]);
  }

  // ✅ O:R me output
  sheet.getRange(5, 15, output.length, 4).setValues(output);

  // ✅ header color
  sheet.getRange("O5:R5")
    .setBackground("#000000")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // ✅ body format
  var body = sheet.getRange(6, 15, output.length - 1, 4);

  body
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setFontWeight("bold");

  // ✅ row color by status (single call)
  var bgs = [];
  var fonts = [];

  for (var x = 1; x < output.length; x++) {

    var statusValue = output[x][3];
    var bg = "#ffffff", font = "#000000";

    if (statusValue == "ACTIVE") bg = "#00ff00";
    else if (statusValue == "ABOVE") bg = "#fff200";
    else if (statusValue == "BELOW") {
      bg = "#ff0000";
      font = "#ffffff";
    }

    bgs.push([bg, bg, bg, bg]);
    fonts.push([font, font, font, font]);
  }

  body.setBackgrounds(bgs).setFontColors(fonts);

  // ✅ border
  sheet.getRange(5, 15, output.length, 4)
    .setBorder(true, true, true, true, true, true);

  sheet.autoResizeColumns(15, 4);
}

// ================= SHIFT + CLUSTER ENGINE =================

function updateRunHistory(value) {
  var props = PropertiesService.getScriptProperties();
  var arr = JSON.parse(props.getProperty("RUN_HISTORY") || "[]");

  arr.push(value);
  if (arr.length > 8) arr.shift(); // max 8 runs

  props.setProperty("RUN_HISTORY", JSON.stringify(arr));

  return arr;
}

function getRunHistory_Z2H() {
  var props = PropertiesService.getScriptProperties();
  return JSON.parse(props.getProperty("RUN_HISTORY") || "[]");
}

function getShiftCluster(arr) {

  if (arr.length < 8) {
    return { shift: "WAIT", cluster: "WEAK" };
  }

  var up = 0, down = 0;
  var streak = 1, maxStreak = 1;

  for (var i = 0; i < arr.length; i++) {
    if (arr[i] == "UP") up++;
    if (arr[i] == "DOWN") down++;

    // sirf UP/DOWN ki streak gino, CONFUSION ki nahi
    if (i > 0 && arr[i] == arr[i - 1] && arr[i] != "CONFUSION") {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 1;
    }
  }

  var shift = "CONFUSION";
  if (up >= 5) shift = "UP";
  else if (down >= 5) shift = "DOWN";

  var cluster = (maxStreak >= 3) ? "STRONG" : "WEAK";

  return { shift: shift, cluster: cluster };
}
function saveFinalViewUltra(data, row) {

  var sheet = getFinalViewSheet_Z2H();

  var diff = (data.cePower || 0) - (data.pePower || 0);

  var final = "RANGE";
  if (diff > 0) final = "SELL";
  if (diff < 0) final = "BUY";

  var time = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "HH:mm:ss"
  );


// ===== VALUES WRITE =====
sheet.getRange(row, 16, 1, 10).setValues([[
  time,
  data.market,
  data.shift,
  data.cluster,
  formatNumberShort(data.deltaCE),
  formatNumberShort(data.deltaPE),
  formatNumberShort(data.cePower),
  formatNumberShort(data.pePower),
  formatNumberShort(diff),
  final
]]);

// ===== COLOR LOGIC =====
var rowColors = new Array(10).fill("#ffffff");

// ΔCE
rowColors[4] = (data.deltaCE >= 0) ? "#d4edda" : "#f8d7da";

// ΔPE
rowColors[5] = (data.deltaPE >= 0) ? "#d4edda" : "#f8d7da";

// DIFF
rowColors[8] = (diff >= 0) ? "#f8d7da" : "#d4edda";

// FINAL
if (final == "BUY") rowColors[9] = "#00ff00";
else if (final == "SELL") rowColors[9] = "#ff0000";
else rowColors[9] = "#cccccc";

// APPLY (single call)
sheet.getRange(row, 16, 1, 10).setBackgrounds([rowColors]);

}

function formatNumberShort(num) {
  if (!num) return "0";

  var arrow = "";
  if (num > 0) arrow = " ↑";
  else if (num < 0) arrow = " ↓";

  var abs = Math.abs(num);
  var value = "";

  if (abs >= 1000000) value = (abs / 1000000).toFixed(2) + "M";
  else if (abs >= 1000) value = (abs / 1000).toFixed(2) + "K";
  else value = abs.toString();

  var sign = num > 0 ? "+" : num < 0 ? "-" : "";

  return sign + value + arrow;
}



function getMarketByDiffVoting(diff) {

  var props = PropertiesService.getScriptProperties();

  var prevStr = props.getProperty("PREV_DIFF_MARKET");
  var prevDiff = Number(prevStr);

  var signal = "SKIP";

  // diff = CE - PE  → CE ka gap badha = DOWN, PE ka gap badha = UP
  // sign palta (CE aage → PE aage) to bhi sahi direction
  if (prevStr !== null && diff !== prevDiff) {

    if (diff > 0) {
      signal = (prevDiff < 0 || diff > prevDiff) ? "DOWN" : "UP";
    }
    else if (diff < 0) {
      signal = (prevDiff > 0 || diff < prevDiff) ? "UP" : "DOWN";
    }
  }

  props.setProperty("PREV_DIFF_MARKET", String(diff));

  var arr = JSON.parse(props.getProperty("DIFF_MARKET_HISTORY") || "[]");

  // SKIP wale run me bhi purani voting ka result dikhana hai
  if (signal != "SKIP") {
    arr.push(signal);
    if (arr.length > 8) arr.shift();
    props.setProperty("DIFF_MARKET_HISTORY", JSON.stringify(arr));
  }

  var up = 0;
  var down = 0;

  arr.forEach(function(x) {
    if (x == "UP") up++;
    if (x == "DOWN") down++;
  });

  if (up >= 5) return "UP";
  if (down >= 5) return "DOWN";

  return "RANGE";
}
