// Tries every brand in the product list the way shoppers type it. The brand's name as listed, run together
// (prracing), and hyphenated (pr-racing) must show that brand's parts; this fails the update if one doesn't.
// One-letter typos of the name are tried too and reported, but do not fail the update.
const path = require('path');
global.window = global;
require(path.resolve(process.argv[2] || 'data/frc-index.js'));
const data = global.FRCS_INDEX;
const S = require(path.resolve(__dirname, '../site/frc-search.js'));
const E = new S.Engine(data);
const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const counts = {};
data.items.forEach((i) => { counts[i.b] = (counts[i.b] || 0) + 1; });
const ok = (bi, q) => {
  const n = counts[bi], top = E.search(q).hits.slice(0, 10);
  return top.filter((h) => h.b === bi).length >= Math.ceil(Math.min(10, n) * 0.6);
};
let must = 0, mustFail = [], typo = 0, typoFail = 0;
data.brands.forEach((name, bi) => {
  if ((counts[bi] || 0) < 5) return;
  const c = compact(name), listed = name.toLowerCase();
  const forms = [['as listed', listed]];
  if (c !== listed) forms.push(['run together', c]);
  if (/ /.test(name)) forms.push(['hyphenated', listed.replace(/ +/g, '-')]);
  forms.forEach(([kind, q]) => { must++; if (!ok(bi, q)) mustFail.push(name + ' <- "' + q + '" (' + kind + ')'); });
  if (c.length >= 8) {
    for (let i = 1; i < c.length - 1; i++) { typo++; if (!ok(bi, c.slice(0, i) + c.slice(i + 1))) typoFail++; }
    for (let i = 0; i < c.length - 1; i++) { if (c[i] === c[i + 1]) continue; typo++; if (!ok(bi, c.slice(0, i) + c[i + 1] + c[i] + c.slice(i + 2))) typoFail++; }
  }
});
console.log('brand names tried: ' + must + ' forms, ' + mustFail.length + ' not found' + (mustFail.length ? ':\n  ' + mustFail.join('\n  ') : ''));
console.log('one-letter typos of longer brand names: ' + typo + ' tried, ' + typoFail + ' not found (reported only)');
process.exit(mustFail.length ? 1 : 0);
