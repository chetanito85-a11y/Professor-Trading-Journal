// =====================================================
// ⚡ Z2H OPTION CHAIN — READY TO RUN
//
// 1) Sheet → Extensions → Apps Script → Code.gs me ye poora code paste → Save
// 2) Sheet reload karo → upar menu "⚡ Z2H" → "🚀 Setup (1 click)"
//    Pehli baar Google permission maangega:
//    Continue → account chuno → Advanced → Go to … (unsafe) → Allow
//    phir menu se Setup dobara dabao
// 3) Client ID, Token, S&R URL paste karo. Baaki sab apne aap:
//    sheets, symbol dropdown, nearest expiry, har minute ka trigger, pehla run
//
// Roz token badle to: ⚡ Z2H → 🔑 Token update
// Auto run sirf market time (Mon–Fri 09:15–15:30 IST) me chalta hai.
// =====================================================

var TZ_Z2H = "Asia/Kolkata";
var MARKET_START_Z2H = "09:15";
var MARKET_END_Z2H = "15:30";

var Z2H_TRIGGER_FUNCTIONS = ["loadOptionChain", "fetchSRToUI_Z2H"];


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ Z2H")
    .addItem("🚀 Setup (1 click)", "setupZ2H")
    .addItem("▶️ Abhi chalao", "runNowZ2H")
    .addItem("🔑 Token update", "updateTokenZ2H")
    .addItem("📅 Expiry refresh", "refreshExpiryMenuZ2H")
    .addSeparator()
    .addItem("♻️ Position reset", "resetPositionZ2H")
    .addItem("⏹️ Auto run band karo", "stopZ2H")
    .addToUi();
}


// 🚀 SETUP: token save → sheets → expiry → triggers → pehla run
function setupZ2H() {

  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var client = askValue_Z2H(ui, "1/3  Dhan Client ID", props.getProperty("DHAN_CLIENT_ID"));
  if (client === null) return;

  var token = askValue_Z2H(ui, "2/3  Dhan Access Token", props.getProperty("DHAN_TOKEN"));
  if (token === null) return;

  var srUrl = askValue_Z2H(ui, "3/3  S&R API URL (/exec) — nahi hai to khaali chhodo", props.getProperty("SR_API_URL"));
  if (srUrl === null) return;

  if (client) props.setProperty("DHAN_CLIENT_ID", client);
  if (token) props.setProperty("DHAN_TOKEN", token);
  if (srUrl) props.setProperty("SR_API_URL", srUrl);

  client = props.getProperty("DHAN_CLIENT_ID");
  token = props.getProperty("DHAN_TOKEN");
  srUrl = props.getProperty("SR_API_URL");

  if (!client || !token) {
    ui.alert("❌ Client ID aur Token dono chahiye. Setup dobara chalao.");
    return;
  }

  var setup = ensureSheets_Z2H();

  // token check + nearest expiry
  var r = refreshExpiry_Z2H(setup.ui, setup.symbol, token, client);

  if (!r.expiry) {
    ui.alert(r.tokenError
      ? "❌ Token / Client ID galat ya expire hai.\nDhan se naya token lo aur Setup dobara chalao."
      : "❌ Dhan se expiry list nahi mili (code " + r.code + "). Thodi der baad Setup dobara chalao.");
    return;
  }

  installTriggers_Z2H(!!srUrl);

  // Dhan: 3 sec me 1 request
  Utilities.sleep(3000);

  var result = runOnce_Z2H();

  ui.alert(
    "✅ Setup ho gaya\n\n" +
    "Symbol: " + setup.symbol + "\n" +
    "Expiry: " + r.expiry + "\n" +
    "Auto run: har 1 minute (Mon–Fri " + MARKET_START_Z2H + "–" + MARKET_END_Z2H + ")\n" +
    "S&R: " + (srUrl ? "chalu" : "URL nahi diya, band") + "\n\n" +
    "Pehla run: " + result
  );
}


// 🔑 roz ka naya token
function updateTokenZ2H() {

  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var token = askValue_Z2H(ui, "🔑 Naya Dhan Access Token", null);
  if (!token) return;

  props.setProperty("DHAN_TOKEN", token);

  var symbol = ensureSheets_Z2H().symbol;
  var r = fetchExpiryList_Z2H(symbol, token, props.getProperty("DHAN_CLIENT_ID") || "");

  if (r.list) ui.alert("✅ Token save ho gaya aur sahi hai.");
  else if (r.tokenError) ui.alert("❌ Token save hua, par Dhan ne mana kiya (galat / expire).");
  else ui.alert("⚠️ Token save hua, par check nahi ho paya (code " + r.code + ").");
}


// 📅 B2 me nearest expiry + dropdown
function refreshExpiryMenuZ2H() {

  var props = PropertiesService.getScriptProperties();
  var setup = ensureSheets_Z2H();

  var r = refreshExpiry_Z2H(
    setup.ui,
    setup.symbol,
    props.getProperty("DHAN_TOKEN") || "",
    props.getProperty("DHAN_CLIENT_ID") || ""
  );

  SpreadsheetApp.getActiveSpreadsheet().toast(
    r.expiry ? "Expiry: " + r.expiry : (r.tokenError ? "❌ Token galat / expire" : "❌ Expiry list nahi mili"),
    "⚡ Z2H", 6
  );
}


// ▶️ market time ho ya na ho, abhi ek baar chalao
function runNowZ2H() {
  SpreadsheetApp.getActiveSpreadsheet().toast(runOnce_Z2H(), "⚡ Z2H", 8);
}


function runOnce_Z2H() {

  var props = PropertiesService.getScriptProperties();
  var crash = "";

  try {
    if (props.getProperty("SR_API_URL")) fetchSRToUI_Z2H();
    loadOptionChain();
  } catch (err) {
    crash = "❌ " + String(err.message || err).slice(0, 150);
  }

  // UI!A4 wala saaf message pehle
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UI");
  var error = (sheet ? sheet.getRange("A4").getDisplayValue() : "") || crash;

  if (error.indexOf("TOKEN") >= 0) error += "\n⚡ Z2H → 🔑 Token update karo";

  return error || "✅ Data aa gaya";
}


function resetPositionZ2H() {
  resetEntryExit_Z2H();
  SpreadsheetApp.getActiveSpreadsheet().toast("Z2H position reset ho gayi", "⚡ Z2H", 5);
}


function stopZ2H() {
  removeTriggers_Z2H();
  SpreadsheetApp.getUi().alert("⏹️ Auto run band.\nWapas chalu karna ho to: ⚡ Z2H → 🚀 Setup");
}


// null = Cancel, "" = khaali (purana hi rahega)
function askValue_Z2H(ui, title, current) {

  var hint = current ? "\n\n(Pehle se set hai — khaali chhodo to wahi rahega)" : "";
  var res = ui.prompt(title, "Yahan paste karo:" + hint, ui.ButtonSet.OK_CANCEL);

  if (res.getSelectedButton() !== ui.Button.OK) return null;

  return res.getResponseText().trim();
}


// UI + FINAL_VIEW sheet, B1 symbol dropdown
function ensureSheets_Z2H() {

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  var ui = spreadsheet.getSheetByName("UI") || spreadsheet.insertSheet("UI");
  if (!spreadsheet.getSheetByName("FINAL_VIEW")) spreadsheet.insertSheet("FINAL_VIEW");

  if (!ui.getRange("A1").getValue() && !ui.getRange("A2").getValue()) {
    ui.getRange("A1:A2").setValues([["SYMBOL"], ["EXPIRY"]]);
  }

  var b1 = ui.getRange("B1");
  var symbol = String(b1.getValue()).trim().toUpperCase();

  if (!SCRIP_MAP_Z2H[symbol]) {
    symbol = "NIFTY";
    b1.setValue(symbol);
  }

  b1.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(Object.keys(SCRIP_MAP_Z2H), true)
      .build()
  );

  return { ui: ui, symbol: symbol };
}


function installTriggers_Z2H(withSR) {

  removeTriggers_Z2H();

  ScriptApp.newTrigger("loadOptionChain").timeBased().everyMinutes(1).create();

  if (withSR) {
    ScriptApp.newTrigger("fetchSRToUI_Z2H").timeBased().everyMinutes(1).create();
  }
}


// sirf apne triggers hatao (duplicate na bane)
function removeTriggers_Z2H() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (Z2H_TRIGGER_FUNCTIONS.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
}


// Mon–Fri, 09:15–15:30 IST
function isMarketOpen_Z2H(now) {

  var parts = Utilities.formatDate(now || new Date(), TZ_Z2H, "yyyy-MM-dd HH:mm").split(" ");
  var d = parts[0].split("-");

  var dow = new Date(Date.UTC(+d[0], +d[1] - 1, +d[2])).getUTCDay(); // 0 = Sunday
  if (dow === 0 || dow === 6) return false;

  return parts[1] >= MARKET_START_Z2H && parts[1] <= MARKET_END_Z2H;
}


function todayIST_Z2H() {
  return Utilities.formatDate(new Date(), TZ_Z2H, "yyyy-MM-dd");
}


// Dhan expiry list → { list, code, tokenError }
function fetchExpiryList_Z2H(symbol, token, client) {

  var response = UrlFetchApp.fetch("https://api.dhan.co/v2/optionchain/expirylist", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      "access-token": token,
      "client-id": client
    },
    payload: JSON.stringify({
      UnderlyingScrip: SCRIP_MAP_Z2H[symbol],
      UnderlyingSeg: "IDX_I"
    })
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  var out = {
    list: null,
    code: code,
    tokenError: code == 401 || code == 403 || text.indexOf("DH-901") >= 0
  };

  if (code !== 200) return out;

  try {
    var json = JSON.parse(text);
    out.list = (json.data || []).map(String).filter(function(d) {
      return /^\d{4}-\d{2}-\d{2}$/.test(d);
    }).sort();
  } catch (e) {
    out.list = null;
  }

  return out;
}


// B2 me nearest expiry (text) + aage ki expiries ka dropdown
function refreshExpiry_Z2H(sheet, symbol, token, client) {

  var r = fetchExpiryList_Z2H(symbol, token, client);
  if (!r.list) return r;

  var today = todayIST_Z2H();
  var upcoming = r.list.filter(function(d) {
    return d >= today;
  });

  if (!upcoming.length) return r;

  var cell = sheet.getRange("B2");

  cell.setNumberFormat("@").setValue(upcoming[0]);
  cell.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(upcoming.slice(0, 50), true)
      .setAllowInvalid(true)
      .build()
  );

  PropertiesService.getScriptProperties().setProperty("EXPIRY_FOR", symbol);

  r.expiry = upcoming[0];
  return r;
}



// =====================================================
// OPTION CHAIN (loadOptionChain = har minute ka trigger)
// =====================================================

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


// ✅ TRIGGER ISKO HI LAGAO (Setup khud lagata hai)
function loadOptionChain(e) {

  // trigger se aaya aur market band hai → kuch mat karo (daily runtime quota bachao)
  if (e && e.triggerUid && !isMarketOpen_Z2H()) return;

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

  var tz = TZ_Z2H;

  var symbol = sheet.getRange("B1").getValue().toString().trim().toUpperCase();
  var expiry = readExpiry_Z2H(sheet.getRange("B2").getValue(), spreadsheet.getSpreadsheetTimeZone());

  var underlyingScrip = SCRIP_MAP_Z2H[symbol];
  if (!underlyingScrip) {
    showError_Z2H(sheet, "❌ SYMBOL GALAT: " + symbol);
    return;
  }

  // 🔐 TOKEN Script Properties se (Setup / Token update menu save karta hai)
  var props = PropertiesService.getScriptProperties();
  var token = (props.getProperty("DHAN_TOKEN") || "").trim();
  var client = (props.getProperty("DHAN_CLIENT_ID") || "").trim();

  if (!token || !client) {
    showError_Z2H(sheet, "❌ TOKEN MISSING → ⚡ Z2H → Setup");
    return;
  }

  // 📅 expiry khaali / galat / nikal gayi / symbol badla → nearest expiry apne aap
  var expiryFor = props.getProperty("EXPIRY_FOR");

  var needExpiry =
    !/^\d{4}-\d{2}-\d{2}$/.test(expiry) ||
    expiry < todayIST_Z2H() ||
    (expiryFor !== null && expiryFor !== symbol);

  if (needExpiry) {
    var exp = refreshExpiry_Z2H(sheet, symbol, token, client);

    if (!exp.expiry) {
      showError_Z2H(sheet, exp.tokenError ? "❌ ERROR TOKEN" : "❌ EXPIRY NAHI MILI");
      return;
    }

    expiry = exp.expiry;

    // Dhan: 3 sec me 1 request
    Utilities.sleep(3000);
  }
  else if (expiryFor === null) {
    props.setProperty("EXPIRY_FOR", symbol);
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

    // galat expiry ho sakti hai → agle run me nayi expiry le aao
    if (code == 400) props.setProperty("EXPIRY_FOR", "REFRESH");

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

  // ✅ poori history ek hi baar save (History.gs)
  saveHistory_Z2H();

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

  // ✅ FINAL_VIEW same row number (headers bhi yahi likhta hai)
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

  // strike history + open position bhi naye symbol / din ke liye saaf
  clearHistory_Z2H();
  resetEntryExit_Z2H();

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


// headers prepareFinalViewRow_Z2H (EntryExit.gs) likhta hai
function getFinalViewSheet_Z2H() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName("FINAL_VIEW") || spreadsheet.insertSheet("FINAL_VIEW");
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
    TZ_Z2H,
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


// =====================================================
// HISTORY + DIRECTION
// =====================================================

// =====================================================
// HISTORY (har strike ka OI% / VOL%)
//
// Pehle: saari history ek "HISTORY" property me thi aur har strike par
// 324 baar padhi/likhi jaati thi. Wo property pehle hi run me 9KB limit
// cross kar deti thi ("Argument too large") aur daily quota bhi khatam karti thi.
//
// Ab: type wise 4 property (HISTORY_CE_OI, HISTORY_PE_OI, HISTORY_CE_VOL,
// HISTORY_PE_VOL). Run me memory me update, aur loadOptionChain ek hi baar
// saveHistory_Z2H() se save karta hai.
// =====================================================

var HISTORY_MAX_Z2H = 10;
var HISTORY_SIZE_LIMIT_Z2H = 8500; // property limit 9KB hai

var HISTORY_BUCKETS_Z2H = null;   // { "HISTORY_CE_OI": { "25000": [..] } }
var HISTORY_DIRTY_Z2H = {};
var HISTORY_TOUCHED_Z2H = {};

function getProps() {
  return PropertiesService.getScriptProperties();
}

// "CE_OI_25000" → bucket "HISTORY_CE_OI", strike "25000"
function splitHistoryKey_Z2H(key) {
  key = String(key);
  var i = key.lastIndexOf("_");
  return { bucket: "HISTORY_" + key.slice(0, i), strike: key.slice(i + 1) };
}

function getHistoryBucket_Z2H(bucket) {

  if (!HISTORY_BUCKETS_Z2H) HISTORY_BUCKETS_Z2H = {};

  if (!HISTORY_BUCKETS_Z2H[bucket]) {
    var raw = getProps().getProperty(bucket);
    HISTORY_BUCKETS_Z2H[bucket] = raw ? JSON.parse(raw) : {};
  }

  return HISTORY_BUCKETS_Z2H[bucket];
}

function updateHistory(key, value) {

  var k = splitHistoryKey_Z2H(key);
  var obj = getHistoryBucket_Z2H(k.bucket);

  // 2 decimal kaafi hai (display bhi 2 decimal hai) aur size chhota rehta hai
  value = Math.round(Number(value || 0) * 100) / 100;

  var arr = obj[k.strike] || [];

  // duplicate avoid
  if (arr.length === 0 || arr[arr.length - 1] !== value) {
    arr.push(value);
  }

  if (arr.length > HISTORY_MAX_Z2H) arr.shift();

  obj[k.strike] = arr;

  HISTORY_DIRTY_Z2H[k.bucket] = true;
  if (!HISTORY_TOUCHED_Z2H[k.bucket]) HISTORY_TOUCHED_Z2H[k.bucket] = {};
  HISTORY_TOUCHED_Z2H[k.bucket][k.strike] = true;

  return arr;
}

function getHistory(key) {
  var k = splitHistoryKey_Z2H(key);
  return getHistoryBucket_Z2H(k.bucket)[k.strike] || [];
}

// ✅ run me ek hi baar save (loadOptionChain call karta hai)
function saveHistory_Z2H() {

  var props = getProps();

  for (var bucket in HISTORY_DIRTY_Z2H) {

    var obj = HISTORY_BUCKETS_Z2H[bucket];
    var touched = HISTORY_TOUCHED_Z2H[bucket] || {};

    // jo strike is run me range me nahi thi uski history hatao
    for (var s in obj) {
      if (!touched[s]) delete obj[s];
    }

    var json = JSON.stringify(obj);

    // safety: phir bhi bada ho to sabse purani value hatao
    while (json.length > HISTORY_SIZE_LIMIT_Z2H) {
      for (var t in obj) {
        if (obj[t].length > 1) obj[t].shift();
      }
      json = JSON.stringify(obj);
    }

    props.setProperty(bucket, json);
  }

  HISTORY_DIRTY_Z2H = {};
  HISTORY_TOUCHED_Z2H = {};
}

// symbol / expiry / naya din → history saaf
function clearHistory_Z2H() {

  var props = getProps();

  ["HISTORY", "HISTORY_CE_OI", "HISTORY_PE_OI", "HISTORY_CE_VOL", "HISTORY_PE_VOL"]
    .forEach(function(k) {
      props.deleteProperty(k);
    });

  HISTORY_BUCKETS_Z2H = null;
  HISTORY_DIRTY_Z2H = {};
  HISTORY_TOUCHED_Z2H = {};
}

// ✅ SAME AS BEFORE
function getHighestStrike(data) {

  var max = -1;
  var strike = null;

  for (var s in data) {
    if (data[s] > max) {
      max = data[s];
      strike = Number(s);
    }
  }

  return strike;
}
function getMovement(arr) {

  if (arr.length < 2) return "CONFUSION";

  var last = arr[arr.length - 1];
  var prev = arr[arr.length - 2];

  if (last > prev) return "UP";
  if (last < prev) return "DOWN";

  return "SAME";
}



// ✅ FINAL SAME
function getFinalDirection(ceOI, ceVol, peOI, peVol) {

  var ceFinal = (ceOI == ceVol) ? ceOI : "CONFUSION";
  var peFinal = (peOI == peVol) ? peOI : "CONFUSION";

  var action = "NO TRADE";

  if (ceFinal == "UP" && peFinal == "UP") action = "BUY";
  else if (ceFinal == "DOWN" && peFinal == "DOWN") action = "SELL";
  else if (ceFinal == "UP" && peFinal == "DOWN") action = "RANGE";
  else if (ceFinal == "DOWN" && peFinal == "UP") action = "RANGE";

  return { ce: ceFinal, pe: peFinal, action: action };
}

// ✅ TOP PANEL UPDATE
function updateDirection(sheet, totalCallOI, totalPutOI, totalCallVol, totalPutVol) {

  if (!sheet) return;

  // J3:L4 me pichhla run (K column jaisa hai waisa rehta hai)
  var saved = sheet.getRange("J3:L4").getValues();

  var prevCE_OI = Number(saved[0][0]) || 0;
  var prevPE_OI = Number(saved[0][2]) || 0;

  var prevCE_VOL = Number(saved[1][0]) || 0;
  var prevPE_VOL = Number(saved[1][2]) || 0;

  function arrow(curr, prev){
    if (curr > prev) return " ↑";
    if (curr < prev) return " ↓";
    return "";
  }

  function color(curr, prev){
    if (curr > prev) return "#00ff00"; // green
    if (curr < prev) return "#ff0000"; // red
    return "#ffffff"; // neutral
  }

  // CE OI
  sheet.getRange("J1")
    .setValue(formatNumber(totalCallOI) + arrow(totalCallOI, prevCE_OI))
    .setBackground(color(totalCallOI, prevCE_OI));

  // PE OI
  sheet.getRange("L1")
    .setValue(formatNumber(totalPutOI) + arrow(totalPutOI, prevPE_OI))
    .setBackground(color(totalPutOI, prevPE_OI));

  // CE VOL
  sheet.getRange("J2")
    .setValue(formatNumber(totalCallVol) + arrow(totalCallVol, prevCE_VOL))
    .setBackground(color(totalCallVol, prevCE_VOL));

  // PE VOL
  sheet.getRange("L2")
    .setValue(formatNumber(totalPutVol) + arrow(totalPutVol, prevPE_VOL))
    .setBackground(color(totalPutVol, prevPE_VOL));

  // SAVE VALUES (single call)
  sheet.getRange("J3:L4").setValues([
    [totalCallOI, saved[0][1], totalPutOI],
    [totalCallVol, saved[1][1], totalPutVol]
  ]);
}
function getMovementTrend(arr) {

  if (!arr || arr.length < 3) return "CONFUSION";

  var up = 0, down = 0;

  for (var i = 1; i < arr.length; i++) {
    if (arr[i] > arr[i - 1]) up++;
    else if (arr[i] < arr[i - 1]) down++;
  }

  if (up + down == 0) return "CONFUSION";

  if (up > down) return "UP";
  if (down > up) return "DOWN";

  // 👉 बराबर case (last movement देखो)
  for (var j = arr.length - 1; j > 0; j--) {
    if (arr[j] > arr[j - 1]) return "UP";
    if (arr[j] < arr[j - 1]) return "DOWN";
  }

  return "CONFUSION";
}
function getDirectionBy100(data, type) {

  var refStrike = getHighestStrike(data); // 100% strike
  if (refStrike === null) return "CONFUSION";

  var aboveUp = false;
  var belowUp = false;

  for (var strike in data) {

    var val = data[strike];
    if (val < 75) continue;

    var history = getHistory(type + "_" + strike);
    var move = getMovementTrend(history);

    if (Number(strike) > refStrike && move == "UP") {
      aboveUp = true;
    }

    if (Number(strike) < refStrike && move == "UP") {
      belowUp = true;
    }
  }

  if (aboveUp && belowUp) return "CONFUSION";
  if (aboveUp && !belowUp) return "UP";
  if (!aboveUp && belowUp) return "DOWN";

  return "CONFUSION";
}

function greeks(s, k, t, r, v, type) {
  var d1 = (Math.log(s / k) + (r + Math.pow(v, 2) / 2) * t) / (v * Math.sqrt(t));
  var d2 = d1 - v * Math.sqrt(t);

  var n_d1 = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-Math.pow(d1, 2) / 2);

  var delta = (type === "CE")
    ? 0.5 * (1 + Erf(d1 / Math.sqrt(2)))
    : 0.5 * (1 + Erf(d1 / Math.sqrt(2))) - 1;

  var gamma = n_d1 / (s * v * Math.sqrt(t));

  return {
    delta: Math.abs(delta),
    gamma: gamma
  };
}

function Erf(x) {
  var a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  var a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;

  var sign = (x < 0) ? -1 : 1;
  x = Math.abs(x);

  var t = 1.0 / (1.0 + p * x);
  var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}


// =====================================================
// Z2H ENTRY / EXIT
// =====================================================

// =====================================================
// Z2H ENTRY EXIT ENGINE
// Output: FINAL_VIEW Z:AG
// S&R source:
// Resistance = UI S:T
// Support    = UI U:V
// =====================================================

function runEntryExitEngine_Z2H(data, row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = ss.getSheetByName("UI");
  var fv = ss.getSheetByName("FINAL_VIEW");

  if (!ui || !fv) return;

  var props = PropertiesService.getScriptProperties();

  var spot = Number(data.spot || 0);
  if (!spot) return;

  var aMarket = cleanText_Z2H(data.aMarket);
  var qMarket = cleanText_Z2H(data.qMarket);
  var ceFinal = cleanText_Z2H(data.ceFinal);
  var peFinal = cleanText_Z2H(data.peFinal);

  var aSide = getASide_Z2H(aMarket);
  var qSide = getQSide_Z2H(qMarket);

  var position = props.getProperty("Z2H_POSITION") || "NONE";
  var entryPrice = Number(props.getProperty("Z2H_ENTRY_PRICE") || 0);
  var entrySRName = props.getProperty("Z2H_ENTRY_SR_NAME") || "";
  var slPrice = Number(props.getProperty("Z2H_SL_PRICE") || 0);

  var action = "WAIT";
  var setupSR = "";
  var exitReason = "";

  // =====================================================
  // 4TH EXIT CONDITION COUNTER
  // A = NO TRADE + Q = RANGE agar running position me
  // 2 baar continuous raha to exit
  // =====================================================

  var noTradeQRangeCount = Number(
    props.getProperty("Z2H_NO_TRADE_Q_RANGE_COUNT") || 0
  );

  if (position !== "NONE" && aMarket === "NO TRADE" && qMarket === "RANGE") {
    noTradeQRangeCount++;
  } else {
    noTradeQRangeCount = 0;
  }

  props.setProperty(
    "Z2H_NO_TRADE_Q_RANGE_COUNT",
    String(noTradeQRangeCount)
  );

  // =====================================================
  // 1) RUNNING BUY POSITION
  // =====================================================

  if (position === "BUY") {
    var latestSupport = getSRByName_Z2H(ui, "SUPPORT", entrySRName);

    if (latestSupport) {
      slPrice = latestSupport.price;
      setupSR = latestSupport.name + " " + latestSupport.price;
      props.setProperty("Z2H_SL_PRICE", String(slPrice));
    } else {
      setupSR = entrySRName + " NOT FOUND";
    }

    // BUY EXIT CHECK
    if (spot <= slPrice) {
      action = "EXIT BUY";
      exitReason = "BUY SL HIT";
      clearPosition_Z2H();
      position = "NONE";
    }
    else if (noTradeQRangeCount >= 2) {
      action = "EXIT BUY";
      exitReason = "A NO TRADE + Q RANGE 2 TIMES";
      clearPosition_Z2H();
      position = "NONE";
    }
    else if (aSide === "SELL" && qSide === "SELL") {
      action = "EXIT BUY";
      exitReason = "A + Q BOTH OPPOSITE SELL";
      clearPosition_Z2H();
      position = "NONE";
    }
    else if (isCEConfusionToDown_Z2H(ceFinal)) {
      action = "EXIT BUY";
      exitReason = "SPECIAL EXIT: CE CONFUSION TO DOWN";
      clearPosition_Z2H();
      position = "NONE";
    }
    else {
      action = "HOLD BUY";
      exitReason = "Data Change";
    }
  }

  // =====================================================
  // 2) RUNNING SELL POSITION
  // =====================================================

  else if (position === "SELL") {
    var latestResistance = getSRByName_Z2H(ui, "RESISTANCE", entrySRName);

    if (latestResistance) {
      slPrice = latestResistance.price;
      setupSR = latestResistance.name + " " + latestResistance.price;
      props.setProperty("Z2H_SL_PRICE", String(slPrice));
    } else {
      setupSR = entrySRName + " NOT FOUND";
    }

    // SELL EXIT CHECK
    if (spot >= slPrice) {
      action = "EXIT SELL";
      exitReason = "SELL SL HIT";
      clearPosition_Z2H();
      position = "NONE";
    }
    else if (noTradeQRangeCount >= 2) {
      action = "EXIT SELL";
      exitReason = "A NO TRADE + Q RANGE 2 TIMES";
      clearPosition_Z2H();
      position = "NONE";
    }
    else if (aSide === "BUY" && qSide === "BUY") {
      action = "EXIT SELL";
      exitReason = "A + Q BOTH OPPOSITE BUY";
      clearPosition_Z2H();
      position = "NONE";
    }
    else if (isPEConfusionToUp_Z2H(peFinal)) {
      action = "EXIT SELL";
      exitReason = "SPECIAL EXIT: PE CONFUSION TO UP";
      clearPosition_Z2H();
      position = "NONE";
    }
    else {
      action = "HOLD SELL";
      exitReason = "Data Change";
    }
  }

  // =====================================================
  // 3) FRESH ENTRY ONLY WHEN POSITION NONE
  // =====================================================

  if ((props.getProperty("Z2H_POSITION") || "NONE") === "NONE" && action.indexOf("EXIT") === -1) {

    var buyActive = false;
    var sellActive = false;

    // A column signal
    if (aSide === "BUY") buyActive = true;
    if (aSide === "SELL") sellActive = true;

    // A RANGE = both setup active
    if (aSide === "BOTH") {
      buyActive = true;
      sellActive = true;
    }

    // Q column signal
    if (qSide === "BUY") buyActive = true;
    if (qSide === "SELL") sellActive = true;

    var supports = readSupports_Z2H(ui);
    var resistances = readResistances_Z2H(ui);

    var nearestS = getNearestSupport_Z2H(supports, spot);
    var nearestR = getNearestResistance_Z2H(resistances, spot);

    var buyEntry = nearestS ? nearestS.price + 24 : 0;
    var buySL = nearestS ? nearestS.price : 0;

    var sellEntry = nearestR ? nearestR.price - 25 : 0;
    var sellSL = nearestR ? nearestR.price : 0;

    // ENTRY ZONE CHECK ONLY
    // BUY: spot support aur buy entry ke beech hona chahiye
    // SELL: spot sell entry aur resistance ke beech hona chahiye

    var buyInEntryZone = (
      buyActive &&
      buyEntry &&
      buySL &&
      spot >= buySL &&
      spot <= buyEntry
    );

    var sellInEntryZone = (
      sellActive &&
      sellEntry &&
      sellSL &&
      spot >= sellEntry &&
      spot <= sellSL
    );

    // BUY ENTRY - only when spot is between Support and Buy Entry
    if (buyInEntryZone) {

      action = "BUY ENTRY";
      setupSR = nearestS.name + " " + nearestS.price;
      position = "BUY";
      entryPrice = buyEntry;
      slPrice = buySL;
      entrySRName = nearestS.name;
      exitReason = "";

      props.setProperty("Z2H_POSITION", "BUY");
      props.setProperty("Z2H_ENTRY_PRICE", String(entryPrice));
      props.setProperty("Z2H_SL_PRICE", String(slPrice));
      props.setProperty("Z2H_ENTRY_SR_NAME", entrySRName);
    }

    // SELL ENTRY - only when spot is between Sell Entry and Resistance
    else if (sellInEntryZone) {
      action = "SELL ENTRY";
      setupSR = nearestR.name + " " + nearestR.price;
      position = "SELL";
      entryPrice = sellEntry;
      slPrice = sellSL;
      entrySRName = nearestR.name;
      exitReason = "";

      props.setProperty("Z2H_POSITION", "SELL");
      props.setProperty("Z2H_ENTRY_PRICE", String(entryPrice));
      props.setProperty("Z2H_SL_PRICE", String(slPrice));
      props.setProperty("Z2H_ENTRY_SR_NAME", entrySRName);
    }

    // ENTRY WAIT - CLEAN ACTION ONLY
    else {

      // Sirf BUY side active hai
      if (buyActive && !sellActive) {
        action = "BUY WAIT";
      }

      // Sirf SELL side active hai
      else if (sellActive && !buyActive) {
        action = "SELL WAIT";
      }

      // Dono side active hai = RANGE / unclear
      else {
        action = "NO CLEAR DIRECTION";
      }

      setupSR = "";
      position = "NONE";
      entryPrice = "";
      slPrice = "";
      exitReason = "";
    }
  }

  // =====================================================
  // 4) SAVE PREVIOUS VALUES
  // =====================================================

  props.setProperty("Z2H_PREV_CE_FINAL", ceFinal);
  props.setProperty("Z2H_PREV_PE_FINAL", peFinal);
  props.setProperty("Z2H_PREV_SPOT", String(spot));

  // =====================================================
  // 5) WRITE TO FINAL_VIEW Z:AG
  // =====================================================

  writeEntryExitToFinalView_Z2H({
    time: Utilities.formatDate(new Date(), TZ_Z2H, "HH:mm:ss"),
    spot: spot,
    action: action,
    setupSR: setupSR,
    position: position,
    entry: entryPrice,
    sl: slPrice,
    exitReason: exitReason
  }, row);
}

// =====================================================
// SIDE LOGIC
// =====================================================

function getASide_Z2H(aMarket) {
  aMarket = cleanText_Z2H(aMarket);

  if (aMarket.indexOf("BUY") > -1) return "BUY";
  if (aMarket.indexOf("SELL") > -1) return "SELL";
  if (aMarket.indexOf("RANGE") > -1) return "BOTH";

  return "WAIT";
}

function getQSide_Z2H(qMarket) {
  qMarket = cleanText_Z2H(qMarket);

  var props = PropertiesService.getScriptProperties();

  if (qMarket === "UP") {
    props.setProperty("Z2H_Q_LAST_SIDE", "BUY");
    return "BUY";
  }

  if (qMarket === "DOWN") {
    props.setProperty("Z2H_Q_LAST_SIDE", "SELL");
    return "SELL";
  }

  if (qMarket === "RANGE") {
    return props.getProperty("Z2H_Q_LAST_SIDE") || "WAIT";
  }

  return "WAIT";
}


// =====================================================
// S&R READ FUNCTIONS
// =====================================================

function readSupports_Z2H(sheet) {
  var values = sheet.getRange("U2:V20").getValues();
  var arr = [];

  values.forEach(function(row) {
    var name = row[0];
    var price = Number(row[1]);

    if (name && price) {
      arr.push({
        name: cleanText_Z2H(name),
        price: price
      });
    }
  });

  // high to low
  arr.sort(function(a, b) {
    return b.price - a.price;
  });

  return arr;
}

function readResistances_Z2H(sheet) {
  var values = sheet.getRange("S2:T20").getValues();
  var arr = [];

  values.forEach(function(row) {
    var name = row[0];
    var price = Number(row[1]);

    if (name && price) {
      arr.push({
        name: cleanText_Z2H(name),
        price: price
      });
    }
  });

  // low to high
  arr.sort(function(a, b) {
    return a.price - b.price;
  });

  return arr;
}

function getNearestSupport_Z2H(supports, spot) {
  var nearest = null;

  supports.forEach(function(s) {
    if (s.price <= spot) {
      if (!nearest || s.price > nearest.price) {
        nearest = s;
      }
    }
  });

  return nearest || supports[0] || null;
}

function getNearestResistance_Z2H(resistances, spot) {
  var nearest = null;

  resistances.forEach(function(r) {
    if (r.price >= spot) {
      if (!nearest || r.price < nearest.price) {
        nearest = r;
      }
    }
  });

  return nearest || resistances[0] || null;
}

function getSRByName_Z2H(sheet, type, name) {
  name = cleanText_Z2H(name);

  var range = type === "SUPPORT" ? "U2:V20" : "S2:T20";
  var values = sheet.getRange(range).getValues();

  for (var i = 0; i < values.length; i++) {
    var srName = cleanText_Z2H(values[i][0]);
    var price = Number(values[i][1]);

    if (srName === name && price) {
      return {
        name: srName,
        price: price
      };
    }
  }

  return null;
}


// =====================================================
// SPECIAL EXIT
// =====================================================

function isCEConfusionToDown_Z2H(ceFinal) {
  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty("Z2H_PREV_CE_FINAL") || "";

  return prev === "CONFUSION" && ceFinal === "DOWN";
}

function isPEConfusionToUp_Z2H(peFinal) {
  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty("Z2H_PREV_PE_FINAL") || "";

  return prev === "CONFUSION" && peFinal === "UP";
}


// =====================================================
// FINAL_VIEW OUTPUT Z:AG
// (headers prepareFinalViewRow_Z2H likhta hai)
// =====================================================

function writeEntryExitToFinalView_Z2H(data, row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("FINAL_VIEW");

  if (!sheet) {
    sheet = ss.insertSheet("FINAL_VIEW");
  }

  sheet.getRange(row, 26, 1, 8).setValues([[
    data.time,
    data.spot,
    data.action,
    data.setupSR,
    data.position,
    data.entry || "",
    data.sl || "",
    data.exitReason || ""
  ]]);

  // Color ACTION cell AB
  var actionCell = sheet.getRange(row, 28);

  if (String(data.action).indexOf("BUY") > -1) {
    actionCell.setBackground("#00ff00").setFontColor("#000000");
  }
  else if (String(data.action).indexOf("SELL") > -1) {
    actionCell.setBackground("#ff0000").setFontColor("#ffffff");
  }
  else {
    actionCell.setBackground("#fff200").setFontColor("#000000");
  }

  sheet.getRange(row, 26, 1, 8).setWrap(true);
}


// =====================================================
// RESET FUNCTION
// Use when you want to manually clear current position
// =====================================================

function clearPosition_Z2H() {
  var props = PropertiesService.getScriptProperties();

  props.setProperty("Z2H_POSITION", "NONE");
  props.deleteProperty("Z2H_ENTRY_PRICE");
  props.deleteProperty("Z2H_SL_PRICE");
  props.deleteProperty("Z2H_ENTRY_SR_NAME");

  // ✅ 4th exit condition counter reset
  props.deleteProperty("Z2H_NO_TRADE_Q_RANGE_COUNT");
}

// symbol / expiry / naya din par loadOptionChain bhi isko call karta hai
function resetEntryExit_Z2H() {
  var props = PropertiesService.getScriptProperties();

  props.deleteProperty("Z2H_POSITION");
  props.deleteProperty("Z2H_ENTRY_PRICE");
  props.deleteProperty("Z2H_SL_PRICE");
  props.deleteProperty("Z2H_ENTRY_SR_NAME");
  props.deleteProperty("Z2H_Q_LAST_SIDE");
  props.deleteProperty("Z2H_PREV_CE_FINAL");
  props.deleteProperty("Z2H_PREV_PE_FINAL");
  props.deleteProperty("Z2H_PREV_SPOT");
  props.deleteProperty("Z2H_NO_TRADE_Q_RANGE_COUNT");
}


// =====================================================
// COMMON
// =====================================================

function cleanText_Z2H(v) {
  return String(v || "").trim().toUpperCase();
}

function writeSRSnapshotToFinalView_Z2H(row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = ss.getSheetByName("UI");
  var fv = ss.getSheetByName("FINAL_VIEW");

  if (!ui || !fv || !row) return;

  // S:T = Resistance, U:V = Support (ek hi read)
  var values = ui.getRange("S2:V20").getValues();
  var rText = [];
  var sText = [];

  for (var i = 0; i < values.length; i++) {
    var rName = String(values[i][0] || "").trim();
    var rPrice = values[i][1];

    if (rName && rPrice) {
      rText.push(rName + " " + rPrice);
    }

    var sName = String(values[i][2] || "").trim();
    var sPrice = values[i][3];

    if (sName && sPrice) {
      sText.push(sName + " " + sPrice);
    }
  }

  // AH = Resistance snapshot
  // AI = Support snapshot
  fv.getRange(row, 34, 1, 2)
    .setValues([[rText.join("\n"), sText.join("\n")]])
    .setWrap(true)
    .setVerticalAlignment("middle");
}

function prepareFinalViewRow_Z2H() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("FINAL_VIEW");

  if (!sheet) {
    sheet = ss.insertSheet("FINAL_VIEW");
  }

  // A:N | O khaali | P:Y | Z:AG | AH:AI  (sab headers ek call me)
  sheet.getRange("A1:AI1").setValues([[
    "MARKET","DURATION","TIME",
    "CE OI (ACTIVE)","CE OI RES",
    "CE VOL (ACTIVE)","CE VOL RES",
    "CE FINAL",
    "PE OI (ACTIVE)","PE OI RES",
    "PE VOL (ACTIVE)","PE VOL RES",
    "PE FINAL",
    "RESULT TIME",

    "",

    "TIME","MARKET","SHIFT","CLUSTER",
    "ΔCE (S)","ΔPE (D)",
    "CE POWER (S)","PE POWER (D)",
    "DIFF","FINAL",

    "EE TIME",
    "SPOT",
    "ACTION",
    "SETUP S/R",
    "POSITION",
    "ENTRY",
    "SL",
    "EXIT REASON",

    "RESISTANCE SNAPSHOT",
    "SUPPORT SNAPSHOT"
  ]]);

  return sheet.getLastRow() + 1;
}


// =====================================================
// S&R FETCH
// =====================================================

// =====================================================
// S&R FETCH → UI S:V
// S:T = Resistance (name, price), U:V = Support (name, price), rows 2-20
//
// SR_API_URL Setup menu se save hota hai
// =====================================================

var SR_MAX_ROWS_Z2H = 19; // S2:V20

function fetchSRToUI_Z2H(e) {

  // trigger se aaya aur market band hai → kuch mat karo
  if (e && e.triggerUid && !isMarketOpen_Z2H()) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("UI");

  if (!sheet) {
    throw new Error("UI sheet nahi mila");
  }

  var url = (PropertiesService.getScriptProperties().getProperty("SR_API_URL") || "").trim();

  if (!url) {
    sheet.getRange("W1").setValue("SR_API_URL MISSING");
    return;
  }

  var response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code !== 200) {
    sheet.getRange("W1").setValue("SR API ERROR " + code);
    return;
  }

  var json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    sheet.getRange("W1").setValue("SR ERROR: JSON NAHI AAYA");
    return;
  }

  if (json.status !== "success") {
    sheet.getRange("W1").setValue("SR ERROR");
    return;
  }

  var resistance = json.resistance || [];
  var support = json.support || [];

  var output = [];
  var maxLen = Math.min(SR_MAX_ROWS_Z2H, Math.max(resistance.length, support.length));

  for (var i = 0; i < maxLen; i++) {
    var r = resistance[i] || {};
    var s = support[i] || {};

    output.push([
      r.name || "",
      r.price || "",
      s.name || "",
      s.price || ""
    ]);
  }

  // ✅ UI S:V clear
  sheet.getRange("S2:V20").clearContent();

  // ✅ UI me S&R write
  if (output.length > 0) {
    sheet.getRange(2, 19, output.length, 4).setValues(output);
  }

  var lastFetchTime = Utilities.formatDate(
    new Date(),
    TZ_Z2H,
    "HH:mm:ss"
  );

  sheet.getRange("S1").setValue(lastFetchTime);

  // ✅ purana error hatao
  sheet.getRange("W1").setValue("");
}
