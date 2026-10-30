// Part-number prefixes show their brand (tkr -> Tekno RC), and words that match nothing are named.
const S = require('../site/frc-search.js');
const brands = ['Tekno RC', 'Team Associated', 'Mugen Seiki', 'Tekin', 'Sticky Kicks', 'Avid', 'Leadfinger', 'Agama'];
const items = [];
let c = 1;
const add = (sku, name, b, q = 1) => items.push({ c: c++, s: sku, n: name, b, k: [], p: 9.99, r: 9.99, q });
for (let i = 1; i <= 12; i++) add('TKR' + (6000 + i), 'Tekno RC Shock Part ' + i, 0, i % 3);   // Tekno main line
for (let i = 1; i <= 6; i++) add('TKRBB' + (100 + i), 'Tekno RC Ball Bearing ' + i, 0);           // narrow sub-line
for (let i = 1; i <= 10; i++) add('ASC' + (90000 + i), 'Team Associated B7 Part ' + i, 1);
for (let i = 1; i <= 12; i++) add('MUGE' + (2000 + i), 'Mugen MBX8 Part ' + i, 2);
for (let i = 1; i <= 5; i++) add('MUGB' + (2000 + i), 'Mugen B-Series Part ' + i, 2);
for (let i = 1; i <= 5; i++) add('TEKTT' + (2500 + i), 'Tekin RX8 Motor ' + i, 3);
for (let i = 1; i <= 5; i++) add('SK' + (100 + i), 'Sticky Kicks Skid Plate Guard ' + i, 4);
for (let i = 1; i <= 5; i++) add('AVI' + (500 + i), 'Avid Bearing Kit ' + i, 5);
add('LFRE3032', 'Leadfinger Body for Mugen', 6); add('LFRE3033', 'Leadfinger Body 2', 6); add('LFRN2001', 'Leadfinger Body 3', 6); add('LFRN2002', 'Leadfinger Body 4', 6);
add('FALCON1', 'Falcon Wing Mount', 5, 0);
brands.push('PT Racing RC Oil'); add('PTOSHOCKOIL550CST', 'PT RC Racing Shock Oil 4 OZ Bottle 550 CST', 8); add('PTOSHOCKOIL525CST', 'PT RC Racing Shock Oil 4 OZ Bottle 525 CST', 8);
add('TKR9401', 'Tekno RC NT48 2.2 1/8th 4WD Competition Nitro Truggy Kit', 0);
add('TKR9402', 'Tekno RC NT48 2.2 Exhaust Pipe', 0);
for (let i = 1; i <= 5; i++) add('AG' + (60 + i), 'Agama Oil Seal Cap ' + i, 7);

const E = new S.Engine({ brands, cats: [], items });
const brandOf = (r) => [...new Set(r.hits.map((h) => brands[h.b]))];
const count = (b) => items.filter((i) => i.b === b).length;
let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + label); };

for (const typing of [false, true]) {
  const m = typing ? 'typing ' : 'submit ';
  let r = E.search('tkr', { typing });
  check(m + 'tkr shows every Tekno RC part and nothing else', r.hits.length === count(0) && brandOf(r).join() === 'Tekno RC');
  check(m + 'TKR in capitals', E.search('TKR', { typing }).hits.length === count(0));
  r = E.search('asc', { typing });
  check(m + 'asc shows Team Associated', r.hits.length === count(1) && brandOf(r).join() === 'Team Associated');
  r = E.search('tkrbb', { typing });
  check(m + 'tkrbb is the bearing line only', r.hits.length === 6 && r.hits.every((h) => /^TKRBB/.test(h.s)));
  r = E.search('mugb', { typing });
  check(m + 'mugb lists the MUGB parts, all Mugen', r.hits.length === 5 && brandOf(r).join() === 'Mugen Seiki');
  r = E.search('muge', { typing });
  check(m + 'muge shows all Mugen MUGE parts', items.filter((i) => /^MUGE/.test(i.s)).every((i) => r.hits.indexOf(i) >= 0));
  r = E.search('mug', { typing });
  check(m + 'mug shows the Mugen brand', brandOf(r).join() === 'Mugen Seiki' && r.hits.length === count(2));
  r = E.search('lfr', { typing });
  check(m + 'lfr shows Leadfinger', r.hits.length === count(6));
  r = E.search('tektt', { typing });
  check(m + 'tektt shows Tekin', r.hits.length === 5 && brandOf(r).join() === 'Tekin');
}
// Letters that start an ordinary word are left to the word, so typing is not hijacked.
let r = E.search('tek', { typing: true });
check('tek (on the way to tekno) is not taken over by Tekin', brandOf(r).indexOf('Tekno RC') >= 0 && !E.brandCodes.tek);
r = E.search('sk', { typing: true });
check('sk (on the way to skid) is not taken over', !E.brandCodes.sk && r.hits.some((h) => /Skid/.test(h.n)));
// A prefix never pulls in another brand's parts that only mention it.
check('tkr does not include Leadfinger bodies', brandOf(E.search('tkr')).indexOf('Leadfinger') < 0);
// Notices
check('brand notice data for tkr', E.search('tkr').brandCode && E.search('tkr').brandCode.brand === 'Tekno RC' && E.search('tkr').brandCode.isPrefix === true);
check('no brand notice for a normal word', !E.search('bearing').brandCode);
r = E.search('tamiya falcon');
check('unmatched word is named', r.partial && (r.dropped || []).join() === 'tamiya' && (r.usedWords || []).join() === 'falcon' && r.hits.length === 1);
r = E.search('tekno zzqx9');
check('a word that matches nothing is named, rest still searched', (r.dropped || []).join() === 'zzqx9' && r.hits.length === count(0));
r = E.search('tekno NT482.2');
check('platform and version typed together (nt482.2) means nt48 2.2', !r.dropped && r.hits.length > 0 && /NT48 2\.2/.test(r.hits[0].n));
check('agamann finds Agama', E.search('agamann').hits.length === count(7) && !!E.search('agamann').corrected);
check('stray letter in front (lpipe) finds pipe', E.search('lpipe').hits.length === 1);
check('normal search has no dropped words', !E.search('tekno shock').dropped);
// Letters and numbers typed together
check('pt550 (no space) finds the same part as pt 550', E.search('pt550').hits.length === 1 && /550 CST/.test(E.search('pt550').hits[0].n) && E.search('pt550').corrected === 'pt 550');
check('550cst still works', E.search('550cst').hits.length === 1);
check('a normal part number is not rewritten', E.search('tkr6001').hits.length === 1 && !E.search('tkr6001').corrected);
check('nonsense with a number still finds nothing', E.search('asdf123').hits.length === 0 && E.search('xyz999').hits.length === 0);
// A short word then Enter behaves like typing it
check('short word submitted shows matches', E.search('av').hits.length === count(5));
console.log(fail ? fail + ' failing' : 'all passing');
process.exit(fail ? 1 : 0);
