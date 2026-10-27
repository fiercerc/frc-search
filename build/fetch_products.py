#!/usr/bin/env python3
"""Pull every product from the Shift4Shop REST API and build site/frc-index.js.

Usage: python3 build/fetch_products.py site/frc-index.js

Needs three secrets (set in GitHub: Settings > Secrets and variables > Actions):
  S4S_SECURE_URL   the store's secure URL, e.g. https://fiercercsolutions.com
  S4S_PRIVATE_KEY  the private key of the Shift4Shop API app
  S4S_TOKEN        the token Shift4Shop gives when the store approves the app

Only public storefront fields are kept. Cost and distributor data are never written out.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_index import build, write_js  # noqa: E402

API = 'https://apirest.3dcart.com/3dCartWebAPI/v2'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def headers():
    return {
        'SecureURL': os.environ['S4S_SECURE_URL'],
        'PrivateKey': os.environ['S4S_PRIVATE_KEY'],
        'Token': os.environ['S4S_TOKEN'],
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }


def get(path, params):
    url = API + path + '?' + urllib.parse.urlencode(params)
    for attempt in range(6):
        req = urllib.request.Request(url, headers=headers())
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read().decode('utf-8', 'replace')
                return json.loads(body) if body.strip() else []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get('Retry-After') or 30)
                print(f'  rate limited, waiting {wait}s')
                time.sleep(wait + 1)
                continue
            if e.code == 404:
                return []  # Shift4Shop answers 404 past the last page
            detail = e.read().decode('utf-8', 'replace')[:300]
            raise SystemExit(f'Shift4Shop API error {e.code} on {path}: {detail}')
        except urllib.error.URLError as e:
            if attempt < 5:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f'Could not reach Shift4Shop: {e}')
    raise SystemExit('Shift4Shop kept rate-limiting; try again later.')


def get_all(path, page_size):
    out, offset = [], 0
    while True:
        batch = get(path, {'limit': page_size, 'offset': offset})
        if isinstance(batch, dict):
            batch = batch.get('Data') or batch.get('Items') or [batch]
        if not batch:
            break
        out.extend(batch)
        print(f'  {path}: {len(out)}')
        if len(batch) < page_size:
            break
        offset += page_size
    return out


# Shift4Shop's name for the long description isn't documented consistently; use whichever exist.
DESC_FIELDS = ('ExtendedDescription', 'Extended_Description', 'ExtDescription', 'LongDescription', 'Description')


def dedupe(products):
    """Shift4Shop pages overlap by one product; keep each CatalogID once."""
    seen, out = set(), []
    for p in products:
        cid = str(pick(pick(p, 'SKUInfo', default={}) or {}, 'CatalogID') or pick(p, 'CatalogID'))
        if cid in seen:
            continue
        seen.add(cid)
        out.append(p)
    return out


def field_report(products):
    """Field names and how many products fill each one (names and counts only, never values)."""
    counts = {}
    for p in products:
        for k, v in p.items():
            if isinstance(v, dict):
                for k2, v2 in v.items():
                    if not isinstance(v2, (dict, list)):
                        key = k + '.' + k2
                        counts[key] = counts.get(key, 0) + (1 if v2 not in (None, '', 0, '0') else 0)
            else:
                filled = bool(v) if isinstance(v, list) else v not in (None, '', 0, '0')
                counts[k] = counts.get(k, 0) + (1 if filled else 0)
    return dict(sorted(counts.items()))


def pick(d, *names, default=''):
    for n in names:
        if isinstance(d, dict) and n in d and d[n] is not None:
            return d[n]
    return default


def truthy(v):
    return str(v).strip().lower() in ('1', 'true', 'y', 'yes', '-1')


def category_paths(categories):
    """CategoryID -> list of names from the top level down."""
    by_id = {}
    for c in categories:
        cid = str(pick(c, 'CategoryID', 'ID'))
        by_id[cid] = (str(pick(c, 'CategoryName', 'Name')).strip(), str(pick(c, 'CategoryParent', 'ParentID', default='0')))
    cache = {}

    def path(cid, depth=0):
        if cid in cache:
            return cache[cid]
        if cid not in by_id or depth > 12:
            return []
        name, parent = by_id[cid]
        p = (path(parent, depth + 1) if parent not in ('0', '', cid) else []) + [name]
        cache[cid] = p
        return p
    return {cid: path(cid) for cid in by_id}


def to_row(p, cat_paths, links):
    sku = pick(p, 'SKUInfo', default={}) or {}
    cid = str(pick(sku, 'CatalogID') or pick(p, 'CatalogID'))
    cats = []
    for c in pick(p, 'CategoryList', default=[]) or []:
        levels = cat_paths.get(str(pick(c, 'CategoryID')))
        if levels:
            cats.append('/'.join(x.replace('/', '\\/') for x in levels))
    link = str(pick(p, 'ProductLink', 'Link', 'FileName')).strip()
    if link.startswith('http'):
        link = urllib.parse.urlparse(link).path.lstrip('/')
    if not link:
        link = links.get(cid, '')
    return {
        'catalogid': cid,
        'id': str(pick(sku, 'SKU') or pick(p, 'SKU')),
        'name': str(pick(sku, 'Name') or pick(p, 'Name')),
        'categories': '@'.join(cats),
        'mfgid': str(pick(p, 'MFGID')),
        'manufacturer': str(pick(p, 'ManufacturerName')),
        'price': pick(sku, 'Price', default=0),
        'price2': pick(sku, 'RetailPrice', default=0),
        'saleprice': pick(sku, 'SalePrice', default=0),
        'onsale': '1' if truthy(pick(sku, 'OnSale', default=0)) else '0',
        'stock': pick(sku, 'Stock', default=0),
        'thumbnail': str(pick(p, 'ThumbnailFile')),
        'image1': str(pick(p, 'MainImageFile')),
        'hide': '1' if truthy(pick(p, 'Hide', default=0)) else '0',
        'notforsale': '1' if truthy(pick(p, 'NotForSale', default=0)) else '0',
        'nonsearchable': '1' if truthy(pick(p, 'NonSearchable', default=0)) else '0',
        'filename': link,
        'keywords': str(pick(p, 'Keywords')),
        'extended_description': ' '.join(str(pick(p, n)) for n in DESC_FIELDS if pick(p, n)),
        'free_shipping': '1' if truthy(pick(p, 'FreeShipping', default=0)) else '0',
        'date_created': str(pick(p, 'DateCreated'))[:10],
    }


def main():
    dst = sys.argv[1]
    print('Reading categories...')
    cats = get_all('/Categories', 500)
    cat_paths = category_paths(cats)
    print('Reading products...')
    raw = get_all('/Products', 200)
    products = dedupe(raw)
    print(f'  {len(raw) - len(products)} repeated products skipped')
    if len(products) < 500:
        raise SystemExit(f'Only {len(products)} products came back; refusing to publish a short list.')
    try:
        links = json.load(open(os.path.join(ROOT, 'data', 'links.json')))
    except (OSError, ValueError):
        links = {}
    rows = [to_row(p, cat_paths, links) for p in products]
    data = build(rows)
    write_js(data, dst)
    info = {'built': data.get('built'), 'products': len(products), 'repeats_skipped': len(raw) - len(products),
            'fields': field_report(products)}
    with open(os.path.join(os.path.dirname(os.path.abspath(dst)), 'frc-build-info.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(f"Built {data['count']} products ({len(data['brands'])} brands, {len(data['cats'])} categories, {len(data['veh'])} vehicles)")


if __name__ == '__main__':
    main()
