/* Unit checks for game/js/core.js pure functions:  node tests/core.test.js */
'use strict';
const assert = require('assert');
require('../game/js/core.js');
const PT = globalThis.PT;

// tile URLs: Dynmap's getTileInfo/getTileName, x = 2^k * col, y = -(2^k * row), folder = (x >> 5)_(y >> 5).
// Leaflet rows are offset by one native tile (CRS origin at z = -32), so blocks z 0..31 are row 1 at zoom 5.
const base = '/tiles/w/flat/';
assert.strictEqual(PT.tileUrl(base, { x: 0, y: 1, z: 5 }), base + '0_-1/0_-1.jpg');    // blocks x 0..31, z 0..31
assert.strictEqual(PT.tileUrl(base, { x: 3, y: -1, z: 5 }), base + '0_0/3_1.jpg');     // z -64..-33
assert.strictEqual(PT.tileUrl(base, { x: 0, y: 0, z: 5 }), base + '0_0/0_0.jpg');      // z -32..-1
assert.strictEqual(PT.tileUrl(base, { x: -1, y: 1, z: 4 }), base + '-1_-1/z_-2_-2.jpg');
assert.strictEqual(PT.tileUrl(base, { x: 0, y: 1, z: 0 }), base + '0_-1/zzzzz_0_-32.jpg');
assert.strictEqual(PT.tileUrl(base, { x: 0, y: 0, z: 0 }), base + '0_0/zzzzz_0_0.jpg');

// scoring (perfect 0 = exact block only, k 200): nothing is subtracted from the distance
const s = d => PT.score(d, 0, 200);
assert.strictEqual(s(0), 100); assert.strictEqual(s(1), 99);
assert.strictEqual(s(25), 88); assert.strictEqual(s(50), 78); assert.strictEqual(s(100), 61);
assert.strictEqual(s(200), 37); assert.strictEqual(s(500), 8);
assert.strictEqual(PT.score(3, 5, 200), 100);   // a wider perfect radius still works if meta.scoring asks for one
assert.strictEqual(PT.tile(85), '🟩'); assert.strictEqual(PT.tile(60), '🟨'); assert.strictEqual(PT.tile(30), '🟧'); assert.strictEqual(PT.tile(29), '🟥');

// a location with extra spots scores against the closest one
const sewer = { x: 0, z: 0, alt: [{ x: 300, z: 0 }, { x: 0, z: -200 }] };
assert.deepStrictEqual(PT.nearest({ x: 290, z: 0 }, sewer), { x: 300, z: 0, d: 10 });
assert.deepStrictEqual(PT.nearest({ x: 5, z: 5 }, { x: 0, z: 0 }).d, Math.hypot(5, 5));
assert.strictEqual(PT.spots(sewer).length, 3);

// daily picks on the real locations.json: 1 medium, 2 hard, 2 expert, easiest first, never two within 50 blocks
const DATA = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'game', 'locations.json'), 'utf8'));
assert.deepStrictEqual(DATA.meta.mix, ['medium', 'hard', 'hard', 'expert', 'expert']);
const seen = { medium: new Set(), hard: new Set(), expert: new Set() };
for (let n = 1; n <= 365; n++) {
  const picks = PT.pickDaily(DATA, n);
  assert.deepStrictEqual(picks.map(l => l.difficulty), ['medium', 'hard', 'hard', 'expert', 'expert'], 'mix on day ' + n);
  assert.strictEqual(new Set(picks.map(l => l.id)).size, 5, 'no duplicate on day ' + n);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++)
    assert(PT.gapBetween(picks[i], picks[j]) >= 50, 'day ' + n + ': ' + picks[i].id + ' and ' + picks[j].id + ' too close');
  if (n <= 11) picks.forEach(l => seen[l.difficulty].add(l.id));
}
// the first 11 days still cover most of each pool (the gap rule only occasionally swaps one out)
['medium', 'hard', 'expert'].forEach(d => {
  const pool = DATA.locations.filter(l => l.difficulty === d).length;
  assert(seen[d].size >= Math.min(pool, 11 * (d === 'medium' ? 1 : 2)) - 3, d + ' variety: ' + seen[d].size + ' of ' + pool);
});
// the gap rule keeps a location and its near-twin apart
const twins = { meta: { mix: ['medium', 'expert'] }, locations: [
  { id: 'factory', difficulty: 'medium', x: 0, z: 0 }, { id: 'portal', difficulty: 'expert', x: 0, z: 0 }, { id: 'far', difficulty: 'expert', x: 900, z: 0 }] };
for (let n = 1; n <= 20; n++) assert.deepStrictEqual(PT.pickDaily(twins, n).map(l => l.id), ['factory', 'far']);

// puzzle numbering in America/New_York: #1 on the epoch, rolls over at midnight ET
const tz = 'America/New_York', ep = '2026-10-24';
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-24T04:00:00Z')), 1);   // 00:00 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T03:59:59Z')), 1);   // 23:59:59 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T04:00:00Z')), 2);
console.log('core.js checks passed');
