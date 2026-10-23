/* Unit checks for game/js/core.js pure functions:  node tests/core.test.js */
'use strict';
const assert = require('assert');
require('../game/js/core.js');
const PT = globalThis.PT;

// tile URLs (same scheme Dynmap's own page requests)
const base = '/tiles/w/flat/';
assert.strictEqual(PT.tileUrl(base, { x: 0, y: 0, z: 5 }), base + '0_-1/0_-1.jpg');
assert.strictEqual(PT.tileUrl(base, { x: 3, y: -2, z: 5 }), base + '0_0/3_1.jpg');
assert.strictEqual(PT.tileUrl(base, { x: -1, y: 0, z: 4 }), base + '-1_-1/z_-2_-2.jpg');
assert.strictEqual(PT.tileUrl(base, { x: 0, y: 0, z: 0 }), base + '0_-1/zzzzz_0_-32.jpg');

// scoring examples from the spec (perfect 5, k 200)
const s = d => PT.score(d, 5, 200);
assert.strictEqual(s(0), 100); assert.strictEqual(s(5), 100);
assert.strictEqual(s(25), 90); assert.strictEqual(s(100), 62); assert.strictEqual(s(200), 38); assert.strictEqual(s(500), 8);
assert.strictEqual(PT.tile(85), '🟩'); assert.strictEqual(PT.tile(60), '🟨'); assert.strictEqual(PT.tile(30), '🟧'); assert.strictEqual(PT.tile(29), '🟥');

// puzzle numbering in America/New_York: #1 on the epoch, rolls over at midnight ET
const tz = 'America/New_York', ep = '2026-10-24';
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-24T04:00:00Z')), 1);   // 00:00 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T03:59:59Z')), 1);   // 23:59:59 EDT
assert.strictEqual(PT.puzzleNumber(tz, ep, new Date('2026-10-25T04:00:00Z')), 2);
console.log('core.js checks passed');
