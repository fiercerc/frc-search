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


def main():
    dst = sys.argv[1]
    data = read_js(dst)
    settings = json.load(open(os.path.join(ROOT, 'settings.json')))
    status = {'read': False, 'problems': []}
    try:
        tabs = {name: rows_of(settings['sheet_id'], gid) for name, gid in settings['tabs'].items()}
        cfg, status['problems'] = build_cfg(tabs, data['items'])
        status['read'] = True
    except Exception as e:  # keep yesterday's settings rather than dropping them
        print(f'Could not read the settings sheet ({e}); keeping the settings already on the site.')
        status['problems'].append(f'Could not read the settings sheet: {e}. Kept the previous settings.')
        try:
            cfg = read_js(fetch(LIVE_INDEX)).get('cfg') or {}
        except Exception:
            cfg = {}
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
    write_status(site, data, info, settings)


def write_status(site, data, info, settings):
    items = data.get('items', [])
    built = data.get('built') or ''
    try:
        t = datetime.strptime(built, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        # Central time (CDT -5 from mid-March to early November, CST -6 otherwise).
        y = t.year
        dst_start = datetime(y, 3, 8 + (6 - datetime(y, 3, 8).weekday()) % 7, 8, tzinfo=timezone.utc)
        dst_end = datetime(y, 11, 1 + (6 - datetime(y, 11, 1).weekday()) % 7, 7, tzinfo=timezone.utc)
        off = -5 if dst_start <= t < dst_end else -6
        local = t + timedelta(hours=off)
        when = local.strftime('%a %b %d, %Y at %I:%M %p').replace(' 0', ' ') + (' CDT' if off == -5 else ' CST')
    except ValueError:
        when = built or 'unknown'
    s = info.get('settings', {})
    probs = s.get('problems', [])
    e = html.escape
    sheet_url = f"https://docs.google.com/spreadsheets/d/{settings['sheet_id']}/edit"
    rows = [
        ('Last update', when),
        ('Products in search', f"{len(items):,}"),
        ('In stock', f"{sum(1 for i in items if (i.get('q') or 0) > 0):,}"),
        ('Settings sheet', 'Read OK' if s.get('read') else 'Could not read it (kept the previous settings)'),
        ('Synonyms', s.get('syn', 0)), ('Popular searches', s.get('pop', 0)),
        ('Pinned results', s.get('pin', 0)), ('Shortcuts', s.get('go', 0)),
    ]
    trs = ''.join(f'<tr><th>{e(str(a))}</th><td>{e(str(b))}</td></tr>' for a, b in rows)
    plist = ''.join(f'<li>{e(p)}</li>' for p in probs) or '<li class="ok">No problems found.</li>'
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Search status</title>
<style>
:root{{--navy:#132950;--line:#dddddd;--sub:#5c6576;--red:#d4252c;--green:#15803d}}
body{{margin:0;background:#f4f6f9;font:16px/1.45 Roboto,Arial,sans-serif;color:#0c0c0c}}
main{{max-width:640px;margin:0 auto;padding:20px 16px 40px}}
h1{{margin:0;padding:14px 16px;background:var(--navy);color:#fff;font-size:20px}}
.card{{background:#fff;border:1px solid var(--line);margin-top:16px}}
table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:10px 16px;border-top:1px solid var(--line);vertical-align:top}}
th{{width:45%;color:var(--sub);font-weight:500}}h2{{margin:0;padding:12px 16px;font-size:16px;background:#fff;border-bottom:1px solid var(--line)}}
ul{{margin:0;padding:12px 16px 12px 34px}}li{{margin:4px 0;color:var(--red)}}li.ok{{color:var(--green);list-style:none;margin-left:-18px}}
.links a{{display:block;padding:12px 16px;border-top:1px solid var(--line);color:var(--navy);font-weight:700;text-decoration:none}}
.links a:first-child{{border-top:0}}
</style></head><body><main>
<h1>Fierce RC Search status</h1>
<div class="card"><table>{trs}</table></div>
<div class="card"><h2>Problems in the settings sheet</h2><ul>{plist}</ul></div>
<div class="card links">
<a href="https://github.com/fiercerc/frc-search/actions/workflows/update-search.yml">Run an update now &rarr;</a>
<a href="{e(sheet_url)}">Open the settings sheet &rarr;</a>
<a href="https://fiercercsolutions.com/?frcs=on">Preview the new search &rarr;</a>
</div></main></body></html>'''
    open(os.path.join(site, 'status.html'), 'w', encoding='utf-8').write(page)


if __name__ == '__main__':
    main()
