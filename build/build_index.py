#!/usr/bin/env python3
"""Build the Fierce RC Search product file (frc-index.json) from a Shift4Shop product export CSV.

Usage: python3 build_index.py products.csv frc-index.json

Only public storefront fields go into the output. Cost, distributor and other
private columns in the export are never read.
"""
import csv
import html
import json
import re
import sys
from datetime import datetime, timezone

PUBLIC_FIELDS = ['catalogid', 'id', 'name', 'categories', 'mfgid', 'manufacturer', 'price', 'price2',
                 'saleprice', 'onsale', 'stock', 'thumbnail', 'image1', 'hide', 'notforsale',
                 'nonsearchable', 'filename', 'keywords', 'extended_description', 'free_shipping',
                 'date_created']

KIT_TOPS = {'RC Cars and Trucks'}
KIT_MFR_L2 = {'Kit Manufacturer Replacement Parts', 'Kit Manufacturer Option Parts'}


def num(v, default=0.0):
    try:
        return float(str(v).replace(',', '').strip() or default)
    except ValueError:
        return default


def money(v):
    return round(num(v), 2)


def paths(cat_field):
    out = []
    for p in (cat_field or '').split('@'):
        if not p.strip():
            continue
        levels = [x.replace('\\/', '/').strip() for x in re.split(r'(?<!\\)/', p)]
        out.append([x for x in levels if x])
    return out


def type_category(levels):
    """The 'what is it' category for the Category filter."""
    top = levels[0]
    if top == 'Parts Kit / Option':
        if len(levels) > 1 and levels[1] in KIT_MFR_L2:
            return 'Option Parts' if 'Option' in levels[1] else 'Replacement Parts'
        return levels[1] if len(levels) > 1 else 'Parts'
    if top in ('Clearance', 'Apparel', 'Gift Certificates', 'Fierce RC Products'):
        return top
    if top == 'RC Cars and Trucks':
        return 'RC Kits'
    return levels[1] if len(levels) > 1 else top


def vehicle(levels):
    """'Fits vehicle' name from kit-manufacturer part categories, e.g. 'Tekno RC NB48 2.2'."""
    if len(levels) >= 4 and levels[0] == 'Parts Kit / Option' and levels[1] in KIT_MFR_L2:
        leaf = levels[3]
        leaf = re.sub(r'\s+Option Parts$', '', leaf)
        leaf = re.sub(r'\s+Parts$', '', leaf)
        if leaf and not re.search(r'legacy', leaf, re.I):
            return leaf
    return None


def fitment_tokens(desc):
    text = re.sub(r'<[^>]+>', ' ', html.unescape(desc or ''))
    text = re.sub(r'\s+', ' ', text)
    found = []
    for m in re.finditer(r'\b(?:Fits|Compatible with|direct (?:upgrade|replacement) for)\b(.{0,160})', text, re.I):
        chunk = re.split(r'Please use|instruction manual', m.group(1), flags=re.I)[0]
        for tok in re.findall(r'[A-Za-z]*\d[A-Za-z0-9.]*', chunk):
            tok = tok.strip('.')
            if len(tok) >= 2 and not re.fullmatch(r'\d+(\.\d+)?(mm|pcs?)?', tok, re.I):
                found.append(tok)
    return found


def date_int(v):
    v = (v or '').strip().split(' ')[0]
    for fmt in ('%m/%d/%Y', '%Y-%m-%d'):
        try:
            return int(datetime.strptime(v, fmt).strftime('%Y%m%d'))
        except ValueError:
            pass
    return 0


def build(rows):
    brands, cats, vehs = [], [], []
    bidx, cidx, vidx = {}, {}, {}

    def idx(table, lookup, name):
        if name not in lookup:
            lookup[name] = len(table)
            table.append(name)
        return lookup[name]

    items = []
    for r in rows:
        if r.get('hide') == '1' or r.get('notforsale') == '1' or r.get('nonsearchable') == '1':
            continue
        sku = (r.get('id') or '').strip()
        name = html.unescape((r.get('name') or '').strip())
        if not name:
            continue
        ps = paths(r.get('categories'))
        k = sorted({idx(cats, cidx, type_category(p)) for p in ps})
        v = sorted({idx(vehs, vidx, vh) for p in ps for vh in [vehicle(p)] if vh})
        flags = 0
        if any(p[0] in KIT_TOPS for p in ps):
            flags |= 1
        if r.get('free_shipping') == '1':
            flags |= 2
        price = money(r.get('price'))
        sale = money(r.get('saleprice'))
        onsale = r.get('onsale') == '1' and 0 < sale < price
        aux = []
        for kw in re.split(r'[,;|]', html.unescape(r.get('keywords') or '')):
            kw = kw.strip()
            if kw and kw.lower() != sku.lower() and len(kw) <= 40:
                aux.append(kw)
        aux += fitment_tokens(r.get('extended_description'))
        seen, aux_clean = set(), []
        for a in aux:
            if a.lower() not in seen:
                seen.add(a.lower())
                aux_clean.append(a)
        url = (r.get('filename') or '').strip()
        if not url:
            url = 'product.asp?itemid=' + r.get('catalogid', '')
        item = {
            'c': int(num(r.get('catalogid'))),
            's': sku,
            'n': name,
            'u': url,
            'p': price,
            'q': int(num(r.get('stock'))),
        }
        mfg = (r.get('mfgid') or '').strip()
        if mfg and mfg.lower() != sku.lower():
            item['m'] = mfg
        thumb = (r.get('thumbnail') or '').strip()
        img = (r.get('image1') or '').strip()
        if thumb:
            item['t'] = thumb
        if img and img != thumb:
            item['i'] = img
        retail = money(r.get('price2'))
        if retail > price:
            item['r'] = retail
        if onsale:
            item['x'] = sale
            item['o'] = 1
        if r.get('manufacturer'):
            item['b'] = idx(brands, bidx, r['manufacturer'].strip())
        if k:
            item['k'] = k
        if v:
            item['v'] = v
        if aux_clean:
            item['a'] = ' '.join(aux_clean)[:240]
        if flags:
            item['f'] = flags
        d = date_int(r.get('date_created'))
        if d:
            item['d'] = d
        items.append(item)

    return {
        'v': 1,
        'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'count': len(items),
        'brands': brands,
        'cats': cats,
        'veh': vehs,
        'items': items,
    }


def write_js(data, dst):
    """Same data as a script file, for hosts that only accept .js uploads."""
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('window.FRCS_INDEX=')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = [{k: r.get(k, '') for k in PUBLIC_FIELDS} for r in reader]
    data = build(rows)
    if dst.endswith('.js'):
        write_js(data, dst)
    else:
        with open(dst, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{data['count']} products, {len(data['brands'])} brands, {len(data['cats'])} categories, {len(data['veh'])} vehicles -> {dst}")


if __name__ == '__main__':
    main()

