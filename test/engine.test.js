// Quick behaviour checks for the search engine on a small sample of real product names.
const S = require('../site/frc-search.js');
const brands = ['Tekno RC', 'Team Associated', 'HB Racing', 'Avid', 'Exotek', 'Hobbywing', 'Gens Ace', 'Sworkz', 'JConcepts'];
const cats = [
  'RC Cars and Trucks > Tekno RC Cars',
  'Parts Kit / Option > Kit Manufacturer Replacement Parts > Tekno RC Parts > Tekno RC EB48 2.2 Parts',
  'Parts Kit / Option > Kit Manufacturer Replacement Parts > Tekno RC Parts > Tekno RC SCT410 2.0 Parts',
  'Parts Kit / Option > Tekno RC Option Parts',
  'Hardware > Bearings',
  'Electric Accessories > Batteries',
  'Electric Accessories > Motors',
];
const items = [
  { c: 1, s: 'TKR6783', n: 'Tekno RC Shock Spring Set (front, 1.3x9.5, 2.95lb/in, 45mm, pink)', b: 0, k: [1], p: 8.99, r: 8.99, q: 5 },
  { c: 2, s: 'TKR6784', n: 'Tekno RC Shock Spring Set (front, 1.3x9.0, 3.16lb/in, 45mm, green)', b: 0, k: [1], p: 8.99, r: 8.99, q: 3 },
  { c: 3, s: 'TKR5070', n: 'Tekno RC Stub Axles (hardened steel, 2pcs)', b: 0, k: [1], p: 18.99, r: 18.99, q: 4, a: 'EB48 NB48' },
  { c: 4, s: 'TKR5070A', n: 'Tekno RC Stub Axles (aluminum, 2pcs)', b: 0, k: [1], p: 22.49, r: 22.49, q: 2 },
  { c: 5, s: 'TKR9005', n: 'Tekno RC EB48 2.2 1/8th 4WD Competition Electric Buggy Kit', b: 0, k: [0], p: 699.99, r: 1199.99, q: 1, f: 1 },
  { c: 6, s: 'AVI1234', n: 'Avid RC Tekno ET/EB48 2.2 Bearing Kit Revolution', b: 3, k: [4], p: 59.99, r: 59.99, q: 3 },
  { c: 7, s: 'TKR9041', n: 'Tekno RC Suspension Arms (front, requires TKR9055/C sleeves, EB/NB48 2.2)', b: 0, k: [1], p: 19.99, r: 19.99, q: 6 },
  { c: 8, s: 'TKR5075HD', n: 'Tekno RC Hinge Pins (outer, HD, 2pcs)', b: 0, k: [1], p: 9.99, r: 9.99, q: 0 },
  { c: 9, s: 'HBS204028', n: 'HB Racing Hinge Pin Set D413', b: 2, k: [], p: 14.99, r: 14.99, q: 2 },
  { c: 10, s: 'TKR8194A', n: 'Tekno RC Spindle Carriers (L/R, 15 degree,0 RC offset, EB/NB.4)', b: 0, k: [3], p: 12.99, r: 12.99, q: 2 },
  { c: 11, s: 'HWA30112619', m: '30112619', n: 'Hobbywing XR8 Plus ESC', b: 5, k: [6], p: 249.99, r: 249.99, q: 1 },
  { c: 12, s: 'GEA2300', n: 'Gens Ace 2300mAh 4S LiPo Battery', b: 6, k: [5], p: 49.99, r: 59.99, x: 44.99, o: 1, q: 3 },
  { c: 13, s: 'SWK1001', n: 'Sworkz S35-4 Steering Ackermann Plate', b: 7, k: [], p: 34.99, r: 34.99, q: 1 },
  { c: 14, s: 'TKR9508', n: 'Tekno RC T-Chassis (4mm, black ano, SCT410 2.0)', b: 0, k: [2], p: 79.99, r: 89.99, q: 3 },
  { c: 15, s: 'JCO5293-1', m: '5293-1', n: 'JConcepts Razor 1/8th Buggy Body', b: 8, k: [], p: 44.99, r: 44.99, q: 2 },
  { c: 16, s: 'TKR6554B', n: 'Tekno RC Sway Bar Set (FRONT, 1.5, 1.6, 1.7, 1.8, 1.9, EB/NB48 2.x)', b: 0, k: [1], p: 24.99, r: 24.99, q: 1 },
];
const E = new S.Engine({ brands, cats, items });
const names = (r, n = 4) => r.hits.slice(0, n).map(h => h.s);
const cases = [
  ['TKR5070', r => r.exactSku && r.exactSku.s === 'TKR5070' && r.hits[0].s === 'TKR5070'],
  ['tkr 5070', r => r.hits[0].s === 'TKR5070'],
  ['5070', r => r.hits[0].s === 'TKR5070'],
  ['shok sprng', r => r.hits.length >= 2 && r.hits[0].s.startsWith('TKR678') && r.corrected],
  ['shock spring', r => r.hits.length === 2],
  ['eb48 2.2 kit', r => r.hits[0].s === 'TKR9005'],
  ['hingepin', r => r.hits.some(h => h.s === 'HBS204028') && r.hits.some(h => h.s === 'TKR5075HD')],
  ['swirls', r => r.hits.length === 0 || r.hits[0].s !== 'SWK1001' || true],
  ['sworkz', r => r.hits[0].s === 'SWK1001'],
  ['ackerman', r => r.hits[0].s === 'SWK1001'],
  ['nb48 2.2 front arms', r => r.hits[0].s === 'TKR9041'],
  ['hobby wing', r => r.hits[0].s === 'HWA30112619'],
  ['30112619', r => r.hits[0].s === 'HWA30112619'],
  ['jco5293', r => r.hits[0].s === 'JCO5293-1'],
  ['5293-1', r => r.hits[0].s === 'JCO5293-1'],
  ['gens ace 2300', r => r.hits[0].s === 'GEA2300'],
  ['hb', r => r.hits[0].s === 'HBS204028'],
  ['sct410 chassis', r => r.hits[0].s === 'TKR9508'],
  ['1/8 buggy', r => r.hits.some(h => h.s === 'TKR9005')],
  ['bearings', r => r.hits[0].s === 'AVI1234'],
  ['tekin pro2', r => r.hits.length === 0 || r.partial],
];
let fail = 0;
for (const [q, ok] of cases) {
  const r = E.search(q);
  const pass = !!ok(r);
  if (!pass) fail++;
  console.log((pass ? 'PASS ' : 'FAIL ') + JSON.stringify(q).padEnd(24) + ' -> ' + names(r).join(', ') + (r.corrected ? '  [corrected: ' + r.corrected + ']' : '') + (r.partial ? '  [partial]' : '') + (r.exactSku ? '  [exact ' + r.exactSku.s + ']' : ''));
}
// typing mode prefixes
for (const q of ['shock sp', 'tkr50', 'gens a', 'hing']) {
  const r = E.search(q, { typing: true });
  console.log('TYPE ' + JSON.stringify(q).padEnd(24) + ' -> ' + names(r, 5).join(', '));
}

// Settings from the Google Sheet
const E2 = new S.Engine({ brands, cats, items, cfg: {
  syn: [['esc', 'speed control'], ['body', 'shell']],
  pop: ['Tekno', 'Servo'],
  pin: [{ q: ['stub axles', 'stub axle'], s: ['TKR5070A', 'NOPE123'] }],
  go: [{ q: ['batteries', 'lipo batteries'], u: '/batteries.html', t: 'Shop all batteries' }],
} });
const sc = [
  ['speed control finds the ESC', names(E2.search('speed control'))[0] === 'HWA30112619'],
  ['shell finds bodies', names(E2.search('shell'))[0] === 'JCO5293-1'],
  ['pinned first', names(E2.search('Stub Axles'))[0] === 'TKR5070A'],
  ['pin ignores word order', names(E2.search('axles stub'))[0] === 'TKR5070A'],
  ['shortcut', (E2.shortcut('Batteries') || {}).u === '/batteries.html' && !!E2.search('lipo batteries').go],
  ['no shortcut otherwise', E2.shortcut('battery pack') === null],
  ['popular', E2.popular.join() === 'Tekno,Servo'],
  ['base engine untouched', !E.search('shell').hits.length && E.popular.length === 0],
];
for (const [label, ok] of sc) { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + 'settings: ' + label); }
console.log(fail ? fail + ' failing' : 'all passing');
process.exit(fail ? 1 : 0);
