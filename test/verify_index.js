// Safety check before publishing: the product list must load and the search must find things.
// Usage: node test/verify_index.js site/frc-index.js
const path = require('path');
global.window = global;
require(path.resolve(process.argv[2] || 'site/frc-index.js'));
const data = global.FRCS_INDEX;
const S = require('../site/frc-search.js');
const fail = (m) => { console.error('NOT PUBLISHING: ' + m); process.exit(1); };
if (!data || !Array.isArray(data.items)) fail('product list did not load');
if (data.items.length < 1000) fail('only ' + data.items.length + ' products (expected 3,000+)');
const E = new S.Engine(data);
for (const q of ['tekno', 'servo', 'bearing', 'shock spring']) {
  const n = E.search(q).hits.length;
  if (!n) fail('search for "' + q + '" found nothing');
  console.log(('"' + q + '"').padEnd(16), n, 'results');
}
const withImg = data.items.filter(i => i.t || i.i).length;
const withLink = data.items.filter(i => i.u && !/^product\.asp/.test(i.u)).length;
console.log('products:', data.items.length, '| with photos:', withImg, '| with page links:', withLink, '| built:', data.built);
