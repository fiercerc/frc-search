/**
 * Fierce RC Search — append customer searches to the Search Log tab.
 *
 * Setup (3 steps):
 * 1. Open the FRC Search Settings spreadsheet → Extensions → Apps Script.
 *    Replace the default script with this file and save.
 * 2. Deploy → New deployment → Select type: Web app.
 *    Execute as: Me. Who has access: Anyone. Copy the Web App URL.
 * 3. Paste that URL into settings.json as "log_url", then rebuild the search
 *    index so the storefront starts sending searches.
 *
 * The storefront posts JSON as text/plain (no CORS preflight). Each row is
 * Timestamp (CT), Search Term, Total Results, In-Stock Results, Source,
 * Detail / Clicked. The log keeps the newest 10,000 searches.
 */
function doPost(e) {
  var data = {};
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    data = {};
  }
  if (!data.q) {
    return ContentService.createTextOutput('skip');
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Search Log');
  if (!sheet) {
    sheet = ss.insertSheet('Search Log');
    sheet.appendRow(['Timestamp (CT)', 'Search Term', 'Total Results', 'In-Stock Results', 'Source', 'Detail / Clicked']);
  }
  var ts = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    ts,
    String(data.q),
    Number(data.total) || 0,
    Number(data.inStock) || 0,
    String(data.source || ''),
    String(data.detail || '')
  ]);
  var maxRows = 10000;
  var extra = sheet.getLastRow() - 1 - maxRows;
  if (extra > 0) sheet.deleteRows(2, extra);
  return ContentService.createTextOutput('ok');
}
