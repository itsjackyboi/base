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

// puzzle numbering in America/New_York: #1 on the epoch, rolls over at midnight ET
const tz = 'America/New_York', ep = '2026-10-24';
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-24T04:00:00Z')), 1);   // 00:00 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T03:59:59Z')), 1);   // 23:59:59 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T04:00:00Z')), 2);
console.log('core.js checks passed');
