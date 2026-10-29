/**
 * Fierce RC Search — private search log.
 *
 * Customer searches go to a PRIVATE spreadsheet ("FRC Search Log (private)") that only you
 * can open. The public settings sheet no longer holds them.
 *
 * Update (one time, about 2 minutes):
 * 1. Open the FRC Search Settings spreadsheet → Extensions → Apps Script.
 *    Select everything in the editor, paste this whole file over it, and click Save.
 * 2. In the function menu at the top, pick "setup" and click Run. Approve the permissions
 *    Google asks for. It creates the private log, moves any old rows into it, removes the
 *    old Search Log and Search Analytics tabs from the settings sheet, and prints the
 *    private log's link in the Execution log.
 * 3. Deploy → Manage deployments → pencil icon → Version: New version → Deploy.
 *    The web app link stays the same, so nothing else needs changing.
 *
 * What's protected: emails and long numbers (phone, card, order numbers) are removed before
 * saving; only known search sources are accepted; text can't be saved as a spreadsheet formula;
 * bursts are rate-limited; the log keeps the newest 10,000 searches.
 * The public summary (doGet) only returns counts per search term for the last 30 days.
 */
var LOG_NAME = 'FRC Search Log (private)';
var HEAD = ['Timestamp (CT)', 'Search Term', 'Total Results', 'In-Stock Results', 'Source', 'Detail / Clicked'];
var MAX_ROWS = 10000;
var PER_MINUTE = 120;
var SOURCES = { dropdown: 1, sheet: 1, results: 1, click: 1, shortcut: 1, waiting_list: 1 };
var SEARCHES = { dropdown: 1, sheet: 1, results: 1 };

function redact_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim();
  s = s.replace(/[^\s@]+@[^\s@]+/g, '[email]');
  s = s.replace(/\+?\(?\d[\d\s().\-\/]{7,}\d/g, function (m) { return m.replace(/\D/g, '').length >= 10 ? '[number]' : m; });
  s = s.slice(0, max || 80);
  return /^[=+\-@]/.test(s) ? "'" + s : s; // never let a search become a formula
}

function clamp_(n) {
  n = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(n, 100000));
}

function logBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LOG_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: make a new one */ }
  }
  var book = SpreadsheetApp.create(LOG_NAME);
  var log = book.getSheets()[0];
  log.setName('Search Log');
  log.appendRow(HEAD);
  log.setFrozenRows(1);
  props.setProperty('LOG_SHEET_ID', book.getId());
  return book;
}

function logSheet_() {
  var book = logBook_();
  var log = book.getSheetByName('Search Log');
  if (!log) { log = book.insertSheet('Search Log', 0); log.appendRow(HEAD); log.setFrozenRows(1); }
  return log;
}

function setup() {
  var book = logBook_();
  var log = logSheet_();
  var settings = SpreadsheetApp.getActiveSpreadsheet();
  var old = settings.getSheetByName('Search Log');
  if (old && old.getLastRow() > 1) {
    var rows = old.getRange(2, 1, old.getLastRow() - 1, 6).getValues().map(function (r) {
      return [r[0], redact_(r[1], 80), clamp_(r[2]), clamp_(r[3]), String(r[4] || ''), redact_(r[5], 60)];
    });
    log.getRange(log.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
  ['Search Log', 'Search Analytics'].forEach(function (name) {
    var sh = settings.getSheetByName(name);
    if (sh) settings.deleteSheet(sh);
  });
  var an = book.getSheetByName('Analytics') || book.insertSheet('Analytics');
  an.clear();
  an.getRange('A1').setFormula("=QUERY('Search Log'!B2:E, \"select B, count(B), avg(C), avg(D) where B <> '' and (E = 'results' or E = 'dropdown' or E = 'sheet') group by B order by count(B) desc limit 100 label B 'Top searches', count(B) 'Times', avg(C) 'Avg results', avg(D) 'Avg in stock'\", 0)");
  an.getRange('F1').setFormula("=QUERY('Search Log'!A2:E, \"select B, count(B), max(A) where B <> '' and C = 0 and (E = 'results' or E = 'dropdown' or E = 'sheet') group by B order by count(B) desc limit 100 label B 'No-result searches', count(B) 'Times', max(A) 'Last seen'\", 0)");
  CacheService.getScriptCache().remove('summary');
  Logger.log('Private search log: ' + book.getUrl());
}

function allow_() {
  var cache = CacheService.getScriptCache();
  var key = 'n' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  return n <= PER_MINUTE;
}

function text_(s) {
  return ContentService.createTextOutput(s);
}

function doPost(e) {
  var d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return text_('skip'); }
  var q = redact_(d.q, 80);
  var source = String(d.source || '');
  if (!q || !SOURCES[source]) return text_('skip');
  if (!allow_()) return text_('busy');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return text_('busy');
  try {
    var log = logSheet_();
    var ts = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
    log.appendRow([ts, q, clamp_(d.total), clamp_(d.inStock), source, redact_(d.detail, 60)]);
    var extra = log.getLastRow() - 1 - MAX_ROWS;
    if (extra > 0) log.deleteRows(2, extra);
  } finally {
    lock.releaseLock();
  }
  return text_('ok');
}

function when_(v) {
  if (v instanceof Date) return v;
  var t = new Date(String(v || '').replace(' ', 'T'));
  return isNaN(t.getTime()) ? null : t;
}

/** Public summary for the control panel: counts per term, last 30 days. No raw rows. */
function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('summary');
  if (hit) return text_(hit).setMimeType(ContentService.MimeType.JSON);
  var log = logSheet_();
  var n = log.getLastRow() - 1;
  var rows = n > 0 ? log.getRange(2, 1, n, 6).getValues() : [];
  var since = Date.now() - 30 * 864e5;
  var terms = {}, zeros = {}, waits = {};
  rows.forEach(function (r) {
    var t = when_(r[0]);
    if (t && t.getTime() < since) return;
    var term = String(r[1] || '').replace(/^'/, '').trim();
    if (!term) return;
    var last = t ? Utilities.formatDate(t, 'America/Chicago', 'MMM d, h:mm a') : '';
    var source = String(r[4] || '');
    var total = clamp_(r[2]), inStock = clamp_(r[3]), detail = String(r[5] || '').replace(/^'/, '');
    if (source === 'waiting_list') {
      var wk = (detail || term).toLowerCase();
      var w = waits[wk] || (waits[wk] = { term: detail || term, query: term, count: 0, last: last });
      w.count++; w.last = last || w.last;
      return;
    }
    if (!SEARCHES[source]) return;
    var k = term.toLowerCase();
    var rec = terms[k] || (terms[k] = { term: term, count: 0, total: total, inStock: inStock });
    rec.count++; rec.total = total; rec.inStock = inStock;
    if (total === 0) {
      var z = zeros[k] || (zeros[k] = { term: term, count: 0, last: last });
      z.count++; z.last = last || z.last;
    }
  });
  function byCount(a, b) { return b.count - a.count || (a.term < b.term ? -1 : 1); }
  var top = Object.keys(terms).map(function (k) { return terms[k]; }).sort(byCount).slice(0, 30);
  var issues = Object.keys(zeros).map(function (k) {
    var z = zeros[k];
    return { kind: 'No results', term: z.term, count: z.count, last: z.last, fix: 'syn' };
  });
  Object.keys(waits).forEach(function (k) {
    var w = waits[k];
    var label = w.term;
    if (w.query && w.query.toLowerCase() !== label.toLowerCase()) label = w.term + ' · searched "' + w.query + '"';
    issues.push({ kind: 'Waiting list', term: label, count: w.count, last: w.last, fix: 'pin' });
  });
  issues = issues.sort(byCount).slice(0, 30);
  var body = JSON.stringify({ updated: Utilities.formatDate(new Date(), 'America/Chicago', 'MMM d, h:mm a'), days: 30, top: top, issues: issues });
  cache.put('summary', body, 300);
  return text_(body).setMimeType(ContentService.MimeType.JSON);
}
