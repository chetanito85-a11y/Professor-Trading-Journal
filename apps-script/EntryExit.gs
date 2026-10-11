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
    time: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss"),
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
