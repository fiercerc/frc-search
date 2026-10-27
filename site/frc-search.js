/*!
 * Fierce RC Search v1.0 for fiercercsolutions.com
 * Self-hosted product search: instant dropdown, mobile search sheet,
 * results page with filters. No monthly fees, no outside libraries.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FRCSearch = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* =====================================================================
   * 1. TEXT NORMALIZATION
   * ===================================================================== */

  var STOP = { the: 1, and: 1, for: 1, of: 1, with: 1, w: 1, a: 1, an: 1, to: 1, in: 1, on: 1, by: 1 };

  // Words customers type that mean the same thing as words in product names.
  var SYN = {
    ackerman: ['ackermann'], ackermann: ['ackerman'],
    diff: ['differential'], differential: ['diff'],
    tranny: ['transmission'], tire: ['tyre'], tyre: ['tire'],
    alum: ['aluminum'], aluminium: ['aluminum'], aluminum: ['alum'],
    ti: ['titanium'], titanium: ['ti'], cf: ['carbon'],
    batt: ['battery'], lipo: ['battery'], battery: ['lipo'],
    esc: ['speed'], radio: ['transmitter'], transmitter: ['radio'],
    shock: ['damper'], damper: ['shock'], arm: ['suspension'],
    sticker: ['decal'], decal: ['sticker'],
    buggy: ['buggie'], truggy: ['truggie'], nitro: ['engine'], engine: ['nitro'],
    screw: ['screws'], bearing: ['bearings'], pinion: ['pinions']
  };

  // Other names people use for brands. Matched against the lowercase brand name.
  var BRAND_ALIASES = {
    'team associated': ['associated', 'ae', 'ta', 'teamassociated'],
    'hb racing': ['hb', 'hbracing'],
    'jconcepts': ['jc', 'jconcept'],
    'mugen seiki': ['mugen'],
    'hobbywing': ['hw'],
    'pro-line': ['proline'],
    'gens ace': ['gensace', 'gens'],
    'tekno rc': ['tekno', 'teknorc'],
    'sparko': ['sparko'],
    'exotek': ['exo'],
    'avid': ['avid']
  };

  function deaccent(s) {
    return s.normalize ? s.normalize('NFKD').replace(/[̀-ͯ]/g, '') : s;
  }

  // Lowercase and rewrite RC notation so product text and queries line up.
  function prep(s) {
    s = deaccent(String(s == null ? '' : s).toLowerCase());
    s = s.replace(/[–—−]/g, '-').replace(/×/g, 'x').replace(/[‘’'`"“”]/g, '');
    // Scale: 1/8th, 1-8th, 1:8, 1/8 scale -> 1/8
    s = s.replace(/\b1\s*[\/:\-]\s*(5|6|7|8|10|12|16|18|24|28|32)\s*(?:th|scale)?\b/g, ' 1/$1 ');
    // Platform shorthand: eb/nb/et/nt48 -> eb48 nb48 et48 nt48 ; mt/sct410 -> mt410 sct410
    s = s.replace(/\b((?:[a-z]{1,4}\/)+)([a-z]{1,4})(\d[a-z0-9.]*)/g, function (m, pre, last, num) {
      var parts = pre.split('/').filter(Boolean);
      parts.push(last);
      return ' ' + parts.map(function (p) { return p + num; }).join(' ') + ' ';
    });
    return s;
  }

  function rawTokens(s) {
    var out = [];
    s.replace(/[a-z0-9][a-z0-9.\-+\/]*[a-z0-9]|[a-z0-9]/g, function (t) { out.push(t); return t; });
    return out;
  }

  function stem(t) {
    if (!/^[a-z]+$/.test(t) || t.length <= 3) return t;
    if (/ies$/.test(t) && t.length > 4) return t.slice(0, -3) + 'y';
    if (/(x|ch|sh)es$/.test(t)) return t.slice(0, -2);
    if (/ss$/.test(t) || /us$/.test(t) || /is$/.test(t)) return t;
    if (/s$/.test(t)) return t.slice(0, -1);
    return t;
  }

  // Index-side variants of one raw token.
  function variants(t, out) {
    if (t.indexOf('/') >= 0 && !/^1\/\d+$/.test(t)) {
      t.split('/').forEach(function (p) { if (p) variants(p, out); });
      return out;
    }
    out.push(t);
    if (t.indexOf('-') >= 0) {
      out.push(t.replace(/-/g, ''));
      t.split('-').forEach(function (p) { if (p) out.push(p); });
    }
    var m = t.match(/^([a-z]+\d+)\.\d+$/); // eb410.2 -> eb410
    if (m) out.push(m[1]);
    var lp = t.match(/^([a-z]+)(\d+)$/);    // nb48 -> 48 (helps "nb 48")
    if (lp && lp[1].length <= 4) { out.push(lp[2]); }
    var mc = t.match(/^([a-z]+\d+)([a-z]+\d[a-z0-9.]*)$/); // rc10b74 -> rc10 + b74, rc8b3.1 -> rc8 + b3.1
    if (mc) { out.push(mc[1]); variants(mc[2], out); }
    return out;
  }

  function textTokens(s) {
    var out = [];
    rawTokens(prep(s)).forEach(function (t) { variants(t, out); });
    return out.map(stem);
  }

  function compact(s) { return prep(s).replace(/[^a-z0-9]/g, ''); }

  // Part number "core": letters stripped from the front (tkr5070 -> 5070).
  function skuCores(norm) {
    var out = [];
    var m = norm.match(/^[a-z]+(\d[a-z0-9]*)$/);
    if (m && m[1].length >= 3) {
      out.push(m[1]);
      var d = m[1].match(/^(\d{3,})[a-z]+\d*$/); // 6031c -> 6031
      if (d) out.push(d[1]);
    }
    return out;
  }

  function damerau(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = new Array(lb + 1), cur;
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur = new Array(lb + 1); cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  /* =====================================================================
   * 2. SEARCH ENGINE
   * ===================================================================== */

  // NAME: anywhere in the product name. HEAD: the main part of the name, before
  // "(", "with", "for", "fits". TYPE: the product's category. VEH: the vehicles it fits.
  var FIELD = { NAME: 1, BRAND: 2, VEH: 4, AUX: 8, SKU: 16, CORE: 32, MFG: 64, CORE2: 128, HEAD: 256, TYPE: 512, NOUN: 1024 };
  var WEIGHT = { 1: 10, 2: 7, 4: 3.5, 8: 2.2, 16: 150, 32: 80, 64: 110, 128: 55, 256: 14, 512: 8, 1024: 17 };
  var TEXT_BITS = [1, 2, 4, 8, 256, 512];

  function fieldWeight(mask) {
    var w = 0, sum = 0;
    for (var b = 1; b <= 1024; b <<= 1) if (mask & b) { if (WEIGHT[b] > w) w = WEIGHT[b]; }
    for (var i = 0; i < TEXT_BITS.length; i++) if (mask & TEXT_BITS[i]) sum += WEIGHT[TEXT_BITS[i]];
    // A word that shows up in several places (name and category, say) counts a bit more.
    return w + 0.35 * Math.max(0, sum - (w <= 14 ? w : 0));
  }

  function nameHead(name) {
    var h = String(name).split(/\s\(|\swith\s|\sw\/\s?|\sfor\s|\sfits\s|,|\s\|\s/i)[0];
    return h.length >= 6 ? h : String(name);
  }

  function Engine(data) {
    var self = this;
    this.data = data;
    this.items = data.items || [];
    this.brands = data.brands || [];
    this.cats = data.cats || [];
    this.veh = data.veh || [];
    this.post = Object.create(null);   // token -> {doc: mask}
    this.df = Object.create(null);
    this.surface = Object.create(null); // stem -> a readable word
    this.skuExact = Object.create(null);
    var N = this.items.length;

    function add(tok, doc, bit) {
      if (!tok) return;
      var p = self.post[tok];
      if (!p) { p = self.post[tok] = Object.create(null); }
      if (p[doc] === undefined) { p[doc] = bit; self.df[tok] = (self.df[tok] || 0) + 1; }
      else p[doc] |= bit;
    }

    var catTokCache = this.cats.map(function (c) {
      var leaf = String(c).split('>').pop();
      return textTokens(leaf);
    });
    var vehTokCache = this.veh.map(function (v) { return textTokens(v); });
    var brandTokCache = this.brands.map(function (b) {
      var toks = textTokens(b);
      var al = BRAND_ALIASES[String(b).toLowerCase()];
      if (al) al.forEach(function (a) { toks.push(stem(a)); });
      return toks;
    });

    this.items.forEach(function (it, doc) {
      it._i = doc;
      it._name = ' ' + prep(it.n).replace(/[^a-z0-9.\/]+/g, ' ').replace(/\brc\b/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
      var nameToks = textTokens(it.n);
      rawTokens(prep(it.n)).forEach(function (w) {
        if (/^[a-z]+$/.test(w) && w.length > 2) { var st = stem(w); if (!self.surface[st]) self.surface[st] = w; }
      });
      nameToks.forEach(function (t) { add(t, doc, FIELD.NAME); });
      var head = nameHead(it.n);
      textTokens(head).forEach(function (t) { add(t, doc, FIELD.HEAD); });
      // The product type is usually the last real word of the main name: "...Turnbuckle Wrench" is a wrench.
      var hw = rawTokens(prep(head.split(/\s-\s/)[0])).filter(function (w) { return /^[a-z]{3,}$/.test(w) && !STOP[w]; });
      if (hw.length) add(stem(hw[hw.length - 1]), doc, FIELD.NOUN);
      if (it.b != null && brandTokCache[it.b]) brandTokCache[it.b].forEach(function (t) { add(t, doc, FIELD.BRAND); });
      (it.k || []).forEach(function (ci) { (catTokCache[ci] || []).forEach(function (t) { add(t, doc, FIELD.TYPE); }); });
      (it.v || []).forEach(function (vi) { (vehTokCache[vi] || []).forEach(function (t) { add(t, doc, FIELD.VEH); }); });
      if (it.a) textTokens(it.a).forEach(function (t) { add(t, doc, FIELD.AUX); });
      var s = compact(it.s);
      if (s) {
        add(s, doc, FIELD.SKU);
        (self.skuExact[s] = self.skuExact[s] || []).push(doc);
        skuCores(s).forEach(function (c, i) { add(c, doc, i ? FIELD.CORE2 : FIELD.CORE); });
      }
      var m = compact(it.m);
      if (m && m !== s) {
        add(m, doc, FIELD.MFG);
        (self.skuExact[m] = self.skuExact[m] || []).push(doc);
        skuCores(m).forEach(function (c, i) { add(c, doc, i ? FIELD.CORE2 : FIELD.CORE); });
      }
    });

    this.N = N;
    this.vocab = Object.keys(this.post).sort();
    this.alphaVocab = this.vocab.filter(function (t) { return /^[a-z]{3,}$/.test(t); });
    this.setup(data.cfg || {});
  }

  // A search's identity for pins and shortcuts: same words in any order, plurals and filler words ignored.
  function qkey(s) {
    var seen = {}, out = [];
    textTokens(s).forEach(function (t) { if (!STOP[t] && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out.sort().join(' ');
  }
  function words(s) { return rawTokens(prep(s)).join(' '); }

  // Settings from the Google Sheet: synonyms, popular searches, pinned results, shortcuts.
  Engine.prototype.setup = function (cfg) {
    var self = this;
    this.syn = Object.create(null);
    Object.keys(SYN).forEach(function (k) { self.syn[k] = SYN[k].slice(); });
    this.rewrites = [];
    (cfg.syn || []).forEach(function (group) {
      var list = (group || []).map(words).filter(Boolean);
      if (list.length < 2) return;
      var main = list[0];
      // Phrases ("speed control") are rewritten to the first entry; single words match each other both ways.
      list.forEach(function (w, i) {
        if (i && w !== main && (w.indexOf(' ') >= 0 || main.indexOf(' ') >= 0)) self.rewrites.push({ from: ' ' + w + ' ', to: ' ' + main + ' ' });
      });
      var singles = list.filter(function (w) { return w.indexOf(' ') < 0; });
      singles.forEach(function (w) {
        var k = stem(w), arr = self.syn[k] || (self.syn[k] = []);
        singles.forEach(function (o) { if (stem(o) !== k && arr.indexOf(o) < 0) arr.push(o); });
      });
    });
    this.rewrites.sort(function (a, b) { return b.from.length - a.from.length; });
    this.pins = Object.create(null);
    (cfg.pin || []).forEach(function (p) {
      var docs = [];
      (p.s || []).forEach(function (sku) {
        (self.skuExact[compact(sku)] || []).forEach(function (d) { if (docs.indexOf(d) < 0) docs.push(d); });
      });
      if (docs.length) (p.q || []).forEach(function (q) { var k = qkey(q); if (k) self.pins[k] = docs; });
    });
    this.go = Object.create(null);
    (cfg.go || []).forEach(function (g) {
      if (g && g.u) (g.q || []).forEach(function (q) { var k = qkey(q); if (k) self.go[k] = { u: g.u, t: g.t || '' }; });
    });
    this.popular = (cfg.pop || []).filter(Boolean);
  };

  Engine.prototype.rewrite = function (q) {
    if (!this.rewrites.length) return q;
    var s = ' ' + words(q) + ' ', before = s;
    this.rewrites.forEach(function (r) { s = s.split(r.from).join(r.to); });
    return s === before ? q : s.trim();
  };

  Engine.prototype.shortcut = function (q) { return this.go[qkey(q)] || null; };

  Engine.prototype.idf = function (tok) {
    return 1 + Math.log(this.N / (1 + (this.df[tok] || 0)));
  };

  Engine.prototype.prefixMatches = function (pre, limit) {
    var v = this.vocab, lo = 0, hi = v.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (v[mid] < pre) lo = mid + 1; else hi = mid; }
    var out = [];
    for (var i = lo; i < v.length && v[i].lastIndexOf(pre, 0) === 0; i++) {
      if (v[i] !== pre) out.push(v[i]);
    }
    var df = this.df;
    if (out.length > limit) out.sort(function (a, b) { return df[b] - df[a]; }).length = limit;
    return out;
  };

  Engine.prototype.fuzzy = function (t) {
    var max = t.length >= 8 ? 2 : (t.length >= 4 ? 1 : 0);
    if (!max) return [];
    var cands = [], df = this.df;
    for (var i = 0; i < this.alphaVocab.length; i++) {
      var w = this.alphaVocab[i];
      if (Math.abs(w.length - t.length) > max || w === t) continue;
      if (w[0] !== t[0] && max < 2 && w[1] !== t[1]) continue; // cheap first-letter guard
      var d = damerau(t, w, max);
      if (d <= max) cands.push({ tok: w, d: d });
    }
    cands.sort(function (a, b) { return a.d - b.d || df[b.tok] - df[a.tok]; });
    return cands.slice(0, 4);
  };

  // Build candidate tokens for one query word.
  Engine.prototype.candidates = function (raw, isLast, typing) {
    var s = stem(raw), df = this.df, out = [], seen = {};
    var self = this;
    function push(tok, q, kind) { if (df[tok] && !seen[tok]) { seen[tok] = 1; out.push({ tok: tok, q: q, kind: kind }); } }
    push(s, 1, 'exact');
    if (s !== raw) push(raw, 1, 'exact');
    (this.syn[s] || []).forEach(function (x) { push(stem(x), 0.9, 'syn'); });
    var hasDigit = /\d/.test(s);
    var exact = out.length > 0;
    // Part numbers also match their variants: tkr5070 -> tkr5070a, tkr5070hd.
    var partLike = hasDigit && /[a-z]/.test(s) && s.length >= 5;
    if ((isLast && typing && s.length >= 1) || (!exact && s.length >= 3) || partLike) {
      var limit = hasDigit ? 400 : 60;
      var typingLast = (isLast && typing) || partLike;
      this.prefixMatches(raw, typingLast ? limit : 400).forEach(function (t) {
        if (!hasDigit && !typingLast && /\d/.test(t)) return;
        if (out.length > limit) return;
        push(t, typingLast ? 0.85 : 0.7, 'prefix');
      });
    }
    var fuzzyUsed = null;
    if (!exact && !hasDigit && s.length >= 4 && out.length < 3 && !(arguments[3] && arguments[3].noFuzzy)) {
      var fz = this.fuzzy(s);
      if (fz.length) {
        // Prefer the common word: "shok" means shock far more often than shoe.
        fz.sort(function (a, b) { return a.d - b.d || df[b.tok] - df[a.tok]; });
        var topDf = df[fz[0].tok];
        fz.forEach(function (c, i) {
          var base = c.d === 1 ? 0.78 : 0.6;
          var q = i === 0 ? base : Math.max(0.12, base * Math.sqrt(df[c.tok] / topDf) * 0.8);
          push(c.tok, q, 'fuzzy');
        });
        fuzzyUsed = fz[0].tok;
      }
    }
    // Synonyms and spelling fixes never count for more than the word the customer meant.
    var ref = exact ? out[0] : (fuzzyUsed ? { tok: fuzzyUsed } : null);
    if (ref) {
      var cap = this.idf(ref.tok);
      // Longer words that merely start with what was typed (eb48 -> eb48.3) never outrank the exact word.
      out.forEach(function (c) { if (c.kind === 'syn' || c.kind === 'fuzzy' || (exact && c.kind === 'prefix')) c.cap = cap; });
    }
    return { cands: out, exact: exact, fuzzy: fuzzyUsed, stemmed: s, self: self };
  };

  Engine.prototype.parse = function (q, typing) {
    var P = prep(q);
    var raws = [];
    rawTokens(P).forEach(function (t) {
      if (t.indexOf('/') >= 0 && !/^1\/\d+$/.test(t)) t.split('/').forEach(function (p) { if (p) raws.push(p); });
      else raws.push(t);
    });
    var endsWithSpace = /\s$/.test(String(q));
    var kept = raws.filter(function (t) { return !STOP[t]; });
    if (kept.length > 1) kept = kept.filter(function (t) { return t !== 'rc'; });
    if (!kept.length) kept = raws;
    var self = this, terms = [];
    kept.forEach(function (raw, i) {
      var isLast = i === kept.length - 1 && !endsWithSpace;
      var alts = [];
      var hy = raw.indexOf('-') >= 0 ? raw.replace(/-/g, '') : null;
      // split run-together words first: hingepin -> hinge pin
      var best = null;
      if (!self.df[stem(raw)] && /^[a-z]{6,}$/.test(raw)) {
        for (var k = 3; k <= raw.length - 3; k++) {
          var a = raw.slice(0, k), b = stem(raw.slice(k));
          if (self.df[a] && self.df[b]) {
            var sc = Math.min(self.df[a], self.df[b]);
            if (!best || sc > best.sc) best = { a: a, b: b, sc: sc, label: raw.slice(0, k) + ' ' + raw.slice(k) };
          }
        }
      }
      var info = self.candidates(hy && self.df[hy] ? hy : raw, isLast, typing, { noFuzzy: !!best });
      if (info.cands.length) alts.push([info.cands]);
      if (best) alts.unshift([[{ tok: best.a, q: 0.95, kind: 'split' }], [{ tok: best.b, q: 0.95, kind: 'split' }]]);
      if (hy && !self.df[hy]) {
        var parts = raw.split('-').filter(Boolean);
        var sub = parts.map(function (p) { return self.candidates(p, false, false).cands; });
        if (sub.every(function (c) { return c.length; })) alts.push(sub);
      }
      terms.push({ raw: raw, alts: alts, exact: info.exact || !!best, fuzzy: info.fuzzy, stemmed: info.stemmed, split: best ? best.label : null });
    });
    // join neighbours that exist as one word: hobby wing -> hobbywing, tkr 5070 -> tkr5070
    for (var i = 0; i < terms.length - 1; i++) {
      var j = terms[i].raw + terms[i + 1].raw;
      if (self.df[j] || self.df[stem(j)]) {
        var tok = self.df[j] ? j : stem(j);
        var crossed = [];
        if (!self.skuExact[tok]) {
          terms[i].alts.forEach(function (A) {
            terms[i + 1].alts.forEach(function (B) { crossed.push(A.concat(B)); });
          });
        }
        terms.splice(i, 2, {
          raw: terms[i].raw + ' ' + terms[i + 1].raw,
          alts: [[[{ tok: tok, q: 1, kind: 'join' }]]].concat(crossed),
          exact: true, fuzzy: null, stemmed: tok
        });
      }
    }
    return { P: P, terms: terms };
  };

  Engine.prototype.scoreTerm = function (term) {
    var self = this, best = new Map();
    term.alts.forEach(function (alt) {
      var acc = null;
      alt.forEach(function (sub) {
        var m = new Map();
        sub.forEach(function (c) {
          var p = self.post[c.tok];
          if (!p) return;
          var idf = self.idf(c.tok);
          if (c.cap && c.cap < idf) idf = c.cap;
          for (var d in p) {
            var sc = c.q * fieldWeight(p[d]) * idf;
            var di = +d;
            var cur = m.get(di);
            if (cur === undefined || sc > cur.s) m.set(di, { s: sc, mask: p[d] });
          }
        });
        if (acc === null) acc = m;
        else {
          var next = new Map();
          acc.forEach(function (v, d) { var o = m.get(d); if (o) next.set(d, { s: v.s + o.s, mask: v.mask & o.mask }); });
          acc = next;
        }
      });
      if (acc) acc.forEach(function (v, d) {
        var cur = best.get(d);
        if (!cur || v.s > cur.s) best.set(d, v);
      });
    });
    return best;
  };

  Engine.prototype.search = function (q, opts) {
    opts = opts || {};
    var res = { q: q, hits: [], exactSku: null, corrected: null, partial: false, terms: [] };
    var cq = compact(q);
    if (!cq) return res;
    var key = qkey(q);
    res.go = this.go[key] || null;
    var pq = this.rewrite(q);
    var parsed = this.parse(pq, !!opts.typing);
    var terms = parsed.terms;
    res.terms = terms;
    if (!terms.length) return res;
    var self = this;
    var maps = terms.map(function (t) { return self.scoreTerm(t); });

    var scores = new Map();
    var order = maps.map(function (m, i) { return i; }).sort(function (a, b) { return maps[a].size - maps[b].size; });
    if (maps[order[0]].size) {
      maps[order[0]].forEach(function (v, d) { scores.set(d, { s: v.s, nameAll: !!(v.mask & FIELD.NAME), matched: 1 }); });
      for (var k = 1; k < order.length; k++) {
        var m = maps[order[k]], next = new Map();
        scores.forEach(function (v, d) {
          var o = m.get(d);
          if (o) next.set(d, { s: v.s + o.s, nameAll: v.nameAll && !!(o.mask & FIELD.NAME), matched: v.matched + 1 });
        });
        scores = next;
      }
    }

    if (!scores.size && terms.length > 1) {
      // Close matches: most of the words match.
      res.partial = true;
      var need = Math.max(1, terms.length - 1);
      // Keep the most specific word ("skid" in "eb48 2.2 skid plate"); only vaguer words may be dropped.
      var weights = terms.map(function (t) {
        var w = 0;
        t.alts.forEach(function (alt) { alt.forEach(function (sub) { sub.forEach(function (c) {
          if (!self.df[c.tok]) return;
          var x = self.idf(c.tok); if (c.cap && c.cap < x) x = c.cap; if (x > w) w = x;
        }); }); });
        return w;
      });
      // Prefer a real word over a number or spec ("gens ace 2300" keeps "gens", not "2300").
      var wordy = terms.map(function (t, i) { return weights[i] > 0 && /^[a-z]+$/.test(t.stemmed || t.raw); });
      var anyWord = wordy.some(Boolean);
      var must = -1;
      weights.forEach(function (w, i) { if ((!anyWord || wordy[i]) && (must < 0 || w > weights[must])) must = i; });
      if (must < 0) must = 0;
      var tally = new Map();
      maps.forEach(function (m, i) {
        m.forEach(function (v, d) {
          var t = tally.get(d) || { s: 0, matched: 0, nameAll: true, bits: 0 };
          t.s += v.s; t.matched++; t.nameAll = t.nameAll && !!(v.mask & FIELD.NAME); t.bits |= (1 << i);
          tally.set(d, t);
        });
      });
      tally.forEach(function (v, d) { if (v.matched >= need && (v.bits & (1 << must))) scores.set(d, v); });
    }

    // Auto-correct notice when a word only matched through a spelling fix.
    var fixed = false;
    var corr = terms.map(function (t) {
      if (t.split) { fixed = true; return t.split; }
      if (!t.exact && t.fuzzy && !/\d/.test(t.raw)) { fixed = true; return self.surface[t.fuzzy] || t.fuzzy; }
      return t.raw;
    });
    if (fixed && scores.size) res.corrected = corr.join(' ');

    var exactDocs = this.skuExact[cq] || [];
    var qn = parsed.P.replace(/[^a-z0-9.\/]+/g, ' ').replace(/\brc\b/g, ' ').replace(/\s+/g, ' ').trim();
    var kitIntent = /\bkits?\b/.test(qn);
    var items = this.items;
    var hits = [];
    scores.forEach(function (v, d) {
      var it = items[d];
      var s = v.s;
      if (v.nameAll) s *= 1.25;
      if (qn.length > 2 && it._name.indexOf(' ' + qn) >= 0) s += 25 + (it._name.lastIndexOf(' ' + qn, 0) === 0 ? 10 : 0);
      if (kitIntent && (it.f & 1)) s += 60;
      else if ((it.f & 1) && v.nameAll) s += 70;
      else if (it.f & 1) s += 3;
      s *= it.q > 0 ? 1.08 : 0.94;
      if (v.matched && terms.length > 1 && v.matched < terms.length) s *= 0.6;
      if (exactDocs.indexOf(d) >= 0) s += 100000;
      hits.push({ it: it, s: s });
    });
    hits.sort(function (a, b) {
      return (b.s - a.s) || ((b.it.f & 1) - (a.it.f & 1)) || ((b.it.q > 0) - (a.it.q > 0)) || ((b.it.d || 0) - (a.it.d || 0)) || (a.it.n < b.it.n ? -1 : 1);
    });
    res.hits = hits.map(function (h) { return h.it; });

    // Pinned results from the settings sheet go first, in the order listed.
    var pin = this.pins[key] || (pq !== q && this.pins[qkey(pq)]);
    if (pin) {
      var pinned = pin.map(function (d) { return items[d]; });
      res.hits = pinned.concat(res.hits.filter(function (it) { return pinned.indexOf(it) < 0; }));
      res.pinned = pinned.length;
    }

    var ex = this.skuExact[cq];
    if (ex && ex.length === 1) res.exactSku = items[ex[0]];
    return res;
  };

  // Words in a product name that the query matched, for highlighting.
  Engine.prototype.matchSet = function (res) {
    var set = { exact: Object.create(null), prefix: [] };
    (res.terms || []).forEach(function (t) {
      t.alts.forEach(function (alt) {
        alt.forEach(function (sub) {
          sub.forEach(function (c) {
            set.exact[c.tok] = 1;
          });
        });
      });
      if (t.raw && !/\s/.test(t.raw)) set.prefix.push(stem(t.raw));
    });
    return set;
  };

  /* =====================================================================
   * 3. HELPERS
   * ===================================================================== */

  var CFG = {};
  var DEFAULTS = {
    indexUrl: '',
    inputSelector: '#searchlight, input[name="k"]',
    resultsPath: '/search.html',
    queryParam: 'k',
    resultsMount: '#frcs-results',
    spa: false,
    phone: '708-737-7615',
    hours: 'M–F 8am–5pm CST',
    contactUrl: '/contact_us.asp',
    popular: ['Tekno', 'EB48 2.2', 'NB48 2.2', 'EB410', 'Bearings', 'Servo', 'Hobbywing', 'Mugen', 'B7', 'Gens Ace'],
    perPage: 24,
    dropdownMax: 7,
    mobileBreakpoint: 768,
    fonts: false
  };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    n = Number(n) || 0;
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function isMobile() { return root.matchMedia && root.matchMedia('(max-width: ' + (CFG.mobileBreakpoint - 1) + 'px)').matches; }
  function track(name, params) { try { if (typeof root.gtag === 'function') root.gtag('event', name, params || {}); } catch (e) { } }
  function store(key, val) {
    try {
      if (val === undefined) { var v = root.localStorage.getItem(key); return v ? JSON.parse(v) : null; }
      root.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  function isSale(it) { return !!(it.o && it.x > 0 && it.x < it.p); }
  function finalPrice(it) { return isSale(it) ? it.x : it.p; }
  // On sale: compare against the regular price. Otherwise show the retail price, if higher.
  function compareAt(it) {
    var ref = isSale(it) ? it.p : (it.r || 0);
    return ref > finalPrice(it) + 0.004 ? ref : 0;
  }
  function savePct(it) { return isSale(it) ? Math.round((1 - it.x / it.p) * 100) : 0; }
  function imgUrl(it) {
    var i = it.t || it.i;
    if (!i) return '';
    if (/^https?:|^\/\//.test(i)) return i;
    return '/' + String(i).replace(/^\/+/, '');
  }
  function productUrl(it) {
    var u = it.u || '';
    if (/^https?:|^\/\//.test(u)) return u;
    return '/' + u.replace(/^\/+/, '');
  }
  function bigImgUrl(it) {
    var i = it.i || it.t;
    if (!i) return '';
    if (/^https?:|^\/\//.test(i)) return i;
    return '/' + String(i).replace(/^\/+/, '');
  }
  function resultsUrl(q, extra) {
    var u = CFG.resultsPath + '?' + CFG.queryParam + '=' + encodeURIComponent(q);
    if (extra) u += '&' + extra;
    return u;
  }

  var ICON = {
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.2L20.6 8H6.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="19.5" r="1.5" fill="currentColor"/><circle cx="17" cy="19.5" r="1.5" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3h3l1.6 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L21 14.4v3A2.6 2.6 0 0 1 18.4 20 15.4 15.4 0 0 1 4 5.6 2.6 2.6 0 0 1 6.6 3z" fill="currentColor"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* =====================================================================
   * 4. SHARED RENDER PIECES
   * ===================================================================== */

  var engine = null;
  var loading = null;

  function highlight(name, ms) {
    if (!ms) return esc(name);
    return String(name).split(/([A-Za-z0-9][A-Za-z0-9.\-]*)/).map(function (part, i) {
      if (i % 2 === 0) return esc(part);
      var low = deaccent(part.toLowerCase());
      var st = stem(low.replace(/[.\-]+$/, ''));
      var hit = ms.exact[st] || ms.exact[low] || ms.prefix.some(function (p) { return p.length >= 2 && st.lastIndexOf(p, 0) === 0; });
      return hit ? '<mark>' + esc(part) + '</mark>' : esc(part);
    }).join('');
  }

  function stockHtml(it, cls) {
    var on = it.q > 0;
    return '<span class="' + cls + ' ' + (on ? 'is-in' : 'is-out') + '">' + (on ? 'In Stock.' : 'Out of Stock.') + '</span>';
  }

  // Same as the store's own cards: one price, and on sale the red price with the regular price crossed out.
  function priceHtml(it, cls) {
    var sale = isSale(it), pct = savePct(it);
    var h = '<span class="' + cls + (sale ? ' is-sale' : '') + '"><b>' + money(finalPrice(it)) + '</b>';
    if (sale) h += '<s>' + money(it.p) + '</s>' + (pct >= 3 ? '<em>Save ' + pct + '%</em>' : '');
    return h + '</span>';
  }

  // Add To Cart, done the same way as the store's category pages (theme functions get_product / add_to_cart).
  root.FRCS_added = function (el, data) {
    if (typeof root.addcart_callback === 'function') { try { root.addcart_callback(el, data); return; } catch (e) { } }
    el.classList.add('ajaxcart-complete');
    setTimeout(function () { el.classList.remove('ajaxcart-complete'); }, 1200);
  };
  function addToCart(it, card) {
    if (!it || !card) return;
    if (typeof root.get_product !== 'function' || typeof root.add_to_cart !== 'function' || !root.jQuery) { root.location.href = productUrl(it); return; }
    if (card.classList.contains('ajaxcart-loading')) return;
    card.classList.add('ajaxcart-loading');
    track('add_to_cart', { currency: 'USD', value: finalPrice(it), items: [{ item_id: it.s || String(it.c), item_name: it.n, price: finalPrice(it), quantity: 1 }] });
    setTimeout(function () {
      var t = null;
      try { t = root.get_product(it.c, 0); } catch (e) { }
      if (!t) { root.location.href = productUrl(it); return; }
      var link = t.ProductLink ? (/^https?:\/\//.test(t.ProductLink) ? t.ProductLink : '/' + t.ProductLink) : productUrl(it);
      var stock = parseInt(t.Stock, 10), inv = parseInt(t.InventoryControl, 10), invAll = parseInt(t.InventoryControlGlobal, 10);
      if (stock <= 0 && (inv !== -1 ? inv === 3 : invAll === 3)) { root.location.href = '/product.asp?itemid=' + it.c; return; }
      var hasOpts = false;
      try { hasOpts = !!(t.OptionSetList && JSON.parse(t.OptionSetList).length > 0); } catch (e) { }
      var needsPage = hasOpts || t.IsOptionRequiredForCategory || t.HasCategoryWideProductOptions;
      var qv = typeof root.isQuickviewEnabled === 'function' && root.isQuickviewEnabled();
      if (needsPage && qv && typeof root.quickview === 'function') { root.quickview('/product.asp?lt_c=1&itemid=' + it.c + '&qv=1'); card.classList.remove('ajaxcart-loading'); return; }
      if (needsPage) { root.location.href = link; return; }
      root.add_to_cart(t.CatalogID, t.SKU, 0, t.Price, 1, [], false, card);
    }, 30);
  }

  function specialOrderHtml(q) {
    return '<div class="frcs-so">' +
      '<div class="frcs-so-ico">' + ICON.phone + '</div>' +
      '<div class="frcs-so-txt"><strong>Can’t find it? We special order.</strong>' +
      '<span>If the manufacturer makes it, we can usually get it. Call <b>' + esc(CFG.phone) + '</b> (' + esc(CFG.hours) + ') or send us the part number.</span></div>' +
      '<a class="frcs-so-btn" href="' + esc(CFG.contactUrl) + '">Ask about a part</a>' +
      '</div>';
  }

  function recentList() { return store('frcs_recent') || []; }
  function pushRecent(q) {
    q = String(q || '').trim();
    if (!q) return;
    var r = recentList().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
    r.unshift(q);
    store('frcs_recent', r.slice(0, 6));
  }

  function facetCounts(items, key) {
    var m = new Map();
    items.forEach(function (it) {
      var vals = key === 'b' ? (it.b != null ? [it.b] : []) : (it[key] || []);
      vals.forEach(function (v) { m.set(v, (m.get(v) || 0) + 1); });
    });
    return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; });
  }

  function catLabel(ci) {
    var c = engine.cats[ci] || '';
    return String(c).split('>').pop().trim();
  }
  function vehLabel(vi) { return engine.veh[vi] || ''; }

  /* =====================================================================
   * 5. DROPDOWN (desktop) AND SEARCH SHEET (phone)
   * ===================================================================== */

  var dd = null;       // desktop panel element
  var sheet = null;    // phone sheet element
  var activeInput = null;
  var lastRes = null;
  var activeIdx = -1;

  function ensureDropdown() {
    if (dd) return dd;
    dd = document.createElement('div');
    dd.className = 'frcs frcs-dd';
    dd.setAttribute('role', 'listbox');
    dd.hidden = true;
    document.body.appendChild(dd);
    dd.addEventListener('mousedown', function (e) { e.preventDefault(); });
    dd.addEventListener('click', onPanelClick);
    dd.addEventListener('mousemove', function (e) {
      var row = e.target.closest('[data-idx]');
      if (row) setActive(+row.getAttribute('data-idx'), false);
    });
    root.addEventListener('resize', positionDropdown);
    root.addEventListener('scroll', positionDropdown, { passive: true });
    return dd;
  }

  function positionDropdown() {
    if (!dd || dd.hidden || !activeInput) return;
    var r = activeInput.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var w = Math.min(dd.classList.contains('is-compact') ? 600 : 860, vw - 24);
    var left = Math.max(12, Math.min(r.left - 40, vw - w - 12));
    dd.style.width = w + 'px';
    dd.style.left = left + 'px';
    dd.style.top = (r.bottom + 8) + 'px';
    dd.style.maxHeight = Math.max(280, root.innerHeight - r.bottom - 24) + 'px';
  }

  function rowHtml(it, i, ms, exact) {
    var img = imgUrl(it);
    return '<div class="frcs-item' + (exact ? ' is-exact' : '') + '" data-addcart-callback="FRCS_added">' +
      '<a class="frcs-row' + (exact ? ' is-exact' : '') + '" href="' + esc(productUrl(it)) + '" data-idx="' + i + '" role="option" id="frcs-opt-' + i + '">' +
      '<span class="frcs-thumb">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') + '</span>' +
      '<span class="frcs-row-main">' +
      (exact ? '<span class="frcs-exact-tag">' + ICON.bolt + 'Exact part match</span>' : '') +
      '<span class="frcs-row-name">' + highlight(it.n, ms) + '</span>' +
      '<span class="frcs-row-meta">' +
      (it.s ? '<span class="frcs-sku">' + esc(it.s) + '</span>' : '') +
      (it.b != null && engine.brands[it.b] ? '<span class="frcs-brand">' + esc(engine.brands[it.b]) + '</span>' : '') +
      starsHtml(it, 'frcs-row-stars') +
      stockHtml(it, 'frcs-stock') +
      '</span></span>' +
      priceHtml(it, 'frcs-row-price') +
      '</a>' +
      '<button type="button" class="frcs-row-cart" data-rowcart="' + i + '" aria-label="Add ' + esc(it.n) + ' to cart">' +
      '<span class="frcs-cart-txt">' + ICON.cart + 'Add to cart</span><span class="frcs-cart-busy">Adding\u2026</span><span class="frcs-cart-done">' + ICON.check + 'Added</span></button>' +
      '</div>';
  }

  function panelBodyHtml(q, res, mobile) {
    var ms = res ? engine.matchSet(res) : null;
    var h = '';
    if (!q) {
      var rec = recentList();
      h += '<div class="frcs-empty">';
      if (rec.length) {
        h += '<div class="frcs-group"><div class="frcs-label">Recent searches</div><div class="frcs-chips">' +
          rec.map(function (r) { return '<button type="button" class="frcs-chip is-recent" data-q="' + esc(r) + '">' + ICON.clock + esc(r) + '</button>'; }).join('') +
          '</div></div>';
      }
      h += '<div class="frcs-group"><div class="frcs-label">Popular right now</div><div class="frcs-chips">' +
        CFG.popular.map(function (p) { return '<button type="button" class="frcs-chip" data-q="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') +
        '</div></div>';
      h += '<p class="frcs-tip">Tip: type a part number like <b>TKR5070</b> to jump straight to it.</p>';
      h += '</div>';
      return { html: h, rows: [] };
    }
    var goRow = res.go ? '<a class="frcs-go" href="' + esc(res.go.u) + '">' + ICON.arrow + '<span>' + esc(res.go.t || 'Go to the ' + q + ' page') + '</span></a>' : '';
    if (!res.hits.length) {
      h += goRow + '<div class="frcs-none">';
      h += '<div class="frcs-none-title">No parts match “' + esc(q) + '”</div>';
      h += '<div class="frcs-none-sub">Check the spelling, try fewer words, or search by part number.</div>';
      h += specialOrderHtml(q);
      h += '</div>';
      return { html: h, rows: [] };
    }
    var max = mobile ? 12 : CFG.dropdownMax;
    var rows = res.hits.slice(0, max);
    var exact = res.exactSku;
    if (exact && rows[0] !== exact) { rows = [exact].concat(rows.filter(function (r) { return r !== exact; })).slice(0, max); }

    var brands = facetCounts(res.hits, 'b').slice(0, 4);
    var cats = facetCounts(res.hits, 'k').slice(0, 4);
    var vehs = facetCounts(res.hits, 'v').slice(0, 4);

    var side = '';
    if (brands.length > 1 || cats.length) {
      if (brands.length > 1) {
        side += '<div class="frcs-group"><div class="frcs-label">Brands</div>' +
          brands.map(function (b) {
            return '<button type="button" class="frcs-link" data-q="' + esc(q) + '" data-brand="' + esc(engine.brands[b[0]]) + '"><span>' + esc(engine.brands[b[0]]) + '</span><i>' + b[1] + '</i></button>';
          }).join('') + '</div>';
      }
      if (vehs.length > 1) {
        side += '<div class="frcs-group"><div class="frcs-label">Fits</div>' +
          vehs.map(function (v) {
            return '<button type="button" class="frcs-link" data-q="' + esc(q) + '" data-fit="' + v[0] + '"><span title="' + esc(vehLabel(v[0])) + '">' + esc(vehLabel(v[0])) + '</span><i>' + v[1] + '</i></button>';
          }).join('') + '</div>';
      }
      if (cats.length) {
        side += '<div class="frcs-group"><div class="frcs-label">Categories</div>' +
          cats.map(function (c) {
            return '<button type="button" class="frcs-link" data-q="' + esc(q) + '" data-cat="' + c[0] + '"><span>' + esc(catLabel(c[0])) + '</span><i>' + c[1] + '</i></button>';
          }).join('') + '</div>';
      }
    }

    var head = '<div class="frcs-list-head"><span class="frcs-label">Products</span><span class="frcs-count">' +
      res.hits.length.toLocaleString() + (res.hits.length === 1 ? ' match' : ' matches') + '</span></div>';
    var notice = '';
    if (res.corrected) notice = '<div class="frcs-notice">Showing results for <b>' + esc(res.corrected) + '</b></div>';
    else if (res.partial && !res.pinned) notice = '<div class="frcs-notice">No exact match. Showing close matches.</div>';

    var list = rows.map(function (it, i) { return rowHtml(it, i, ms, it === exact); }).join('');

    if (mobile) {
      var n = res.hits.length.toLocaleString();
      var filterBtn = '<button type="button" class="frcs-sheet-filter" data-allfilters="1" data-q="' + esc(q) + '">' + ICON.filter +
        '<span class="frcs-sf-txt"><b>Filter &amp; sort ' + (res.hits.length === 1 ? 'this result' : 'these ' + n + ' results') + '</b>' +
        '<small>Brand \u00b7 Fits vehicle \u00b7 Price \u00b7 In stock</small></span>' + ICON.arrow + '</button>';
      var chips = brands.length > 1 ? '<div class="frcs-label frcs-chips-label">Brands</div><div class="frcs-chips is-scroll">' +
        brands.map(function (b) {
          return '<button type="button" class="frcs-chip" data-q="' + esc(q) + '" data-brand="' + esc(engine.brands[b[0]]) + '">' + esc(engine.brands[b[0]]) + ' <i>' + b[1] + '</i></button>';
        }).join('') + '</div>' : '';
      h = goRow + notice + filterBtn + chips + head + '<div class="frcs-list">' + list + '</div>';
    } else {
      h = '<div class="frcs-dd-main' + (side ? '' : ' no-side') + '">' +
        (side ? '<div class="frcs-side">' + side + '</div>' : '') +
        '<div class="frcs-main">' + goRow + notice + head + '<div class="frcs-list">' + list + '</div></div>' +
        '</div>';
    }
    return { html: h, rows: rows };
  }

  function footHtml(q, res, mobile) {
    if (!q || !res || !res.hits.length) return '';
    var n = res.hits.length;
    var btn = '<a class="frcs-all" href="' + esc(resultsUrl(q)) + '" data-all="1">See all ' + n.toLocaleString() + ' results' + ICON.arrow + '</a>';
    if (mobile) return '<div class="frcs-sheet-foot">' + btn + '</div>';
    return '<div class="frcs-dd-foot">' + btn +
      '<span class="frcs-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</span></div>';
  }

  var currentRows = [];

  function renderPanel(q) {
    var mobile = !!(sheet && !sheet.hidden);
    var res = q ? engine.search(q, { typing: true }) : null;
    lastRes = res;
    var body = panelBodyHtml(q, res, mobile);
    currentRows = body.rows;
    activeIdx = -1;
    if (mobile) {
      $('.frcs-sheet-body', sheet).innerHTML = body.html;
      var f = $('.frcs-sheet-foot-wrap', sheet);
      f.innerHTML = footHtml(q, res, true);
      $('.frcs-sheet-body', sheet).scrollTop = 0;
    } else {
      ensureDropdown();
      dd.innerHTML = body.html + footHtml(q, res, false);
      dd.classList.toggle('is-compact', !q || !res.hits.length);
      dd.hidden = false;
      positionDropdown();
      if (activeInput) activeInput.setAttribute('aria-expanded', 'true');
    }
  }

  function setActive(i, scroll) {
    var host = sheet && !sheet.hidden ? sheet : dd;
    if (!host) return;
    $$('.frcs-row', host).forEach(function (r) { r.classList.toggle('is-active', +r.getAttribute('data-idx') === i); });
    activeIdx = i;
    if (activeInput) activeInput.setAttribute('aria-activedescendant', i >= 0 ? 'frcs-opt-' + i : '');
    if (scroll && i >= 0) { var el = $('#frcs-opt-' + i, host); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
  }

  function hidePanel() {
    if (dd) dd.hidden = true;
    if (activeInput) activeInput.setAttribute('aria-expanded', 'false');
  }

  function goToProduct(it, q, how) {
    track('select_item', { item_list_name: 'search', items: [{ item_id: it.s || String(it.c), item_name: it.n }], search_term: q, method: how });
    pushRecent(q);
    root.location.href = productUrl(it);
  }

  function submitSearch(q, extra) {
    q = String(q || '').trim();
    if (!q) return;
    pushRecent(q);
    track('search', { search_term: q });
    var go = !extra && engine.shortcut(q);
    if (go) {
      track('search_shortcut', { search_term: q, link_url: go.u });
      root.location.href = go.u;
      return;
    }
    var res = engine.search(q);
    if (res.exactSku && !extra) {
      track('search_part_number_jump', { search_term: q, item_id: res.exactSku.s });
      root.location.href = productUrl(res.exactSku);
      return;
    }
    if (CFG.spa) {
      hidePanel(); closeSheet();
      var u = resultsUrl(q, extra);
      try { root.history.pushState({ frcs: 1 }, '', u); } catch (e) { }
      renderResultsPage();
      root.scrollTo(0, 0);
      return;
    }
    root.location.href = resultsUrl(q, extra);
  }

  function onPanelClick(e) {
    var t = e.target.closest('[data-rowcart], [data-q], [data-idx], [data-all], .frcs-x');
    if (!t) return;
    if (t.classList.contains('frcs-x')) { e.preventDefault(); closeSheet(); return; }
    var q = activeInput ? activeInput.value : '';
    if (t.hasAttribute('data-rowcart')) {
      e.preventDefault();
      var ci = currentRows[+t.getAttribute('data-rowcart')];
      if (ci) { pushRecent(q); addToCart(ci, t.closest('.frcs-item')); }
      return;
    }
    if (t.hasAttribute('data-idx')) {
      e.preventDefault();
      var it = currentRows[+t.getAttribute('data-idx')];
      if (it) goToProduct(it, q, 'click');
      return;
    }
    if (t.hasAttribute('data-all')) { e.preventDefault(); submitSearch(q); return; }
    if (t.hasAttribute('data-allfilters')) { e.preventDefault(); submitSearch(t.getAttribute('data-q'), 'filters=1'); return; }
    if (t.hasAttribute('data-brand')) { e.preventDefault(); submitSearch(t.getAttribute('data-q'), 'brand=' + encodeURIComponent(t.getAttribute('data-brand'))); return; }
    if (t.hasAttribute('data-cat')) { e.preventDefault(); submitSearch(t.getAttribute('data-q'), 'cat=' + encodeURIComponent(t.getAttribute('data-cat'))); return; }
    if (t.hasAttribute('data-fit')) { e.preventDefault(); submitSearch(t.getAttribute('data-q'), 'fit=' + encodeURIComponent(t.getAttribute('data-fit'))); return; }
    if (t.hasAttribute('data-q')) {
      e.preventDefault();
      var val = t.getAttribute('data-q');
      if (activeInput) { activeInput.value = val; activeInput.focus(); }
      renderPanel(val);
    }
  }

  function onKey(e) {
    var host = sheet && !sheet.hidden ? sheet : dd;
    var open = host && !host.hidden;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault(); setActive(Math.min(currentRows.length - 1, activeIdx + 1), true);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault(); setActive(Math.max(-1, activeIdx - 1), true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIdx >= 0 && currentRows[activeIdx]) goToProduct(currentRows[activeIdx], e.target.value, 'keyboard');
      else submitSearch(e.target.value);
    } else if (e.key === 'Escape') {
      hidePanel(); closeSheet();
    }
  }

  var onInput = debounce(function () { if (engine && activeInput) renderPanel(activeInput.value.trim() ? activeInput.value : ''); }, 60);

  // Phone search sheet
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'frcs frcs-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Search products');
    sheet.hidden = true;
    sheet.innerHTML =
      '<form class="frcs-sheet-bar" role="search" action="' + esc(CFG.resultsPath) + '">' +
      '<label class="frcs-sheet-field">' + ICON.search +
      '<input type="search" name="' + esc(CFG.queryParam) + '" id="frcs-sheet-input" placeholder="Search parts, kits or part #" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search products"></label>' +
      '<button type="button" class="frcs-x">Cancel</button>' +
      '</form>' +
      '<div class="frcs-sheet-body"></div>' +
      '<div class="frcs-sheet-foot-wrap"></div>';
    document.body.appendChild(sheet);
    var inp = $('#frcs-sheet-input', sheet);
    inp.addEventListener('input', function () { activeInput = inp; onInput(); });
    inp.addEventListener('keydown', onKey);
    $('form', sheet).addEventListener('submit', function (e) { e.preventDefault(); submitSearch(inp.value); });
    sheet.addEventListener('click', onPanelClick);
    return sheet;
  }

  var sheetPrevInput = null;
  function openSheet(fromInput) {
    ensureSheet();
    sheetPrevInput = fromInput;
    var inp = $('#frcs-sheet-input', sheet);
    inp.value = fromInput ? fromInput.value : '';
    sheet.hidden = false;
    document.documentElement.classList.add('frcs-lock');
    activeInput = inp;
    inp.focus();
    whenReady(function () { renderPanel(inp.value.trim() ? inp.value : ''); });
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.documentElement.classList.remove('frcs-lock');
    if (sheetPrevInput) sheetPrevInput.value = $('#frcs-sheet-input', sheet).value;
    activeInput = sheetPrevInput;
  }

  function bindInput(inp) {
    if (inp.__frcs) return;
    inp.__frcs = 1;
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-expanded', 'false');
    if (!inp.getAttribute('placeholder') || /^search$/i.test(inp.getAttribute('placeholder'))) inp.setAttribute('placeholder', 'Search parts, kits or part #');
    function maybeSheet(e) {
      if (!isMobile()) return false;
      e.preventDefault();
      inp.blur();
      openSheet(inp);
      return true;
    }
    inp.addEventListener('touchend', function (e) { maybeSheet(e); }, { passive: false });
    inp.addEventListener('focus', function (e) {
      if (isMobile()) { if (!sheet || sheet.hidden) { inp.blur(); openSheet(inp); } return; }
      activeInput = inp;
      whenReady(function () { renderPanel(inp.value.trim() ? inp.value : ''); });
    });
    inp.addEventListener('input', function () { activeInput = inp; onInput(); });
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== inp) hidePanel(); }, 120); });
    var form = inp.form;
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submitSearch(inp.value); });
  }

  if (typeof document !== 'undefined') document.addEventListener('mousedown', function (e) {
    if (!dd || dd.hidden) return;
    if (dd.contains(e.target) || (activeInput && activeInput.contains(e.target))) return;
    hidePanel();
  });

  /* =====================================================================
   * 6. RESULTS PAGE
   * ===================================================================== */

  var RP = { state: null, res: null, el: null };
  var PRICE_BUCKETS = [[0, 10], [10, 25], [25, 50], [50, 100], [100, 250], [250, 1e9]];

  function readState() {
    var p = new URLSearchParams(root.location.search);
    var s = {
      q: p.get(CFG.queryParam) || '',
      brand: p.getAll('brand'),
      cat: p.getAll('cat').map(Number).filter(function (n) { return !isNaN(n); }),
      fit: p.getAll('fit').map(Number).filter(function (n) { return !isNaN(n); }),
      stock: p.get('stock') === '1',
      sale: p.get('sale') === '1',
      price: p.get('price') || '',
      sort: p.get('sort') || 'best',
      openFilters: p.get('filters') === '1',
      shown: CFG.perPage
    };
    return s;
  }

  function writeState(s) {
    var p = new URLSearchParams();
    p.set(CFG.queryParam, s.q);
    s.brand.forEach(function (b) { p.append('brand', b); });
    s.cat.forEach(function (c) { p.append('cat', c); });
    s.fit.forEach(function (c) { p.append('fit', c); });
    if (s.stock) p.set('stock', '1');
    if (s.sale) p.set('sale', '1');
    if (s.price) p.set('price', s.price);
    if (s.sort && s.sort !== 'best') p.set('sort', s.sort);
    try { root.history.replaceState(root.history.state, '', root.location.pathname + '?' + p.toString()); } catch (e) { }
  }

  function inBucket(it, key) {
    if (!key) return true;
    var b = key.split('-').map(Number);
    var fp = finalPrice(it);
    return fp >= b[0] && fp < b[1];
  }

  function applyFilters(hits, s, skip) {
    var brandIdx = s.brand.map(function (b) { return engine.brands.indexOf(b); }).filter(function (i) { return i >= 0; });
    return hits.filter(function (it) {
      if (skip !== 'brand' && brandIdx.length && brandIdx.indexOf(it.b) < 0) return false;
      if (skip !== 'cat' && s.cat.length && !(it.k || []).some(function (c) { return s.cat.indexOf(c) >= 0; })) return false;
      if (skip !== 'fit' && s.fit.length && !(it.v || []).some(function (c) { return s.fit.indexOf(c) >= 0; })) return false;
      if (skip !== 'stock' && s.stock && !(it.q > 0)) return false;
      if (skip !== 'sale' && s.sale && !isSale(it)) return false;
      if (skip !== 'price' && s.price && !inBucket(it, s.price)) return false;
      return true;
    });
  }

  function sortHits(list, sort) {
    var a = list.slice();
    if (sort === 'price-asc') a.sort(function (x, y) { return finalPrice(x) - finalPrice(y); });
    else if (sort === 'price-desc') a.sort(function (x, y) { return finalPrice(y) - finalPrice(x); });
    else if (sort === 'name') a.sort(function (x, y) { return x.n.localeCompare(y.n); });
    else if (sort === 'stock') a.sort(function (x, y) { return (y.q > 0) - (x.q > 0); });
    else if (sort === 'new') a.sort(function (x, y) { return (y.d || 0) - (x.d || 0); });
    return a;
  }

  // Review stars from the store's product reviews. Cards always keep the row so prices and buttons stay level.
  function starsHtml(it, cls) {
    if (!it.rn) return cls === 'frcs-card-stars' ? '<div class="frcs-stars frcs-card-stars is-empty"></div>' : '';
    var pct = Math.max(0, Math.min(100, (it.ra / 5) * 100));
    var label = 'Rated ' + it.ra + ' out of 5 from ' + it.rn + (it.rn === 1 ? ' review' : ' reviews');
    return '<span class="frcs-stars ' + cls + '" role="img" aria-label="' + label + '" title="' + label + '">' +
      '<span class="frcs-stars-bg" aria-hidden="true">\u2605\u2605\u2605\u2605\u2605<span class="frcs-stars-fg" style="width:' + pct.toFixed(0) + '%">\u2605\u2605\u2605\u2605\u2605</span></span>' +
      '<span class="frcs-stars-n" aria-hidden="true">' + (Math.round(it.ra * 10) / 10).toFixed(1) + ' (' + it.rn + ')</span></span>';
  }

  function cardHtml(it, ms) {
    var img = bigImgUrl(it);
    return '<article class="frcs-card' + (it.q > 0 ? '' : ' is-out') + '" data-addcart-callback="FRCS_added">' +
      '<a class="frcs-card-img" href="' + esc(productUrl(it)) + '" data-pid="' + it._i + '" tabindex="-1" aria-hidden="true">' +
      (img ? '<img src="' + esc(img) + '" alt="' + esc(it.n) + '" loading="lazy">' : '') +
      (isSale(it) ? '<span class="frcs-tag">Sale</span>' : '') +
      '</a>' +
      '<div class="frcs-card-body">' +
      '<a class="frcs-card-name" href="' + esc(productUrl(it)) + '" data-pid="' + it._i + '">' + highlight(it.n, ms) + '</a>' +
      (it.s ? '<div class="frcs-card-sku">Part #: ' + esc(it.s) + '</div>' : '') +
      starsHtml(it, 'frcs-card-stars') +
      priceHtml(it, 'frcs-card-price') +
      stockHtml(it, 'frcs-card-stock') +
      '<button type="button" class="frcs-cart" data-cart="' + it._i + '" aria-label="Add ' + esc(it.n) + ' to cart">' +
      '<span class="frcs-cart-txt">Add To Cart</span><span class="frcs-cart-busy">Adding\u2026</span><span class="frcs-cart-done">' + ICON.check + 'Added</span></button>' +
      '</div></article>';
  }

  function checkRow(name, value, label, count, checked) {
    return '<label class="frcs-check' + (count ? '' : ' is-zero') + '">' +
      '<input type="checkbox" name="' + name + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="frcs-box">' + ICON.check + '</span>' +
      '<span class="frcs-check-label">' + esc(label) + '</span><i>' + count + '</i></label>';
  }

  function facetsHtml(s, hits) {
    var h = '';
    // Availability and deals
    var stockN = applyFilters(hits, s, 'stock').filter(function (it) { return it.q > 0; }).length;
    var saleN = applyFilters(hits, s, 'sale').filter(isSale).length;
    h += '<div class="frcs-facet"><div class="frcs-facet-title">Show</div>' +
      '<label class="frcs-switch"><input type="checkbox" name="stock" value="1"' + (s.stock ? ' checked' : '') + '><span class="frcs-track"><span></span></span><span class="frcs-switch-label">In stock only</span><i>' + stockN + '</i></label>' +
      (saleN || s.sale ? '<label class="frcs-switch"><input type="checkbox" name="sale" value="1"' + (s.sale ? ' checked' : '') + '><span class="frcs-track"><span></span></span><span class="frcs-switch-label">On sale</span><i>' + saleN + '</i></label>' : '') +
      '</div>';

    var fHits = applyFilters(hits, s, 'fit');
    var fits = facetCounts(fHits, 'v');
    if (fits.length) {
      h += '<div class="frcs-facet" data-facet="fit"><div class="frcs-facet-title">Fits vehicle</div>' +
        (fits.length > 8 ? '<input type="search" class="frcs-facet-find" placeholder="Find your vehicle" aria-label="Find your vehicle">' : '') +
        '<div class="frcs-facet-list is-tall">' +
        fits.map(function (f) { return checkRow('fit', f[0], vehLabel(f[0]), f[1], s.fit.indexOf(f[0]) >= 0); }).join('') +
        '</div></div>';
    }

    var bHits = applyFilters(hits, s, 'brand');
    var brands = facetCounts(bHits, 'b');
    if (brands.length) {
      var selB = s.brand;
      h += '<div class="frcs-facet" data-facet="brand"><div class="frcs-facet-title">Brand</div><div class="frcs-facet-list">' +
        brands.map(function (b, i) {
          var name = engine.brands[b[0]];
          return (i === 8 ? '<div class="frcs-more-wrap" hidden>' : '') + checkRow('brand', name, name, b[1], selB.indexOf(name) >= 0);
        }).join('') + (brands.length > 8 ? '</div><button type="button" class="frcs-more" data-more="1">Show all ' + brands.length + ' brands</button>' : '') +
        '</div></div>';
    }

    var cHits = applyFilters(hits, s, 'cat');
    var cats = facetCounts(cHits, 'k');
    if (cats.length) {
      h += '<div class="frcs-facet" data-facet="cat"><div class="frcs-facet-title">Category</div><div class="frcs-facet-list">' +
        cats.map(function (c, i) {
          return (i === 8 ? '<div class="frcs-more-wrap" hidden>' : '') + checkRow('cat', c[0], catLabel(c[0]), c[1], s.cat.indexOf(c[0]) >= 0);
        }).join('') + (cats.length > 8 ? '</div><button type="button" class="frcs-more" data-more="1">Show all ' + cats.length + ' categories</button>' : '') +
        '</div></div>';
    }

    var pHits = applyFilters(hits, s, 'price');
    h += '<div class="frcs-facet"><div class="frcs-facet-title">Price</div><div class="frcs-pills">' +
      PRICE_BUCKETS.map(function (b) {
        var key = b[0] + '-' + b[1];
        var n = pHits.filter(function (it) { return inBucket(it, key); }).length;
        if (!n && s.price !== key) return '';
        var label = b[1] >= 1e9 ? money(b[0]).replace('.00', '') + '+' : (b[0] === 0 ? 'Under ' + money(b[1]).replace('.00', '') : money(b[0]).replace('.00', '') + '–' + money(b[1]).replace('.00', ''));
        return '<button type="button" class="frcs-pill' + (s.price === key ? ' is-on' : '') + '" data-price="' + key + '">' + label + ' <i>' + n + '</i></button>';
      }).join('') + '</div></div>';
    return h;
  }

  function activeChips(s) {
    var c = [];
    s.brand.forEach(function (b) { c.push(['brand', b, b]); });
    s.fit.forEach(function (vi) { c.push(['fit', vi, 'Fits ' + vehLabel(vi)]); });
    s.cat.forEach(function (ci) { c.push(['cat', ci, catLabel(ci)]); });
    if (s.stock) c.push(['stock', '1', 'In stock']);
    if (s.sale) c.push(['sale', '1', 'On sale']);
    if (s.price) {
      var b = s.price.split('-').map(Number);
      c.push(['price', s.price, b[1] >= 1e9 ? money(b[0]) + '+' : money(b[0]) + '–' + money(b[1])]);
    }
    return c;
  }

  function sortSelect(s, id) {
    var opts = [['best', 'Best match'], ['stock', 'In stock first'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['new', 'Newest'], ['name', 'Name A–Z']];
    return '<select class="frcs-sort" id="' + id + '" aria-label="Sort results">' + opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (s.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select>';
  }

  function renderResultsPage() {
    var mount = $(CFG.resultsMount);
    if (!mount) return;
    var s = readState();
    RP.state = s;
    RP.el = mount;
    mount.classList.add('frcs', 'frcs-rp-host');
    if (!s.q.trim()) {
      mount.innerHTML = '<section class="frcs-rp"><div class="frcs-rp-head"><div class="frcs-rp-eyebrow">Search</div><h1 class="frcs-rp-q">What are you looking for?</h1></div>' +
        '<div class="frcs-rp-none"><div class="frcs-chips">' + CFG.popular.map(function (p) { return '<a class="frcs-chip is-light" href="' + esc(resultsUrl(p)) + '">' + esc(p) + '</a>'; }).join('') + '</div></div></section>';
      return;
    }
    RP.res = engine.search(s.q);
    var res = RP.res;
    track('view_search_results', { search_term: s.q, results: res.hits.length });
    if (!res.hits.length) track('search_no_results', { search_term: s.q });
    drawResults();
    if (s.openFilters) {
      s.openFilters = false;
      writeState(s);
      var panel = $('.frcs-rp-filters');
      if (panel && isMobile()) { panel.classList.add('is-open'); document.documentElement.classList.add('frcs-lock'); }
    }
    try { document.title = s.q + ' | Search | Fierce RC Solutions'; } catch (e) { }
    var inp = $(CFG.inputSelector);
    if (inp && !inp.value) inp.value = s.q;
  }

  function drawResults() {
    var s = RP.state, res = RP.res, mount = RP.el;
    var ms = engine.matchSet(res);
    var filtered = sortHits(applyFilters(res.hits, s), s.sort);
    var total = res.hits.length;
    var chips = activeChips(s);
    var h = '<section class="frcs-rp">';
    h += '<header class="frcs-rp-head">' +
      '<div class="frcs-rp-eyebrow">Search results</div>' +
      '<h1 class="frcs-rp-q">“' + esc(s.q) + '”</h1>' +
      '<div class="frcs-rp-meta"><span class="frcs-rp-count">' + filtered.length.toLocaleString() + '</span> ' +
      (filtered.length === 1 ? 'product' : 'products') + (filtered.length !== total ? ' <span class="frcs-rp-of">of ' + total.toLocaleString() + '</span>' : '') + '</div>' +
      (res.corrected ? '<div class="frcs-rp-note">Showing results for <b>' + esc(res.corrected) + '</b>. No exact matches for “' + esc(s.q) + '”.</div>' : '') +
      (res.partial && !res.pinned ? '<div class="frcs-rp-note">No product matched every word. These are the closest matches.</div>' : '') +
      (res.go ? '<a class="frcs-go" style="margin-top:12px;display:inline-flex" href="' + esc(res.go.u) + '">' + ICON.arrow + '<span>' + esc(res.go.t || 'Go to the ' + s.q + ' page') + '</span></a>' : '') +
      '</header>';

    if (!total) {
      h += '<div class="frcs-rp-none">' +
        '<p class="frcs-rp-none-sub">We couldn’t find anything for “' + esc(s.q) + '”. Try fewer words, check the spelling, or search by part number.</p>' +
        specialOrderHtml(s.q) +
        '<div class="frcs-label is-dark">Popular searches</div><div class="frcs-chips">' +
        CFG.popular.map(function (p) { return '<a class="frcs-chip is-light" href="' + esc(resultsUrl(p)) + '">' + esc(p) + '</a>'; }).join('') +
        '</div></div></section>';
      mount.innerHTML = h;
      return;
    }

    h += '<div class="frcs-rp-toolbar">' +
      '<button type="button" class="frcs-filter-btn" data-open-filters="1">' + ICON.filter +
      '<span class="frcs-fb-txt"><span class="frcs-fb-main">Filter &amp; Sort</span><span class="frcs-fb-sub">Brand \u00b7 Fits vehicle \u00b7 Price \u00b7 In stock</span></span>' +
      (chips.length ? '<b>' + chips.length + ' on</b>' : '') + '</button>' +
      '<div class="frcs-active">' + chips.map(function (c) {
        return '<button type="button" class="frcs-active-chip" data-rm="' + c[0] + '" data-val="' + esc(c[1]) + '">' + esc(c[2]) + ICON.close + '</button>';
      }).join('') + (chips.length > 1 ? '<button type="button" class="frcs-clear" data-clear="1">Clear all</button>' : '') + '</div>' +
      '<label class="frcs-sort-wrap"><span>Sort</span>' + sortSelect(s, 'frcs-sort-desk') + '</label>' +
      '</div>';

    h += '<div class="frcs-rp-body">' +
      '<aside class="frcs-rp-filters" aria-label="Filters"><div class="frcs-filters-head"><span>Filter &amp; sort</span><button type="button" class="frcs-filters-close" data-close-filters="1" aria-label="Close filters">' + ICON.close + '</button></div>' +
      '<div class="frcs-filters-scroll"><div class="frcs-facet frcs-sort-facet"><div class="frcs-facet-title">Sort</div>' + sortSelect(s, 'frcs-sort-mob') + '</div>' +
      facetsHtml(s, res.hits) + '</div>' +
      '<div class="frcs-filters-foot"><button type="button" class="frcs-clear-lg" data-clear="1"' + (chips.length ? '' : ' disabled') + '>Clear all</button><button type="button" class="frcs-apply" data-close-filters="1">Show ' + filtered.length.toLocaleString() + ' results</button></div>' +
      '</aside><div class="frcs-backdrop" data-close-filters="1"></div>' +
      '<div class="frcs-rp-main">';
    if (!filtered.length) {
      h += '<div class="frcs-rp-empty">No products match these filters. <button type="button" class="frcs-clear" data-clear="1">Clear filters</button></div>';
    } else {
      h += '<div class="frcs-grid">' + filtered.slice(0, s.shown).map(function (it) { return cardHtml(it, ms); }).join('') + '</div>';
      if (filtered.length > s.shown) {
        h += '<div class="frcs-more-row"><button type="button" class="frcs-load" data-load="1">Show ' + Math.min(CFG.perPage, filtered.length - s.shown) + ' more</button>' +
          '<span>Showing ' + s.shown + ' of ' + filtered.length.toLocaleString() + '</span></div>';
      }
      h += '<div class="frcs-rp-help">' + specialOrderHtml(s.q) + '</div>';
    }
    h += '</div></div></section>';
    var wasOpen = document.querySelector('.frcs-rp-filters.is-open');
    var scrollY = root.scrollY;
    mount.innerHTML = h;
    // On phones the filter panel lives directly under <body>, so theme wrappers (slide-out menus) can't trap or cover it.
    var portal = document.getElementById('frcs-portal');
    if (portal) portal.innerHTML = '';
    if (isMobile()) {
      if (!portal) { portal = document.createElement('div'); portal.id = 'frcs-portal'; portal.className = 'frcs'; document.body.appendChild(portal); }
      var aside = $('.frcs-rp-filters', mount), bd = $('.frcs-backdrop', mount);
      if (aside) portal.appendChild(aside);
      if (bd) portal.appendChild(bd);
      if (!portal.__frcsBound) bindResults(portal);
    }
    if (wasOpen) { var f = $('.frcs-rp-filters'); if (f) f.classList.add('is-open'); }
    if (!mount.__frcsBound) bindResults(mount);
    if (!RP.resizeBound) {
      RP.resizeBound = true;
      var lastMobile = isMobile();
      root.addEventListener('resize', debounce(function () { var nm = isMobile(); if (nm !== lastMobile && RP.res) { lastMobile = nm; document.documentElement.classList.remove('frcs-lock'); drawResults(); } }, 200));
    }
    root.scrollTo(root.scrollX, scrollY);
  }

  function bindResults(mount) {
    mount.__frcsBound = 1;
    mount.addEventListener('input', function (e) {
      if (!e.target.classList.contains('frcs-facet-find')) return;
      var needle = e.target.value.trim().toLowerCase();
      $$('.frcs-check', e.target.parentNode).forEach(function (row) {
        row.hidden = !!needle && row.textContent.toLowerCase().indexOf(needle) < 0;
      });
    });
    mount.addEventListener('change', function (e) {
      var t = e.target, s = RP.state;
      if (t.classList.contains('frcs-sort')) { s.sort = t.value; }
      else if (t.name === 'brand') { s.brand = t.checked ? s.brand.concat([t.value]) : s.brand.filter(function (b) { return b !== t.value; }); }
      else if (t.name === 'cat') { var v = +t.value; s.cat = t.checked ? s.cat.concat([v]) : s.cat.filter(function (c) { return c !== v; }); }
      else if (t.name === 'fit') { var fv = +t.value; s.fit = t.checked ? s.fit.concat([fv]) : s.fit.filter(function (c) { return c !== fv; }); }
      else if (t.name === 'stock') s.stock = t.checked;
      else if (t.name === 'sale') s.sale = t.checked;
      else return;
      s.shown = CFG.perPage;
      writeState(s); drawResults();
    });
    mount.addEventListener('click', function (e) {
      var t = e.target.closest('button, a[data-pid], [data-close-filters]');
      if (!t) return;
      var s = RP.state;
      if (t.hasAttribute('data-pid')) {
        var it = engine.items[+t.getAttribute('data-pid')];
        if (it) { track('select_item', { item_list_name: 'search results', items: [{ item_id: it.s || String(it.c), item_name: it.n }], search_term: s.q }); pushRecent(s.q); }
        return;
      }
      if (t.hasAttribute('data-cart')) { addToCart(engine.items[+t.getAttribute('data-cart')], t.closest('.frcs-card')); return; }
      if (t.hasAttribute('data-price')) { var k = t.getAttribute('data-price'); s.price = s.price === k ? '' : k; }
      else if (t.hasAttribute('data-rm')) {
        var f = t.getAttribute('data-rm'), v = t.getAttribute('data-val');
        if (f === 'brand') s.brand = s.brand.filter(function (b) { return b !== v; });
        if (f === 'cat') s.cat = s.cat.filter(function (c) { return String(c) !== v; });
        if (f === 'fit') s.fit = s.fit.filter(function (c) { return String(c) !== v; });
        if (f === 'stock') s.stock = false;
        if (f === 'sale') s.sale = false;
        if (f === 'price') s.price = '';
      }
      else if (t.hasAttribute('data-clear')) { s.brand = []; s.cat = []; s.fit = []; s.stock = false; s.sale = false; s.price = ''; }
      else if (t.hasAttribute('data-load')) { s.shown += CFG.perPage; drawResults(); return; }
      else if (t.hasAttribute('data-more')) {
        var wrap = t.previousElementSibling; if (wrap) { wrap.hidden = false; t.remove(); } return;
      }
      else if (t.hasAttribute('data-open-filters')) { $('.frcs-rp-filters').classList.add('is-open'); document.documentElement.classList.add('frcs-lock'); return; }
      else if (t.hasAttribute('data-close-filters')) { $('.frcs-rp-filters').classList.remove('is-open'); document.documentElement.classList.remove('frcs-lock'); return; }
      else return;
      s.shown = CFG.perPage;
      writeState(s); drawResults();
    });
  }

  /* =====================================================================
   * 7. LOADING AND START-UP
   * ===================================================================== */

  var readyQueue = [];
  function whenReady(fn) {
    if (engine) return fn();
    readyQueue.push(fn);
    ensureLoaded();
  }

  function ensureLoaded() {
    if (engine || loading || !CFG.indexUrl) return;
    var get;
    if (/\.js(\?|$)/.test(CFG.indexUrl)) {
      // Product data shipped as a script (window.FRCS_INDEX = {...}) for hosts that only accept .js files.
      get = new Promise(function (res, rej) {
        if (root.FRCS_INDEX) return res(root.FRCS_INDEX);
        var s = document.createElement('script');
        s.src = CFG.indexUrl; s.async = true;
        s.onload = function () { root.FRCS_INDEX ? res(root.FRCS_INDEX) : rej(new Error('no product data')); };
        s.onerror = function () { rej(new Error('product data failed to load')); };
        document.head.appendChild(s);
      });
    } else {
      get = fetch(CFG.indexUrl, { credentials: 'omit' }).then(function (r) { return r.json(); });
    }
    loading = get.then(function (data) {
      load(data);
      root.FRCS_INDEX = null;
    }).catch(function (e) { loading = null; if (root.console) console.warn('Fierce RC Search: could not load product data', e); });
  }

  // Styles can ship inside the script too (window.FRCS_CSS), so the whole search is one or two .js files.
  function injectCss() {
    if (!root.FRCS_CSS || document.getElementById('frcs-css')) return;
    var st = document.createElement('style');
    st.id = 'frcs-css';
    st.textContent = root.FRCS_CSS;
    document.head.appendChild(st);
  }

  function load(data) {
    engine = new Engine(data);
    if (engine.popular.length) CFG.popular = engine.popular;
    var q = readyQueue; readyQueue = [];
    q.forEach(function (fn) { try { fn(); } catch (e) { if (root.console) console.error(e); } });
    if (isResultsPage()) renderResultsPage();
    return engine;
  }

  function isResultsPage() {
    return !!$(CFG.resultsMount) && (CFG.spa ? new URLSearchParams(root.location.search).has(CFG.queryParam) : root.location.pathname === CFG.resultsPath);
  }

  function injectFonts() {
    if (!CFG.fonts || $('#frcs-fonts')) return;
    var l = document.createElement('link');
    l.id = 'frcs-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Roboto+Condensed:ital,wght@0,600;0,700;1,700;1,800&family=Roboto+Mono:wght@500&display=swap';
    document.head.appendChild(l);
  }

  function init(opts) {
    CFG = Object.assign({}, DEFAULTS, root.FRCS_CONFIG || {}, opts || {});
    injectCss();
    injectFonts();
    $$(CFG.inputSelector).forEach(bindInput);
    if (isResultsPage()) whenReady(renderResultsPage);
    else if (CFG.indexUrl) {
      // Warm the data in the background once the page is idle.
      (root.requestIdleCallback || function (f) { setTimeout(f, 1500); })(ensureLoaded);
    }
    root.addEventListener('popstate', function () { if (CFG.spa && engine && isResultsPage()) renderResultsPage(); });
    return api;
  }

  var api = {
    init: init,
    load: load,
    Engine: Engine,
    _util: { prep: prep, textTokens: textTokens, compact: compact, stem: stem, damerau: damerau },
    get engine() { return engine; },
    search: function (q, o) { return engine ? engine.search(q, o) : null; }
  };

  if (typeof document !== 'undefined' && !root.FRCS_MANUAL) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
  }
  return api;
});
