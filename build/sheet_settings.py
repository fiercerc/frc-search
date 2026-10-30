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
# Used when settings.json leaves log_url blank. A non-empty log_url in settings.json replaces it.
DEFAULT_LOG_URL = 'https://script.google.com/macros/s/AKfycbx_LXP02wAUxxpZQdw4c08fRYZeNOyyTvRyIH6Rjb5HiQ3OHQ9nTIx_Tts_n72fM1F1XA/exec'


def resolved_log_url(settings):
    return str((settings or {}).get('log_url') or '').strip() or DEFAULT_LOG_URL


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


def log_summary_of(url):
    """Counts per search term from the private search log (the logger's public summary)."""
    data = json.loads(fetch(url + ('&' if '?' in url else '?') + 'summary=1'))
    return {'top': list(data.get('top') or [])[:30], 'issues': list(data.get('issues') or [])[:30]}


def main():
    dst = sys.argv[1]
    data = read_js(dst)
    settings = json.load(open(os.path.join(ROOT, 'settings.json')))
    status = {'read': False, 'problems': []}
    try:
        tabs = {name: rows_of(settings['sheet_id'], gid) for name, gid in settings['tabs'].items()}
        cfg, status['problems'] = build_cfg(tabs, data['items'])
        cfg['log'] = resolved_log_url(settings)
        status['read'] = True
    except Exception as e:  # keep yesterday's settings rather than dropping them
        print(f'Could not read the settings sheet ({e}); keeping the settings already on the site.')
        status['problems'].append(f'Could not read the settings sheet: {e}. Kept the previous settings.')
        try:
            cfg = read_js(fetch(LIVE_INDEX)).get('cfg') or {}
        except Exception:
            cfg = {}
        if not cfg.get('log'):
            cfg['log'] = resolved_log_url(settings)
    log_summary = {'top': [], 'issues': []}
    try:
        log_summary = log_summary_of(resolved_log_url(settings))
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
    log_url = resolved_log_url(settings)
    log_sheet_url = str(settings.get('log_sheet_url') or '').strip()
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
.rebuild{display:inline-block;background:#fff;color:var(--navy);border:0;font:700 16px/1 Roboto,Arial,sans-serif;padding:16px 18px;text-decoration:none}
.rebuild:hover{background:#e7edf6;color:var(--navy)}
.note{margin:10px 0 0;color:var(--sub);min-height:1.3em}
.actions{display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px}
.actions a{background:#fff;border:1px solid var(--navy);color:var(--navy);text-decoration:none;font-weight:700;padding:10px 12px}
.actions a:hover{background:var(--navy);color:#fff}
.preview-pair a{font-size:16px;padding:14px 16px}
.preview-pair a.on{background:#15803d;border-color:#15803d;color:#fff}
.preview-pair a.on:hover{background:#0f6b32;color:#fff}
.preview-pair a.off{background:#fff}
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
<a class="rebuild" href="' + e(actions_url) + '" target="_blank" rel="noopener">&#128260; Run an update now</a></header>
<p class="note">Opens GitHub: click <b>Run workflow</b>, then the green <b>Run workflow</b>. Changes show on the site about 10 minutes after it finishes.</p>
<section class="card"><h2>Quick actions</h2>
<nav class="actions preview-pair">
<a class="on" href="https://fiercercsolutions.com/?frcs=on" target="_blank" rel="noopener">&#128994; Turn Preview ON (?frcs=on)</a>
<a class="off" href="https://fiercercsolutions.com/?frcs=off" target="_blank" rel="noopener">&#9898; Turn Preview OFF (?frcs=off)</a>
</nav>
<nav class="actions preview-pair">
<a class="on" href="https://fiercercsolutions.com/?frcs_owner=1" target="_blank" rel="noopener">&#128274; Keep this browser out of the search log</a>
<a class="off" href="https://fiercercsolutions.com/?frcs_owner=0" target="_blank" rel="noopener">&#128275; Count this browser in the search log again</a>
</nav>
<nav class="actions">
<a href="''' + e(sheet_url) + '''" target="_blank" rel="noopener">Open Settings Sheet</a>
''' + (('<a href="' + e(log_sheet_url) + '" target="_blank" rel="noopener">Open Private Search Log</a>\n') if log_sheet_url else '') + '''</nav></section>
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
  var LOG = ''' + json.dumps(log_url + ('&' if '?' in log_url else '?') + 'summary=1') + ''';
  var SHEET = "https://docs.google.com/spreadsheets/d/" + ''' + json.dumps(sheet_id) + ''' + "/edit#gid=";
  var SYN = ''' + json.dumps(str(syn_gid)) + ''', PIN = ''' + json.dumps(str(pin_gid)) + ''';
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function n(v) { v = Number(v) || 0; return v.toLocaleString(); }
  fetch(LOG, { credentials: "omit" }).then(function (r) { return r.json(); }).then(function (d) {
    var top = (d && d.top) || [], issues = (d && d.issues) || [];
    document.getElementById("frcs-top").innerHTML = top.length ? top.map(function (r) {
      return "<tr><td>" + esc(r.term) + "</td><td>" + n(r.count) + "</td><td>" + n(r.total) + "</td><td>" + n(r.inStock) + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="empty">No searches logged yet.</td></tr>';
    document.getElementById("frcs-issues").innerHTML = issues.length ? issues.map(function (r) {
      var href = SHEET + (r.fix === "syn" ? SYN : PIN);
      var name = r.fix === "syn" ? "Add a synonym" : "Pin a product";
      return "<tr><td><b class=\\"kind\\">" + esc(r.kind) + "</b> " + esc(r.term) + "</td><td>" + n(r.count) + "</td><td>" + esc(r.last || "") + "</td><td><a target=\\"_blank\\" rel=\\"noopener\\" href=\\"" + esc(href) + "\\">" + name + "</a></td></tr>";
    }).join("") : '<tr><td colspan="4" class="empty">No zero-result searches or waiting-list clicks yet.</td></tr>';
    var stamp = "Live: last 30 days" + (d && d.updated ? " · as of " + esc(d.updated) : "") + ".";
    document.getElementById("frcs-top-live").textContent = stamp.replace(/&amp;/g, "&");
    document.getElementById("frcs-issue-live").textContent = stamp.replace(/&amp;/g, "&");
  }).catch(function () { /* keep the snapshot from the last update */ });
})();
</script>
</main></body></html>'''
    open(os.path.join(site, 'status.html'), 'w', encoding='utf-8').write(page)


if __name__ == '__main__':
    main()
