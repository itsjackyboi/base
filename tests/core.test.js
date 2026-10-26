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

// daily picks on the real locations.json and related.json
const fs = require('fs'), dir = require('path').join(__dirname, '..', 'game');
const DATA = JSON.parse(fs.readFileSync(dir + '/locations.json', 'utf8'));
const GROUPS = JSON.parse(fs.readFileSync(dir + '/related.json', 'utf8')).groups.map(g => g.ids);
const IDS = new Set(DATA.locations.map(l => l.id));
GROUPS.forEach(g => g.forEach(id => assert(IDS.has(id), 'related.json names a missing location: ' + id)));
assert.strictEqual(PT.mixes(5, 2).length, 16);
const GAME = { meta: DATA.meta, locations: DATA.locations, related: GROUPS };
const RANK = { easy: 0, medium: 1, hard: 2, expert: 3 }, used = {}, mixesSeen = new Set();
for (let n = 1; n <= 730; n++) {
  const picks = PT.pickDaily(GAME, n), ranks = picks.map(l => RANK[l.difficulty]);
  assert.strictEqual(picks.length, 5, 'five rounds on day ' + n);
  assert.strictEqual(new Set(picks.map(l => l.id)).size, 5, 'no duplicate on day ' + n);
  assert(ranks.every((r, i) => !i || r >= ranks[i - 1]), 'day ' + n + ' steps down: ' + ranks);
  assert([0, 1, 2, 3].every(r => ranks.filter(x => x === r).length <= 2), 'day ' + n + ' has three of a difficulty: ' + ranks);
  GROUPS.forEach(g => assert(picks.filter(l => g.includes(l.id)).length <= 1, 'day ' + n + ' has two related picks: ' + picks.map(l => l.id)));
  if (n <= 16) mixesSeen.add(String([0, 1, 2, 3].map(r => ranks.filter(x => x === r).length)));
  if (n <= 365) picks.forEach(l => { used[l.id] = (used[l.id] || 0) + 1; });
}
assert.strictEqual(mixesSeen.size, 16, 'each of the 16 difficulty mixes comes up once in the first 16 days');
assert.strictEqual(Object.keys(used).length, DATA.locations.length, 'every location comes up within a year');
// a related pair never shares a day, even when nothing else is left
const twins = { meta: { rounds: 2 }, related: [['factory', 'portal']], locations: [
  { id: 'factory', difficulty: 'hard', x: 0, z: 0 }, { id: 'portal', difficulty: 'hard', x: 0, z: 0 }, { id: 'far', difficulty: 'hard', x: 900, z: 0 }] };
for (let n = 1; n <= 40; n++) assert(!['factory', 'portal'].every(id => PT.pickDaily(twins, n).some(l => l.id === id)), 'twins apart on day ' + n);

// puzzle numbering in America/New_York: #1 on the epoch, rolls over at midnight ET
const tz = 'America/New_York', ep = '2026-10-24';
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-24T04:00:00Z')), 1);   // 00:00 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T03:59:59Z')), 1);   // 23:59:59 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T04:00:00Z')), 2);
console.log('core.js checks passed');
