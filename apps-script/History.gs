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
