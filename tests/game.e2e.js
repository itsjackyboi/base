/* End-to-end check of the game (index.html) against tools/mock_dynmap.py and game/locations.json.
 *   python3 tools/mock_dynmap.py --port 8128 &
 *   python3 tools/mock_dynmap.py --port 8129 --login-required &
 *   NODE_PATH=$(npm root -g) node tests/game.e2e.js [screenshot-dir]
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8128/pintland/index.html';
const OUT = process.argv[2] || path.join(__dirname, 'screens');
fs.mkdirSync(OUT, { recursive: true });
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'game', 'locations.json'), 'utf8'));
const errors = [];
function step(msg) { console.log('  ✓ ' + msg); }

async function tilesLoaded(page) {
  await page.waitForFunction(() => document.querySelectorAll('img.leaflet-tile-loaded').length > 2, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}
/* timer: seconds per guess for this page. Most checks reload and wait between steps, so they run with the clock off (0).
   epoch: puzzle #1's date; the numbered-puzzle checks use Oct 24 (the real file launched Oct 26). */
async function newPage(ctx, iso, timer, epoch) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setSystemTime(new Date(iso));   // time keeps flowing, so Leaflet's fades and pans finish
  const d = JSON.parse(JSON.stringify(DATA)); d.meta.timer = timer || 0; d.meta.epoch = epoch === undefined ? '2026-10-24' : epoch;
  await page.route('**/pintland/locations.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(d) }));
  return page;
}
const phase = page => page.evaluate(() => window.ptGame && window.ptGame.phase);
const prog = page => page.evaluate(() => JSON.parse(JSON.stringify(window.ptGame.prog)));

/* pan/zoom to block (x, z) and click/tap the centre of the map */
async function guessAt(page, x, z, tap) {
  await page.waitForFunction(() => !window.ptGame.map._animatingZoom && !(window.ptGame.map._panAnim && window.ptGame.map._panAnim._inProgress));
  await page.waitForTimeout(300);   // let the zoom-out to the whole box finish
  await page.evaluate(([x, z]) => window.ptGame.map.setView(L.latLng(-(z + 0.5), x + 0.5), 5, { animate: false }), [x, z]);
  const pt = await page.evaluate(([x, z]) => { const p = window.ptGame.map.latLngToContainerPoint(L.latLng(-(z + 0.5), x + 0.5)); return [p.x, p.y]; }, [x, z]);
  if (tap) await page.touchscreen.tap(pt[0], pt[1]); else await page.mouse.click(pt[0], pt[1]);
}
async function lock(page, tap) {
  if (tap) await page.tap('#lockBtn'); else await page.click('#lockBtn');
  await page.waitForFunction(() => window.ptGame.phase === 'reveal');
}
async function next(page, tap) { if (tap) await page.tap('#nextBtn'); else await page.click('#nextBtn'); }

/* play the current round with a guess offset (dx, dz) blocks from the answer */
async function playRound(page, dx, dz, opts) {
  opts = opts || {};
  const p = await prog(page), l = p.locs[p.rounds.length];
  await guessAt(page, l.x + dx, l.z + dz, opts.tap);
  await lock(page, opts.tap);
  return l;
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- laptop: a full game ---------------- */
  console.log('laptop 1366x820, 2026-10-26 11:00 ET (puzzle #3)');
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  let page = await newPage(ctx, '2026-10-26T15:00:00Z');
  await page.goto(BASE);
  await page.waitForSelector('#start.show');
  assert.strictEqual(await page.textContent('#sKicker'), 'Puzzle #3');
  assert.strictEqual(await page.textContent('#pno'), '#3');
  assert.match(await page.textContent('#ruleScore'), /exact block, 88 at 25 blocks off, 61 at 100/);
  await tilesLoaded(page);
  await page.screenshot({ path: path.join(OUT, 'game-start.png') });
  let p = await prog(page);
  const RANK = { easy: 0, medium: 1, hard: 2, expert: 3 }, ranks = p.locs.map(l => RANK[l.difficulty]);
  assert.strictEqual(p.locs.length, 5);
  assert(ranks.every((r, i) => !i || r >= ranks[i - 1]), 'difficulty never steps down: ' + ranks);
  assert([0, 1, 2, 3].every(r => ranks.filter(x => x === r).length <= 2), 'at most two of a difficulty: ' + ranks);
  p.locs.forEach(l => {
    const src = DATA.locations.find(d => d.id === l.id);
    assert(src && src.x === l.x && src.z === l.z, 'picked from locations.json: ' + l.id);
  });
  step('start card for puzzle #3; easiest first, at most two of a difficulty: ' + p.locs.map(l => l.name + ' (' + l.difficulty + ')').join(', '));

  await page.click('#startBtn');
  assert.strictEqual(await phase(page), 'guess');
  assert.match(await page.textContent('#pName'), new RegExp(p.locs[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert(await page.isDisabled('#lockBtn'), 'lock disabled before a guess');
  const fullView = await page.evaluate(() => { const b = window.ptGame.map.getBounds(); return [b.getWest(), b.getEast(), -b.getNorth(), -b.getSouth()]; });
  assert(fullView[0] <= -3500 && fullView[1] >= 3500, 'round starts on the whole play area');
  await page.screenshot({ path: path.join(OUT, 'game-round1.png') });

  // round 1: exact block -> 100, Bullseye; a second click moves the guess first
  const l1 = p.locs[0];
  await guessAt(page, l1.x + 40, l1.z);
  await guessAt(page, l1.x, l1.z);
  await lock(page);
  assert.strictEqual(await page.textContent('#rScore'), '100');
  assert.strictEqual(await page.textContent('#rVerdict'), 'Bullseye');
  assert.strictEqual(await page.textContent('#rDist'), 'Exact block!');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-game-v1-2026-10-26')));
  assert.strictEqual(saved.rounds.length, 1, 'guess stored the moment it is locked');
  await page.screenshot({ path: path.join(OUT, 'game-reveal-exact.png') });
  step('round 1: moved guess, then exact block → 100 Bullseye, saved immediately');
  await next(page);

  // round 2: 100 blocks east -> 61; reload on the reveal can't re-guess
  await playRound(page, 100, 0);
  assert.strictEqual(await page.textContent('#rScore'), '61');
  assert.strictEqual(await page.textContent('#rDist'), '100 blocks away');
  await tilesLoaded(page);
  await page.screenshot({ path: path.join(OUT, 'game-reveal-100.png') });
  await page.reload();
  await page.waitForFunction(() => window.ptGame && window.ptGame.phase === 'reveal');
  p = await prog(page);
  assert.strictEqual(p.rounds.length, 2);
  assert.strictEqual(await page.textContent('#rScore'), '61');
  assert(await page.locator('#lockBtn').isHidden(), 'no lock button after reload on a reveal');
  step('round 2: 100 blocks off → 61; reload on the reveal shows the same result, no re-guess');
  await next(page);

  // round 3: unlocked guess + reload -> still round 3 with no guess; then 25 off -> 88
  const l3 = (await prog(page)).locs[2];
  await guessAt(page, l3.x + 3, l3.z + 4);
  assert(!(await page.isDisabled('#lockBtn')));
  await page.reload();
  await page.waitForFunction(() => window.ptGame && window.ptGame.phase === 'guess');
  assert.strictEqual((await prog(page)).rounds.length, 2);
  assert(await page.isDisabled('#lockBtn'), 'unlocked guess is not kept');
  assert.strictEqual(await page.locator('#start.show').count(), 0, 'no start card mid-game');
  await playRound(page, 15, 20);
  assert.strictEqual(await page.textContent('#rScore'), '88');
  assert.strictEqual(await page.textContent('#rVerdict'), 'Close');
  step('round 3: reload before locking keeps round 3; 25 blocks off → 88 Close');
  await next(page);

  // round 4: 500 off -> 8; round 5: 200 off -> 37
  await playRound(page, 300, 400);
  assert.strictEqual(await page.textContent('#rScore'), '8');
  assert.strictEqual(await page.textContent('#rVerdict'), 'Lost at sea');
  await next(page);
  await playRound(page, 0, -200);
  assert.strictEqual(await page.textContent('#rScore'), '37');
  assert.strictEqual(await page.textContent('#nextBtn'), 'See results');
  step('round 4: 500 off → 8 Lost at sea; round 5: 200 off → 37');
  await next(page);

  // results
  await page.waitForSelector('#results.show');
  assert.strictEqual(await page.textContent('#resTotal'), '294');
  const share = await page.textContent('#shareText');
  assert.strictEqual(share, 'Pintland Tap #3 — 294/500\n🟩🟨🟩🟥🟧\nhttp://127.0.0.1:8128/pintland/index.html');
  assert.strictEqual(await page.locator('#resRounds tr').count(), 5);
  const statVals = await page.$$eval('#stats b', b => b.map(x => x.textContent));
  assert.deepStrictEqual(statVals, ['1', '1', '1', '294']);
  const nextTxt = await page.textContent('#nextPuzzle');
  assert.match(nextTxt, /Next puzzle in 1[23]h \d\dm \d\ds/);
  assert.match(nextTxt, /at 12:00 AM Eastern/);
  await page.screenshot({ path: path.join(OUT, 'game-results.png') });
  step('results: 294/500, share text exact, played 1 · streak 1, "' + nextTxt.replace(/\s+/g, ' ').trim() + '"');

  await page.click('#reviewBtn');
  assert.strictEqual(await page.locator('.num').count(), 5);
  assert.strictEqual(await page.locator('.ans:not(.faint)').count(), 5, 'one scored answer per round (other spots of multi-spot places are faded)');
  await tilesLoaded(page);
  await page.screenshot({ path: path.join(OUT, 'game-review.png') });
  await page.click('#backBtn');
  await page.waitForSelector('#results.show');
  step('review map shows all five guess/answer pairs');

  await page.reload();
  await page.waitForSelector('#results.show');
  assert.strictEqual(await page.textContent('#resTotal'), '294');
  step('reload after finishing opens straight on results');

  // same puzzle for everyone: a fresh browser on the same day gets the same picks
  const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const other = await newPage(ctx2, '2026-10-26T23:30:00Z');
  await other.goto(BASE);
  await other.waitForSelector('#start.show');
  assert.deepStrictEqual((await prog(other)).locs.map(l => l.id), p.locs.map(l => l.id));
  await ctx2.close();
  step('another player on the same day gets the same five locations');

  // 23:59 ET is still #3; midnight ET rolls over to #4 and the streak continues
  await page.close();
  page = await newPage(ctx, '2026-10-27T03:59:00Z');
  await page.goto(BASE);
  await page.waitForSelector('#results.show');
  assert.strictEqual(await page.textContent('#pno'), '#3');
  await page.close();
  page = await newPage(ctx, '2026-10-27T04:00:30Z');
  await page.goto(BASE);
  await page.waitForSelector('#start.show');
  assert.strictEqual(await page.textContent('#pno'), '#4');
  const p4 = await prog(page);
  assert.notDeepStrictEqual(p4.locs.map(l => l.id), p.locs.map(l => l.id));
  await page.click('#startBtn');
  for (let i = 0; i < 5; i++) { await playRound(page, 0, 0); await next(page); }
  await page.waitForSelector('#results.show');
  assert.strictEqual(await page.textContent('#resTotal'), '500');
  assert.deepStrictEqual(await page.$$eval('#stats b', b => b.map(x => x.textContent)), ['2', '2', '2', '397']);
  step('23:59 ET is still #3; 00:00 ET starts #4 with new picks; perfect game → played 2 · streak 2');

  // skip a day: streak resets
  await page.close();
  page = await newPage(ctx, '2026-10-29T16:00:00Z');
  await page.goto(BASE);
  await page.waitForSelector('#start.show');
  await page.click('#startBtn');
  for (let i = 0; i < 5; i++) { await playRound(page, 2000, 0); await next(page); }
  await page.waitForSelector('#results.show');
  assert.deepStrictEqual(await page.$$eval('#stats b', b => b.map(x => x.textContent)).then(v => v.slice(0, 3)), ['3', '1', '2']);
  assert.strictEqual(await page.locator('#againBtn').count(), 0, 'no Play again');
  step('missing a day resets the streak (played 3 · streak 1 · best 2); no Play again');

  // before the epoch: no puzzle yet
  await page.close();
  page = await newPage(ctx, '2026-10-23T18:00:00Z');
  await page.goto(BASE);
  await page.waitForSelector('#oops.show');
  assert.match(await page.textContent('#oopsMsg'), /starts on October 24/);
  assert(!(await page.isVisible('#start.show')), 'no game before launch');
  step('the day before puzzle #1 says when it starts, with no game');
  await ctx.close();

  /* ---------------- extra spots: the closest spot scores ---------------- */
  {
    const multi = JSON.parse(JSON.stringify(DATA));
    multi.locations.forEach(l => { l.alt = [{ x: l.x + 600, z: l.z }]; });   // every location gets a second spot 600 blocks east
    multi.meta.timer = 0; multi.meta.epoch = '2026-10-24';
    const mctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const mp = await newPage(mctx, '2026-11-02T15:00:00Z');
    await mp.route('**/pintland/locations.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(multi) }));
    await mp.goto(BASE);
    await mp.waitForSelector('#start.show');
    await mp.click('#startBtn');
    const l0 = (await prog(mp)).locs[0];
    assert.strictEqual(l0.alt.length, 1, 'picked location carries its extra spot');
    await guessAt(mp, l0.x + 600, l0.z + 3);
    await lock(mp);
    assert.strictEqual(await mp.textContent('#rDist'), '3 blocks away', 'scored against the second spot');
    const r0 = (await prog(mp)).rounds[0];
    assert.deepStrictEqual([r0.ax, r0.az], [l0.x + 600, l0.z]);
    assert.strictEqual(await mp.locator('.ans.faint').count(), 1, 'the other spot is shown faded');
    await next(mp);
    const l1 = (await prog(mp)).locs[1];
    await guessAt(mp, l1.x + 10, l1.z);
    await lock(mp);
    assert.strictEqual(await mp.textContent('#rDist'), '10 blocks away', 'main spot still scores when closer');
    await mctx.close();
    step('a location with two spots scores against whichever is closer and shows the other faded');
  }

  /* ---------------- the guess clock ---------------- */
  {
    console.log('guess clock (4 s here; locations.json sets 10)');
    const tctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const real = await newPage(tctx, '2026-11-05T15:00:00Z', DATA.meta.timer, DATA.meta.epoch);
    await real.goto(BASE);
    await real.waitForSelector('#start.show');
    assert.strictEqual(DATA.meta.timer, 10);
    assert.strictEqual(await real.textContent('#ruleSecs'), '10 seconds', 'start card names the real clock');
    assert.strictEqual(DATA.meta.epoch, '2026-10-26', 'puzzle #1 is Oct 26');
    assert.strictEqual(await real.textContent('#pno'), '#11', 'Nov 5 is puzzle #11');
    assert.strictEqual(await real.textContent('#sKicker'), 'Puzzle #11');
    await real.close();

    const tp = await newPage(tctx, '2026-11-06T15:00:00Z', 4);
    await tp.goto(BASE);
    await tp.waitForSelector('#start.show');
    await tp.click('#startBtn');
    assert.match(await tp.textContent('#pClock'), /^[34]s$/);
    // a placed but unlocked guess locks in when the clock runs out
    const l0 = (await prog(tp)).locs[0];
    await guessAt(tp, l0.x + 10, l0.z);
    await tp.waitForFunction(() => window.ptGame.phase === 'reveal', null, { timeout: 8000 });
    let r = (await prog(tp)).rounds[0];
    assert(r.out && r.gx === l0.x + 10, 'guess locked in by the clock');
    assert.match(await tp.textContent('#rDist'), /10 blocks away · locked in by the clock/);
    await next(tp);
    // no guess at all scores 0
    await tp.waitForFunction(() => window.ptGame.phase === 'reveal', null, { timeout: 8000 });
    r = (await prog(tp)).rounds[1];
    assert.strictEqual(r.gx, null); assert.strictEqual(r.s, 0);
    assert.strictEqual(await tp.textContent('#rScore'), '0');
    assert.strictEqual(await tp.textContent('#rVerdict'), "Time's up");
    assert.strictEqual(await tp.textContent('#rDist'), 'No guess placed');
    await tilesLoaded(tp);
    await tp.screenshot({ path: path.join(OUT, 'game-timeup.png') });
    await next(tp);
    // a reload doesn't reset the clock
    await tp.waitForTimeout(2500);
    await tp.reload();
    await tp.waitForFunction(() => window.ptGame && window.ptGame.phase === 'guess');
    assert(!(await tp.isVisible('#start.show')), 'reload mid-round goes straight back to the round');
    assert.match(await tp.textContent('#pClock'), /^[12]s$/, 'clock kept running through the reload');
    await tp.waitForFunction(() => window.ptGame.phase === 'reveal', null, { timeout: 5000 });
    assert.strictEqual((await prog(tp)).rounds[2].s, 0);
    await next(tp);
    for (let i = 0; i < 2; i++) { await playRound(tp, 5, 0); await next(tp); }
    await tp.waitForSelector('#results.show');
    const rows = await tp.$$eval('#resRounds tr', t => t.map(x => x.textContent));
    assert.match(rows[1], /Time's up/); assert.match(rows[1], /no guess/);
    assert(!/Time's up/.test(rows[3]), 'locked rounds keep their verdict');
    step('10 s on the start card; a placed guess locks in at 0 s, no guess scores 0, a reload keeps the clock');
    await tctx.close();
  }

  /* ---------------- phone ---------------- */
  console.log('phone 390x844, touch');
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ph = await newPage(pctx, '2026-10-26T15:00:00Z');
  await ph.goto(BASE);
  await ph.waitForSelector('#start.show');
  await tilesLoaded(ph);
  await ph.screenshot({ path: path.join(OUT, 'phone-start.png') });
  await ph.tap('#startBtn');
  const pv = await ph.evaluate(() => { const b = window.ptGame.map.getBounds(); return [b.getWest(), b.getEast()]; });
  assert(pv[0] <= -3500 && pv[1] >= 3500, 'whole box fits on a phone');
  assert(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  await tilesLoaded(ph);
  await ph.screenshot({ path: path.join(OUT, 'phone-round.png') });
  // a drag pans the map and must not place a guess
  await ph.evaluate(() => window.ptGame.map.setZoom(2, { animate: false }));
  const c0 = await ph.evaluate(() => window.ptGame.map.getCenter());
  const cdp = await pctx.newCDPSession(ph);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 450 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 - i * 12, y: 450 - i * 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await ph.waitForTimeout(400);
  const c1 = await ph.evaluate(() => window.ptGame.map.getCenter());
  assert(Math.abs(c1.lng - c0.lng) > 10, 'touch drag panned the map');
  assert(await ph.isDisabled('#lockBtn'), 'drag did not place a guess');
  await playRound(ph, 30, -40, { tap: true });
  assert.strictEqual(await ph.textContent('#rScore'), '78');
  await tilesLoaded(ph);
  await ph.screenshot({ path: path.join(OUT, 'phone-reveal.png') });
  await next(ph, true);
  for (let i = 0; i < 4; i++) { await playRound(ph, 60, 80, { tap: true }); await next(ph, true); }
  await ph.waitForSelector('#results.show');
  await ph.screenshot({ path: path.join(OUT, 'phone-results.png') });
  await ph.tap('#reviewBtn');
  await tilesLoaded(ph);
  await ph.screenshot({ path: path.join(OUT, 'phone-review.png') });
  step('phone: drag pans without guessing, tap to guess, tap to lock, results and review');
  await pctx.close();

  /* ---------------- login required ---------------- */
  const lctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const lp = await lctx.newPage();
  await lp.goto('http://127.0.0.1:8129/pintland/index.html');
  await lp.waitForSelector('#login.show');
  assert.strictEqual(await lp.getAttribute('#login a', 'href'), '/login.html');
  assert.strictEqual(await lp.evaluate(() => document.querySelectorAll('img.leaflet-tile').length), 0, 'no map without login');
  await lp.screenshot({ path: path.join(OUT, 'game-login.png') });
  step('login-required card links to /login.html');
  await lctx.close();

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('all game checks passed; screenshots in ' + OUT);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
