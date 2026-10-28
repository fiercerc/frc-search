#!/usr/bin/env python3
"""Read the "FRC Search Settings" Google Sheet and add it to the product list.

Usage: python3 build/sheet_settings.py site/frc-index.js

The sheet is set to "anyone with the link can view", so no keys are needed.
Tabs (gids in settings.json): Synonyms, Popular, Pinned, Shortcuts.
If the sheet can't be read, the settings already live on the site are kept.
Also writes site/status.html, a plain status page for Pete.
"""
import csv
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_index import write_js  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE_INDEX = 'https://fiercerc.github.io/frc-search/frc-index.js'
STORE_HOSTS = ('fiercercsolutions.com', 'www.fiercercsolutions.com')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'frc-search-update'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8-sig', 'replace')


def read_js(path):
    text = open(path, encoding='utf-8').read() if os.path.exists(path) else path
    text = re.sub(r'^\s*window\.FRCS_INDEX\s*=\s*', '', text).rstrip().rstrip(';')
    return json.loads(text)


def rows_of(sheet_id, gid):
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}'
    text = fetch(url)
    if text.lstrip().startswith('<'):
        raise RuntimeError('the sheet is not shared as "anyone with the link can view"')
    rows = list(csv.reader(io.StringIO(text)))
    return [[c.strip() for c in r] for r in rows[1:] if any(c.strip() for c in r)]  # skip the header row


def split_list(s):
    return [x.strip() for x in re.split(r'[,;\n]', s or '') if x.strip()]


def compact(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def clean_link(u):
    """Only pages on the store: '/tekno-rc.html' or 'https://fiercercsolutions.com/...'."""
    u = (u or '').strip()
    if not u:
        return None
    if u.startswith('/') and not u.startswith('//'):
        return u
    if not re.match(r'^https?://', u, re.I):
        u = 'https://' + u
    p = urllib.parse.urlparse(u)
    if p.hostname and p.hostname.lower() in STORE_HOSTS:
        return (p.path or '/') + (('?' + p.query) if p.query else '') + (('#' + p.fragment) if p.fragment else '')
    return None


def build_cfg(tabs, items):
    problems, cfg = [], {}
    skus = {}
    for it in items:
        for k in (it.get('s'), it.get('m')):
            if k:
                skus.setdefault(compact(k), it.get('s'))

    syn = []
    for i, r in enumerate(tabs.get('synonyms', []), 2):
        group = split_list(r[0] if r else '')
        if len(group) >= 2:
            syn.append(group[:12])
        elif group:
            problems.append(f'Synonyms row {i}: needs at least two words separated by commas')
    cfg['syn'] = syn

    pop = []
    for r in tabs.get('popular', []):
        if r and r[0] and r[0] not in pop:
            pop.append(r[0][:40])
    cfg['pop'] = pop[:16]

    pins = []
    for i, r in enumerate(tabs.get('pinned', []), 2):
        r = r + ['', '']
        qs, parts = split_list(r[0]), split_list(r[1])
        if not qs or not parts:
            if qs or parts:
                problems.append(f'Pinned row {i}: needs both a search and at least one part number')
            continue
        found = []
        for p in parts:
            if compact(p) in skus:
                found.append(skus[compact(p)])
            else:
                problems.append(f'Pinned row {i}: part number {p} not found in the store')
        if found:
            pins.append({'q': qs, 's': found[:12]})
    cfg['pin'] = pins

    go = []
    for i, r in enumerate(tabs.get('shortcuts', []), 2):
        r = r + ['', '', '']
        qs, link = split_list(r[0]), clean_link(r[1])
        if not qs and not r[1]:
            continue
        if not qs:
            problems.append(f'Shortcuts row {i}: no search words')
        elif not link:
            problems.append(f'Shortcuts row {i}: the link must be a page on fiercercsolutions.com')
        else:
            go.append({'q': qs, 'u': link, 't': r[2][:60]})
    cfg['go'] = go
    return cfg, problems


def num_cell(v):
    try:
        return int(float(str(v or '0').replace(',', '').strip() or 0))
    except ValueError:
        return 0


def summarize_log(rows):
    """Turn Search Log rows into top searches, zero-result searches, and waiting-list clicks."""
    terms, zeros, waits = {}, {}, {}
    for r in rows:
        r = list(r) + [''] * 6
        ts, term, total, instock, source, detail = (r[0] or ''), (r[1] or '').strip(), num_cell(r[2]), num_cell(r[3]), (r[4] or '').strip(), (r[5] or '').strip()
        if not term:
            continue
        if source == 'waiting_list':
            key = (detail or term).lower()
            rec = waits.setdefault(key, {'term': detail or term, 'query': term, 'count': 0, 'last': ts})
            rec['count'] += 1
            rec['last'] = ts or rec['last']
            continue
        key = term.lower()
        rec = terms.setdefault(key, {'term': term, 'count': 0, 'total': total, 'inStock': instock, 'last': ts})
        rec['count'] += 1
        rec['total'] = total
        rec['inStock'] = instock
        rec['last'] = ts or rec['last']
        if total == 0:
            z = zeros.setdefault(key, {'term': term, 'count': 0, 'last': ts})
            z['count'] += 1
            z['last'] = ts or z['last']
    top = sorted(terms.values(), key=lambda x: (-x['count'], x['term'].lower()))[:30]
    issues = []
    for z in zeros.values():
        issues.append({'kind': 'No results', 'term': z['term'], 'count': z['count'], 'last': z['last'], 'fix': 'syn'})
    for w in waits.values():
        label = w['term']
        if w['query'] and w['query'].lower() != label.lower():
            label = w['term'] + ' · searched “' + w['query'] + '”'
        issues.append({'kind': 'Waiting list', 'term': label, 'count': w['count'], 'last': w['last'], 'fix': 'pin'})
    issues.sort(key=lambda x: (-x['count'], x['term'].lower()))
    return {'top': top, 'issues': issues[:30]}


def main():
    dst = sys.argv[1]
    data = read_js(dst)
    settings = json.load(open(os.path.join(ROOT, 'settings.json')))
    status = {'read': False, 'problems': []}
    try:
        tabs = {name: rows_of(settings['sheet_id'], gid) for name, gid in settings['tabs'].items()}
        cfg, status['problems'] = build_cfg(tabs, data['items'])
        log_url = str(settings.get('log_url') or '').strip()
        if log_url:
            cfg['log'] = log_url
        status['read'] = True
    except Exception as e:  # keep yesterday's settings rather than dropping them
        print(f'Could not read the settings sheet ({e}); keeping the settings already on the site.')
        status['problems'].append(f'Could not read the settings sheet: {e}. Kept the previous settings.')
        try:
            cfg = read_js(fetch(LIVE_INDEX)).get('cfg') or {}
        except Exception:
            cfg = {}
    log_summary = {'top': [], 'issues': []}
    try:
        log_summary = summarize_log(rows_of(settings['sheet_id'], settings.get('search_log_gid', 693044905)))
    except Exception as e:
        print(f'Search log not read ({e}).')
    data['cfg'] = cfg
    write_js(data, dst)

    counts = {k: len(cfg.get(k) or []) for k in ('syn', 'pop', 'pin', 'go')}
    print('Settings:', counts, '| problems:', len(status['problems']))
    for p in status['problems']:
        print('  -', p)

    site = os.path.dirname(os.path.abspath(dst))
    info_path = os.path.join(site, 'frc-build-info.json')
    info = json.load(open(info_path)) if os.path.exists(info_path) else {}
    info['settings'] = dict(status, **counts)
    json.dump(info, open(info_path, 'w'), indent=1)
    write_status(site, data, info, settings, log_summary)


def central_when(built):
    try:
        t = datetime.strptime(built, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        # Central time (CDT -5 from mid-March to early November, CST -6 otherwise).
        y = t.year
        dst_start = datetime(y, 3, 8 + (6 - datetime(y, 3, 8).weekday()) % 7, 8, tzinfo=timezone.utc)
        dst_end = datetime(y, 11, 1 + (6 - datetime(y, 11, 1).weekday()) % 7, 7, tzinfo=timezone.utc)
        off = -5 if dst_start <= t < dst_end else -6
        local = t + timedelta(hours=off)
        return local.strftime('%a %b %d, %Y at %I:%M %p').replace(' 0', ' ') + (' CDT' if off == -5 else ' CST')
    except ValueError:
        return built or 'unknown'


def write_status(site, data, info, settings, log_summary=None):
    items = data.get('items', [])
    log_summary = log_summary or {'top': [], 'issues': []}
    when = central_when(data.get('built') or '')
    s = info.get('settings', {})
    probs = s.get('problems', [])
    e = html.escape
    sheet_id = settings['sheet_id']
    tabs = settings.get('tabs') or {}
    sheet_url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/edit'
    analytics_gid = 1247617429
    log_gid = settings.get('search_log_gid', 693044905)
    syn_gid = tabs.get('synonyms', 101)
    pin_gid = tabs.get('pinned', 103)
    in_stock = sum(1 for i in items if (i.get('q') or 0) > 0)
    out_stock = len(items) - in_stock
    health = [
        ('Last update', when),
        ('Products in search', f'{len(items):,}'),
        ('In stock', f'{in_stock:,}'),
        ('Out of stock (Waiting List)', f'{out_stock:,}'),
        ('Settings sheet', 'Read OK' if s.get('read') else 'Could not read it (kept the previous settings)'),
        ('Synonyms', s.get('syn', 0)),
        ('Popular searches', s.get('pop', 0)),
        ('Pinned results', s.get('pin', 0)),
        ('Shortcuts', s.get('go', 0)),
    ]
    health_rows = ''.join(f'<tr><th>{e(str(a))}</th><td>{e(str(b))}</td></tr>' for a, b in health)
    plist = ''.join(f'<li>{e(p)}</li>' for p in probs) or '<li class="ok">No problems found.</li>'

    def top_row(row):
        return (
            '<tr><td>' + e(row['term']) + '</td><td>' + e(f"{row['count']:,}") + '</td><td>'
            + e(f"{row['total']:,}") + '</td><td>' + e(f"{row['inStock']:,}") + '</td></tr>'
        )

    def issue_row(row):
        gid = syn_gid if row['fix'] == 'syn' else pin_gid
        label = 'Add a synonym' if row['fix'] == 'syn' else 'Pin a product'
        href = f'{sheet_url}#gid={gid}'
        return (
            '<tr><td><b class="kind">' + e(row['kind']) + '</b> ' + e(row['term']) + '</td><td>'
            + e(f"{row['count']:,}") + '</td><td>' + e(row.get('last') or '') + '</td><td><a href="'
            + e(href) + '" target="_blank" rel="noopener">' + label + '</a></td></tr>'
        )

    top_body = ''.join(top_row(r) for r in log_summary.get('top') or []) or '<tr><td colspan="4" class="empty">No searches logged yet.</td></tr>'
    issue_body = ''.join(issue_row(r) for r in log_summary.get('issues') or []) or '<tr><td colspan="4" class="empty">No zero-result searches or waiting-list clicks yet.</td></tr>'
    actions_url = 'https://github.com/fiercerc/frc-search/actions/workflows/update-search.yml'
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Fierce RC Search — Desktop Control Panel</title>
<style>
:root{--navy:#132950;--navy-dark:#0b1a36;--line:#dddddd;--sub:#5c6576;--red:#d4252c;--green:#15803d;--bg:#f4f6f9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:16px/1.45 Roboto,Arial,sans-serif;color:#0c0c0c}
main{max-width:1100px;margin:0 auto;padding:24px 20px 56px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;background:var(--navy);color:#fff;padding:22px 24px}
.eyebrow{margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.8}
h1{margin:0;font-size:28px;line-height:1.15}
.rebuild{background:#fff;color:var(--navy);border:0;font:700 16px/1 Roboto,Arial,sans-serif;padding:16px 18px;cursor:pointer}
.rebuild:hover{background:#e7edf6}.rebuild:disabled{opacity:.7;cursor:wait}
.note{margin:10px 0 0;color:var(--sub);min-height:1.3em}
.setup{margin-top:12px;background:#fff;border:1px solid var(--line);padding:12px 16px}
.setup summary{cursor:pointer;font-weight:700;color:var(--navy)}
.setup p{margin:8px 0;color:var(--sub);font-size:14px}
.setup input{width:min(420px,100%);height:38px;border:1px solid var(--line);padding:0 10px;font:14px Roboto,Arial,sans-serif}
.setup button{height:38px;margin-left:8px;border:1px solid var(--navy);background:#fff;color:var(--navy);font-weight:700;padding:0 12px;cursor:pointer}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.actions a{background:#fff;border:1px solid var(--navy);color:var(--navy);text-decoration:none;font-weight:700;padding:10px 12px}
.actions a:hover{background:var(--navy);color:#fff}
.card{background:#fff;border:1px solid var(--line);margin-top:16px}
h2{margin:0;padding:12px 16px;font-size:16px;border-bottom:1px solid var(--line)}
.health{width:100%;border-collapse:collapse}
.health th,.health td{text-align:left;padding:10px 16px;border-top:1px solid var(--line);vertical-align:top}
.health th{width:42%;color:var(--sub);font-weight:500}
ul.probs{margin:0;padding:12px 16px 12px 34px}ul.probs li{margin:4px 0;color:var(--red)}
ul.probs li.ok{color:var(--green);list-style:none;margin-left:-18px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
table.logs{width:100%;border-collapse:collapse;font-size:14px}
table.logs th,table.logs td{text-align:left;padding:8px 12px;border-top:1px solid var(--line);vertical-align:top}
table.logs th{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--sub)}
table.logs td:nth-child(2),table.logs td:nth-child(3),table.logs td:nth-child(4){font-variant-numeric:tabular-nums;white-space:nowrap}
.kind{display:inline-block;font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:#fff;background:var(--navy);padding:2px 6px;margin-right:6px}
a{color:var(--navy)} .empty{color:var(--sub)}
.live{margin:0;padding:8px 16px 12px;color:var(--sub);font-size:13px}
@media(max-width:800px){.cols{grid-template-columns:1fr}.top{align-items:stretch}.rebuild{width:100%}}
</style></head><body><main>
<header class="top"><div><p class="eyebrow">Fierce RC Solutions</p><h1>Search control panel</h1></div>
<button type="button" class="rebuild" id="frcs-rebuild" data-count="''' + f'{len(items):,}' + '''">&#128260; Rebuild Search Index Now</button></header>
<p class="note" id="frcs-rebuild-note"></p>
<details class="setup"><summary>&#9889; 1-Click Setup (Optional)</summary>
<p>Paste a GitHub fine-grained token for <b>fiercerc/frc-search</b> with Actions: Read and write. It is saved only in this browser (<code>localStorage</code> key <code>frcs_gh_pat</code>) and is never written to the site.</p>
<input id="frcs-pat" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
<button type="button" id="frcs-pat-save">Save token</button>
<button type="button" id="frcs-pat-clear">Remove token</button>
<p id="frcs-pat-state"></p>
</details>
<nav class="actions">
<a href="''' + e(sheet_url) + '''" target="_blank" rel="noopener">Open Settings Sheet</a>
<a href="''' + e(sheet_url) + '#gid=' + str(analytics_gid) + '''" target="_blank" rel="noopener">Open Search Analytics Tab</a>
<a href="https://fiercercsolutions.com/?frcs=on" target="_blank" rel="noopener">Preview Store Search (?frcs=on)</a>
</nav>
<section class="card"><h2>Index &amp; settings health</h2><table class="health">''' + health_rows + '''</table>
<h2>Problems in the settings sheet</h2><ul class="probs">''' + plist + '''</ul></section>
<div class="cols">
<section class="card"><h2>Top customer searches</h2>
<table class="logs"><thead><tr><th>Term</th><th>Searches</th><th>Matches</th><th>In Stock</th></tr></thead>
<tbody id="frcs-top">''' + top_body + '''</tbody></table>
<p class="live" id="frcs-top-live">Showing the snapshot from the last index build.</p></section>
<section class="card"><h2>Zero-result searches &amp; waiting-list clicks</h2>
<table class="logs"><thead><tr><th>Term</th><th>Searches</th><th>Last Seen</th><th></th></tr></thead>
<tbody id="frcs-issues">''' + issue_body + '''</tbody></table>
<p class="live" id="frcs-issue-live">Showing the snapshot from the last index build.</p></section>
</div>
<script>
(function () {
  var SHEET = ''' + json.dumps(sheet_id) + ''';
  var LOG_GID = ''' + json.dumps(int(log_gid)) + ''';
  var SYN = ''' + json.dumps(str(syn_gid)) + ''';
  var PIN = ''' + json.dumps(str(pin_gid)) + ''';
  var ACTIONS = ''' + json.dumps(actions_url) + ''';
  var REPO = "https://api.github.com/repos/fiercerc/frc-search/actions/workflows/update-search.yml";
  var KEY = "frcs_gh_pat";
  var note = document.getElementById("frcs-rebuild-note");
  var patState = document.getElementById("frcs-pat-state");
  var patInput = document.getElementById("frcs-pat");
  function token() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function sayToken() {
    patState.textContent = token()
      ? "A token is saved in this browser. Rebuild is one click."
      : "No token saved. Rebuild will open the Actions page so you can click Run workflow.";
  }
  sayToken();
  document.getElementById("frcs-pat-save").onclick = function () {
    var v = (patInput.value || "").trim();
    if (!v) return;
    try { localStorage.setItem(KEY, v); } catch (e) { patState.textContent = "This browser blocked local storage."; return; }
    patInput.value = "";
    sayToken();
  };
  document.getElementById("frcs-pat-clear").onclick = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    patInput.value = "";
    sayToken();
  };
  document.getElementById("frcs-rebuild").onclick = function () {
    var btn = document.getElementById("frcs-rebuild");
    var pat = token();
    if (!pat) {
      note.textContent = "No token saved in this browser. Opening Actions — click Run workflow there, or save a token once for 1-click rebuilds.";
      window.open(ACTIONS, "_blank", "noopener");
      return;
    }
    btn.disabled = true;
    note.textContent = "Queued";
    var started = Date.now();
    var headers = { Authorization: "Bearer " + pat, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    fetch(REPO + "/dispatches", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify({ ref: "main" }) })
      .then(function (r) {
        if (r.status === 204) { poll(started, 0); return; }
        btn.disabled = false;
        note.textContent = r.status === 401 || r.status === 403
          ? "GitHub rejected that token. Check Actions: Read and write, then save it again."
          : "Could not start the update (HTTP " + r.status + "). Opening Actions.";
        if (r.status !== 401 && r.status !== 403) window.open(ACTIONS, "_blank", "noopener");
      })
      .catch(function () { btn.disabled = false; note.textContent = "Could not reach GitHub from this browser."; });
    function poll(since, n) {
      if (n > 45) { btn.disabled = false; note.textContent = "Still running. Check the Actions tab for the latest step."; return; }
      fetch(REPO + "/runs?per_page=1", { headers: headers })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var run = (data.workflow_runs || [])[0];
          var created = run ? Date.parse(run.created_at) : 0;
          if (!run || created + 15000 < since) { note.textContent = "Queued"; setTimeout(function () { poll(since, n + 1); }, 4000); return; }
          if (run.status === "completed" && run.conclusion === "success") { btn.disabled = false; note.textContent = "Published!"; return; }
          if (run.status === "completed") { btn.disabled = false; note.textContent = "The update failed. Open the Actions tab to see why."; return; }
          note.textContent = (run.status === "in_progress")
            ? ("Pulling " + (btn.getAttribute("data-count") || "the") + " products from Shift4Shop...")
            : "Queued";
          setTimeout(function () { poll(since, n + 1); }, 4000);
        })
        .catch(function () { setTimeout(function () { poll(since, n + 1); }, 5000); });
    }
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function num(v) { var n = parseInt(String(v == null ? "" : (v.v != null ? v.v : v.f || v)), 10); return isNaN(n) ? 0 : n; }
  function text(cell) { if (!cell) return ""; return String(cell.v != null ? cell.v : cell.f || ""); }
  window.__frcsLogLoaded = function (resp) {
    if (!resp || resp.status !== "ok" || !resp.table) return;
    var cols = (resp.table.cols || []).map(function (c) { return String(c.label || c.id || "").toLowerCase(); });
    function idx(names, fallback) {
      for (var i = 0; i < cols.length; i++) for (var n = 0; n < names.length; n++) if (cols[i].indexOf(names[n]) >= 0) return i;
      return fallback;
    }
    var iTs = idx(["time", "timestamp"], 0), iQ = idx(["term", "search"], 1), iTot = idx(["total"], 2);
    var iIn = idx(["in-stock", "instock", "in stock"], 3), iSrc = idx(["source"], 4), iDet = idx(["detail", "click"], 5);
    var terms = {}, zeros = {}, waits = {};
    (resp.table.rows || []).forEach(function (row) {
      var c = row.c || [];
      var term = text(c[iQ]).trim(); if (!term) return;
      var total = num(c[iTot]), instock = num(c[iIn]), source = text(c[iSrc]).trim(), detail = text(c[iDet]).trim(), ts = text(c[iTs]);
      if (source === "waiting_list") {
        var wk = (detail || term).toLowerCase();
        var w = waits[wk] || (waits[wk] = { term: detail || term, query: term, count: 0, last: ts });
        w.count++; w.last = ts || w.last; return;
      }
      var k = term.toLowerCase();
      var rec = terms[k] || (terms[k] = { term: term, count: 0, total: total, inStock: instock });
      rec.count++; rec.total = total; rec.inStock = instock;
      if (total === 0) { var z = zeros[k] || (zeros[k] = { term: term, count: 0, last: ts }); z.count++; z.last = ts || z.last; }
    });
    function byCount(a, b) { return b.count - a.count; }
    var top = Object.keys(terms).map(function (k) { return terms[k]; }).sort(byCount).slice(0, 30);
    var issues = Object.keys(zeros).map(function (k) { var z = zeros[k]; return { kind: "No results", term: z.term, count: z.count, last: z.last, fix: "syn" }; });
    Object.keys(waits).forEach(function (k) {
      var w = waits[k];
      var label = w.term;
      if (w.query && w.query.toLowerCase() !== label.toLowerCase()) label = w.term + " · searched “" + w.query + "”";
      issues.push({ kind: "Waiting list", term: label, count: w.count, last: w.last, fix: "pin" });
    });
    issues.sort(byCount);
    issues = issues.slice(0, 30);
    var sheet = "https://docs.google.com/spreadsheets/d/" + SHEET + "/edit#gid=";
    document.getElementById("frcs-top").innerHTML = top.length ? top.map(function (r) {
      return "<tr><td>" + esc(r.term) + "</td><td>" + r.count.toLocaleString() + "</td><td>" + r.total.toLocaleString() + "</td><td>" + r.inStock.toLocaleString() + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="empty">No searches logged yet.</td></tr>';
    document.getElementById("frcs-issues").innerHTML = issues.length ? issues.map(function (r) {
      var href = sheet + (r.fix === "syn" ? SYN : PIN);
      var name = r.fix === "syn" ? "Add a synonym" : "Pin a product";
      return "<tr><td><b class=\\"kind\\">" + esc(r.kind) + "</b> " + esc(r.term) + "</td><td>" + r.count.toLocaleString() + "</td><td>" + esc(r.last || "") + "</td><td><a target=\\"_blank\\" rel=\\"noopener\\" href=\\"" + esc(href) + "\\">" + name + "</a></td></tr>";
    }).join("") : '<tr><td colspan="4" class="empty">No zero-result searches or waiting-list clicks yet.</td></tr>';
    var stamp = "Live from the Search Log sheet.";
    document.getElementById("frcs-top-live").textContent = stamp;
    document.getElementById("frcs-issue-live").textContent = stamp;
  };
  var s = document.createElement("script");
  s.src = "https://docs.google.com/spreadsheets/d/" + SHEET + "/gviz/tq?gid=" + LOG_GID + "&tqx=" + encodeURIComponent("out:json;responseHandler:__frcsLogLoaded");
  s.async = true;
  document.body.appendChild(s);
})();
</script>
</main></body></html>'''
    open(os.path.join(site, 'status.html'), 'w', encoding='utf-8').write(page)


if __name__ == '__main__':
    main()
