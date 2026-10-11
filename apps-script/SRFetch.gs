// =====================================================
// S&R FETCH → UI S:V
// S:T = Resistance (name, price), U:V = Support (name, price), rows 2-20
//
// ⚙️ Script Properties me SR_API_URL = aapke S&R web app ka /exec URL
// =====================================================

var SR_MAX_ROWS_Z2H = 19; // S2:V20

function fetchSRToUI_Z2H() {
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
    Session.getScriptTimeZone(),
    "HH:mm:ss"
  );

  sheet.getRange("S1").setValue(lastFetchTime);

  // ✅ purana error hatao
  sheet.getRange("W1").setValue("");
}
