/* End-to-end check of placer.html against tools/mock_dynmap.py.
 *   python3 tools/mock_dynmap.py --port 8128 &
 *   python3 tools/mock_dynmap.py --port 8129 --login-required &
 *   NODE_PATH=$(npm root -g) node tests/placer.e2e.js [screenshot-dir]
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8128/pintland/placer.html';
const LOGIN_BASE = 'http://127.0.0.1:8129/pintland/placer.html';
const OUT = process.argv[2] || path.join(__dirname, 'screens');
fs.mkdirSync(OUT, { recursive: true });

function step(msg) { console.log('  ✓ ' + msg); }

async function tilesLoaded(page) {
  await page.waitForFunction(() => document.querySelectorAll('img.leaflet-tile-loaded').length > 4, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
async function mapCenterPx(page) {
  const b = await page.locator('#map').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function readout(page) {
  return (await page.locator('#rx').textContent()) + ', ' + (await page.locator('#rz').textContent());
}
/* colour of the tile pixel under a screen point, read from the tile <img> itself (same origin) */
async function tilePixel(page, x, y) {
  return page.evaluate(([x, y]) => {
    const imgs = Array.from(document.querySelectorAll('img.leaflet-tile-loaded')).filter(i => {
      const r = i.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom && i.style.visibility !== 'hidden';
    });
    const img = imgs[imgs.length - 1]; if (!img) return null;
    const r = img.getBoundingClientRect(), c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.floor((x - r.left) / r.width * 128), Math.floor((y - r.top) / r.height * 128), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
}
async function loc(page, name) {
  return page.evaluate(n => { const l = window.placer.state.locations.find(l => l.name === n); return l && { ...l }; }, name);
}
async function gotoXZ(page, txt) {
  await page.fill('#gotoIn', txt);
  await page.click('#gotoForm button');
  await page.waitForTimeout(500);
  await tilesLoaded(page);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- laptop ---------------- */
  console.log('laptop 1366x820');
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await tilesLoaded(page);
  assert.strictEqual(await page.locator('#loginModal.show').count(), 0, 'no login card when /up/configuration is {}');
  assert.strictEqual(await page.locator('#list .row').count(), 152, 'wishlist is seeded (71 + 58 + 23)');
  await page.screenshot({ path: path.join(OUT, 'laptop-overview.png') });
  step('loads, tiles render, wishlist seeded (152), no login card');

  // whole box visible at start
  const fit = await page.evaluate(() => { const b = window.placer.map.getBounds(); return [b.getWest(), b.getEast(), -b.getNorth(), -b.getSouth()]; });
  assert(fit[0] <= -3500 && fit[1] >= 3500 && fit[2] <= -3500 && fit[3] >= 3500, 'initial view shows the whole box: ' + fit);
  step('initial view contains the whole 7000 × 7000 box');

  // cursor readout and tile alignment: the mock paints a red block at every multiple of 100
  await gotoXZ(page, '100, -200');
  let c = await mapCenterPx(page);
  await page.mouse.move(c.x, c.y);
  assert.strictEqual(await readout(page), '100, −200');
  let px = await tilePixel(page, c.x, c.y);
  assert(px && px[0] > 170 && px[1] < 90, 'red marker block under cursor at 100, -200, got ' + px);
  px = await tilePixel(page, c.x + 6, c.y);   // one block east (4 px/block at zoom 5) is not red
  assert(px && px[0] < 150, 'block east of it is not red, got ' + px);
  await gotoXZ(page, '0 64 0');                // F3-style x y z
  c = await mapCenterPx(page);
  await page.mouse.move(c.x, c.y);
  assert.strictEqual(await readout(page), '0, 0');
  px = await tilePixel(page, c.x, c.y);
  assert(px && px[0] > 200 && px[1] > 200 && px[2] > 200, 'white origin block, got ' + px);
  step('readout and go-to match tile content block-for-block (100,-200 red; 0,0 white; F3 x y z parsed)');

  // every zoom level must draw the world in the same place: probe just inside and just outside the north edge of the
  // mock's white square (x 1000..1095, z -1000..-905). Zoomed-out tiles used to drift north by (2^k - 1) * 32 blocks.
  for (const zoom of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const bpp = 1 / (4 * Math.pow(2, zoom - 5)), off = Math.max(2, Math.ceil(4 * bpp));
    await page.evaluate(([zoom]) => window.placer.map.setView(L.latLng(1000, 1048), zoom, { animate: false }), [zoom]);
    await page.waitForFunction(z => { const m = window.placer.map; let ok = false;
      m.eachLayer(l => { if (l instanceof L.GridLayer && l._loading === false && l._tileZoom === Math.min(5, Math.max(0, z))) ok = true; }); return ok; }, zoom);
    await page.waitForTimeout(300);
    const probe = (x, z) => page.evaluate(([x, z]) => {
      const m = window.placer.map; let layer; m.eachLayer(l => { if (l instanceof L.GridLayer) layer = l; });
      const p = m.latLngToContainerPoint(L.latLng(-z, x)), r0 = m.getContainer().getBoundingClientRect(), sx = r0.left + p.x, sy = r0.top + p.y;
      const img = Array.from(layer._levels[layer._tileZoom].el.querySelectorAll('img.leaflet-tile-loaded')).find(i => {
        const r = i.getBoundingClientRect(); return sx >= r.left && sx < r.right && sy >= r.top && sy < r.bottom; });
      if (!img) return null;
      const r = img.getBoundingClientRect(), c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(Math.floor((sx - r.left) / r.width * 128), Math.floor((sy - r.top) / r.height * 128), 1, 1).data).slice(0, 3);
    }, [x, z]);
    const inside = await probe(1048.5, -1000 + off + 0.5), outside = await probe(1048.5, -1000 - off + 0.5);
    const white = px => px && px[0] > 200 && px[1] > 200 && px[2] > 200;
    assert(white(inside) && !white(outside), 'zoom ' + zoom + ': square edge in place (inside ' + inside + ', outside ' + outside + ')');
  }
  step('tiles line up at every zoom level 0–7 (edge of a 96-block square stays put)');
  await page.evaluate(() => window.placer.map.setView(L.latLng(-0.5, 0.5), 5, { animate: false }));

  // zoom to block level and back out with the buttons
  await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(350);
  await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(350);
  await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(350);
  await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(350);
  const zMax = await page.evaluate(() => window.placer.map.getZoom());
  assert.strictEqual(zMax, 7, 'zoom-in reaches max zoom 7 (16 px per block)');
  assert(await page.locator('#map.crisp').count() === 1, 'pixelated rendering past native zoom');
  await page.screenshot({ path: path.join(OUT, 'laptop-block-level.png') });
  await gotoXZ(page, '512, -300');
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, 600); await page.waitForTimeout(600);
  assert(await page.evaluate(() => window.placer.map.getZoom()) < 7, 'wheel zooms out');
  step('+/− and wheel zoom work; block level is crisp');

  // place a wishlist item
  await gotoXZ(page, '400, -500');
  await page.locator('#list .row[data-id="providence"]').first().click();
  assert(await page.locator('#armbar.show').count() === 1, 'arm bar shown');
  c = await mapCenterPx(page);
  await page.mouse.move(c.x + 40, c.y + 20);
  const expectRead = await readout(page);
  await page.mouse.click(c.x + 40, c.y + 20);
  let p = await loc(page, 'Providence');
  assert.strictEqual(fmt(p.x) + ', ' + fmt(p.z), expectRead, 'placed where the readout said');
  assert(await page.locator('#list .row[data-id="providence"]').locator('.st.ok').count() === 1, 'check mark');
  step('placed Providence from the wishlist at ' + expectRead);

  // drag the pin 80 px east, 40 px south at the current zoom
  const zoom = await page.evaluate(() => window.placer.map.getZoom());
  const pin = page.locator('.leaflet-marker-icon.pin.sel');
  const pb = await pin.boundingBox();
  const tip = { x: pb.x + 12, y: pb.y + 31 };
  await page.mouse.move(tip.x, tip.y - 12);
  await page.mouse.down();
  await page.mouse.move(tip.x + 40, tip.y + 8, { steps: 6 });
  await page.mouse.move(tip.x + 80, tip.y + 28, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const p2 = await loc(page, 'Providence');
  const bpp = 1 / (4 * Math.pow(2, zoom - 5));   // blocks per screen px
  assert(Math.abs((p2.x - p.x) - 80 * bpp) <= 2 && Math.abs((p2.z - p.z) - 40 * bpp) <= 2,
    'drag moved pin by ~' + 80 * bpp + ', ' + 40 * bpp + ' blocks; got ' + (p2.x - p.x) + ', ' + (p2.z - p.z));
  step('dragged Providence pin: ' + fmt(p.x) + ',' + fmt(p.z) + ' → ' + fmt(p2.x) + ',' + fmt(p2.z));

  // re-arm a placed item via its Move button
  const moveBtn = page.locator('#list .row[data-id="providence"]').locator('[data-arm]');
  await moveBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));   // keep it clear of the sticky group header
  await moveBtn.click();
  await page.mouse.click(c.x - 100, c.y - 60);
  const p3 = await loc(page, 'Providence');
  assert(p3.x < p2.x && p3.z < p2.z, 're-armed and moved');
  step('re-armed Providence and moved it');

  // add a custom NPC
  await page.click('#addBtn');
  await page.fill('#adName', 'Barnaby the Ferryman');
  await page.selectOption('#adKind', 'npc');
  await page.selectOption('#adDiff', 'expert');
  await page.fill('#adHint', 'Waits on the east dock');
  await page.click('#addForm button[type=submit]');
  await page.mouse.click(c.x + 150, c.y - 30);
  const npc = await loc(page, 'Barnaby the Ferryman');
  assert(npc && npc.kind === 'npc' && npc.difficulty === 'expert' && npc.x !== null && npc.id === 'barnaby-the-ferryman' && !npc.seed);
  step('added custom NPC "Barnaby the Ferryman" (' + npc.id + ') at ' + fmt(npc.x) + ', ' + fmt(npc.z));

  // a duplicate name gets a unique id
  await page.click('#addBtn');
  await page.fill('#adName', 'Barnaby the Ferryman');
  await page.click('#addForm button[type=submit]');
  await page.mouse.click(c.x + 200, c.y + 80);
  const ids = await page.evaluate(() => window.placer.state.locations.filter(l => l.name === 'Barnaby the Ferryman').map(l => l.id));
  assert.deepStrictEqual(ids, ['barnaby-the-ferryman', 'barnaby-the-ferryman-2']);
  step('duplicate name gets id barnaby-the-ferryman-2');

  // edit difficulty from the row select, then edit the hint in the editor
  await page.locator('#list .row[data-id="aleforge-castle"] select').selectOption('expert');
  assert.strictEqual((await loc(page, 'Aleforge Castle')).difficulty, 'expert');
  await page.click('#list .row[data-id="barnaby-the-ferryman"]');
  await page.fill('#editor [data-f=hint]', 'Rings a bell for the ferry');
  await page.press('#editor [data-f=hint]', 'Enter');
  assert.strictEqual((await loc(page, 'Barnaby the Ferryman')).hint, 'Rings a bell for the ferry');
  step('changed a suggested difficulty and edited a hint');

  // delete, then undo
  await page.click('#list .row[data-id="barnaby-the-ferryman-2"]');
  await page.click('#editor [data-act=delete]');
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.filter(l => l.name === 'Barnaby the Ferryman').length), 1);
  await page.click('#undoBtn');
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.filter(l => l.name === 'Barnaby the Ferryman').length), 2);
  await page.click('#list .row[data-id="barnaby-the-ferryman-2"]');
  await page.click('#editor [data-act=delete]');
  await page.keyboard.press('Escape');
  await page.click('#list [data-del="sea-monster-ribcage"]');
  assert.strictEqual(await loc(page, 'Sea Monster Ribcage'), undefined, 'row × deletes');
  await page.keyboard.press('Control+z');
  assert(await loc(page, 'Sea Monster Ribcage'), 'Ctrl+Z brings it back');
  step('delete + undo restores the location (editor button, row ×, Ctrl+Z)');

  // filters
  await page.locator('#fDiff [data-d=hard]').click();
  let diffs = await page.$$eval('#list .row select', s => [...new Set(s.map(x => x.value))]);
  assert.deepStrictEqual(diffs, ['hard']);
  await page.locator('#fKind [data-k=npc]').click();
  let names = await page.$$eval('#list .row .nm', n => n.map(x => x.textContent));
  assert(names.length > 3 && names.includes('Wagwan') && !names.includes('Owe Block'), 'hard npcs: ' + names);
  await page.locator('#fStatus [data-v=placed]').click();
  assert.strictEqual(await page.locator('#list .row').count(), 0);
  await page.click('#clearF');
  await page.locator('#fStatus [data-v=placed]').click();
  names = await page.$$eval('#list .row .nm', n => n.map(x => x.textContent));
  assert.deepStrictEqual(names.sort(), ['Barnaby the Ferryman', 'Providence']);
  await page.locator('#fStatus [data-v=all]').click();
  await page.fill('#q', 'shrine');
  names = await page.$$eval('#list .row .nm', n => n.map(x => x.textContent));
  assert.strictEqual(names.filter(n => /Shrine$/.test(n)).length, 5, 'five shrines: ' + names);
  assert(names.includes("Tomb of Aleforge's Original Brewer") && names.includes('Friar Leo'), 'search also matches placement notes');
  await page.fill('#q', 'bar in the forest');   // hint search
  names = await page.$$eval('#list .row .nm', n => n.map(x => x.textContent));
  assert.deepStrictEqual(names, ['Thorny Thicket']);
  await page.fill('#q', '');
  const counts = await page.$$eval('#counts .count .num', n => n.map(x => x.textContent));
  step('filters by difficulty, kind, placed/unplaced, search (names and hints); counts ' + counts.join(' | '));

  // grid on, laptop screenshots
  await page.click('#fitT'); await page.waitForTimeout(500);
  await page.click('#gridT');
  assert(await page.locator('#gridlabels div').count() > 20, 'grid labels drawn');
  await tilesLoaded(page);
  await page.screenshot({ path: path.join(OUT, 'laptop-grid.png') });
  await page.locator('#list .row[data-id="providence"]').click();
  await page.waitForTimeout(600);
  await tilesLoaded(page);
  await page.screenshot({ path: path.join(OUT, 'laptop-selected.png') });
  step('grid toggle with labels; screenshots saved');

  // reload: draft and UI survive
  const before = await page.evaluate(() => JSON.stringify(window.placer.state.locations));
  await page.reload();
  await tilesLoaded(page);
  const after = await page.evaluate(() => JSON.stringify(window.placer.state.locations));
  assert.strictEqual(after, before, 'draft survived reload');
  assert(await page.locator('#gridT.on').count() === 1, 'grid toggle remembered');
  step('reload keeps the draft (' + JSON.parse(after).filter(l => l.x !== null).length + ' placed) and the grid toggle');

  // export
  await page.click('#exportBtn');
  const sel = await page.evaluate(() => { const t = document.getElementById('exportText'); return [t.selectionStart, t.selectionEnd, t.value.length]; });
  assert(sel[0] === 0 && sel[1] === sel[2], 'export textarea is fully selected');
  const exported = await page.inputValue('#exportText');
  const data = JSON.parse(exported);
  assert.strictEqual(data.meta.world, "Jack's Long Island Iced Tea (World 1)-2");
  assert.deepStrictEqual(data.meta.mix, ['medium', 'hard', 'hard', 'expert', 'expert']);
  assert.deepStrictEqual(data.meta.scoring, { k: 200, perfect: 0 });
  assert.deepStrictEqual(data.play, { x0: -3500, z0: -3500, x1: 3500, z1: 3500 });
  assert.strictEqual(data.locations.length, 2);
  data.locations.forEach(l => assert.deepStrictEqual(Object.keys(l), ['id', 'name', 'kind', 'difficulty', 'hint', 'x', 'z']));
  assert.strictEqual(data.unplaced.length, 151);
  assert.strictEqual(data.wishlistBatch, 3);
  assert(data.unplaced.find(l => l.id === 'liquor-king-cemetery' && /Plindor/.test(l.note)), 'batch 2 notes exported');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exDownload')]);
  assert.strictEqual(dl.suggestedFilename(), 'locations.json');
  const dlText = fs.readFileSync(await dl.path(), 'utf8');
  assert.strictEqual(dlText, exported, 'download matches textarea');
  fs.writeFileSync(path.join(OUT, 'exported-locations.json'), exported);
  await page.screenshot({ path: path.join(OUT, 'laptop-export.png') });
  await page.keyboard.press('Escape');
  step('export: schema ok, textarea selected, download identical');

  // start over, then import the export back
  page.once('dialog', d => d.accept());
  await page.click('#importBtn');
  await page.click('#imReset');
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.filter(l => l.x !== null).length), 0);
  await page.click('#importBtn');
  await page.setInputFiles('#imFile', { name: 'locations.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await page.waitForFunction(() => document.getElementById('imText').value.length > 100);
  await page.click('#imGo');
  await page.click('#exportBtn');
  assert.strictEqual(await page.inputValue('#exportText'), exported, 'import → export round-trips exactly');
  await page.keyboard.press('Escape');
  step('start over, import from file, re-export is byte-identical');

  // extra spots: a location can have several spots; they export, import back, and can be removed
  await page.click('#list .row[data-id="providence"]');
  await page.waitForTimeout(300);
  await page.click('#editor [data-act="addspot"]');
  assert.match(await page.textContent('#armName'), /another spot for Providence/);
  const mc = await mapCenterPx(page);
  await page.mouse.move(mc.x - 120, mc.y + 70);
  const spotRead = await readout(page);
  await page.mouse.click(mc.x - 120, mc.y + 70);
  let prov = await loc(page, 'Providence');
  assert.strictEqual(prov.alt.length, 1);
  assert.strictEqual(fmt(prov.alt[0].x) + ', ' + fmt(prov.alt[0].z), spotRead, 'extra spot placed where the readout said');
  assert.strictEqual(await page.locator('.leaflet-marker-icon.pin').filter({ hasText: '2' }).count(), 1, 'numbered pin for spot 2');
  assert.match(await page.textContent('#editor .spots'), /Spots[\s\S]*1[\s\S]*2/);
  await page.click('#exportBtn');
  const withAlt = JSON.parse(await page.inputValue('#exportText'));
  assert.deepStrictEqual(withAlt.locations.find(l => l.id === 'providence').alt, prov.alt);
  await page.keyboard.press('Escape');
  await page.click('#importBtn');
  await page.fill('#imText', JSON.stringify(withAlt));
  await page.click('#imGo');
  assert.deepStrictEqual((await loc(page, 'Providence')).alt, prov.alt, 'alt survives import');
  await page.click('#list .row[data-id="providence"]');
  await page.click('#editor [data-rmspot="0"]');
  assert.strictEqual((await loc(page, 'Providence')).alt.length, 0);
  await page.keyboard.press('Control+z');
  assert.strictEqual((await loc(page, 'Providence')).alt.length, 1, 'undo restores the removed spot');
  await page.click('#editor [data-rmspot="0"]');
  await page.keyboard.press('Escape');
  step('extra spot: + Add another spot, numbered pin, export/import keep it, remove + undo');

  // a hand-made file without "unplaced" keeps the rest of the wishlist
  await page.click('#importBtn');
  await page.fill('#imText', JSON.stringify({ locations: [{ name: 'Providence', kind: 'town', difficulty: 'easy', x: 1, z: 2 }] }));
  await page.click('#imGo');
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.length), 152);
  await page.click('#undoBtn');
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.filter(l => l.x !== null).length), 2);
  step('minimal import keeps the wishlist; undo reverts the import');

  // an old draft (before the lore picks) gets the 58 new wishlist entries merged in once
  await page.evaluate(() => localStorage.setItem('pintland-placer-draft-v1', JSON.stringify({ meta: {}, play: {},
    locations: [{ id: 'providence', name: 'Providence', kind: 'town', difficulty: 'easy', x: 1, z: 2 }] })));
  await page.reload();
  await tilesLoaded(page);
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.length), 82);
  await page.waitForFunction(() => /81 new locations added/.test(document.getElementById('toast').textContent));
  await page.waitForTimeout(700);
  await page.reload();
  await tilesLoaded(page);
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.length), 82, 'merged only once');
  // a draft already on batch 2 gets only batch 3
  await page.evaluate(() => localStorage.setItem('pintland-placer-draft-v1', JSON.stringify({ meta: {}, play: {}, wishlistBatch: 2,
    locations: [{ id: 'providence', name: 'Providence', kind: 'town', difficulty: 'easy', x: 1, z: 2 }] })));
  await page.reload();
  await tilesLoaded(page);
  assert.strictEqual(await page.evaluate(() => window.placer.state.locations.length), 24);
  assert(await loc(page, "The Hog's Hog"), 'batch 3 tavern added');
  step('old drafts get the newer wishlist batches merged in once (batch 1 draft +81, batch 2 draft +23)');

  // pin check: a pin placed 480 blocks north of its real spot (in the mock's ocean) is flagged, and the 480-south
  // tile moves it onto land; a correct pin isn't flagged
  await page.click('#importBtn');
  await page.fill('#imText', JSON.stringify({ locations: [
    { name: 'Shifted Town', kind: 'town', difficulty: 'easy', x: 850, z: -1080 },
    { name: 'Good Town', kind: 'town', difficulty: 'easy', x: 850, z: -600 } ], unplaced: [] }));
  await page.click('#imGo');
  await page.click('#auditBtn');
  await page.waitForSelector('#auList .arow .thumb');
  await page.waitForFunction(() => document.querySelectorAll('#auList .thumb .wet').length >= 1);
  await page.waitForTimeout(500);
  const rows = await page.$$eval('#auList .arow', r => r.map(x => [x.dataset.id, !!x.querySelector('.st.wet')]));
  assert.deepStrictEqual(rows, [['shifted-town', true], ['good-town', false]], 'flagged pin first: ' + JSON.stringify(rows));
  assert.strictEqual(await page.locator('#auList .arow[data-id="shifted-town"] .thumb[data-shift="480"] .wet').count(), 0, '480 south is land');
  await page.screenshot({ path: path.join(OUT, 'laptop-pin-check.png') });
  await page.click('#auList .arow[data-id="shifted-town"] .thumb[data-shift="480"]');
  assert.strictEqual((await loc(page, 'Shifted Town')).z, -600);
  await page.waitForFunction(() => /moved 480 south/.test(document.querySelector('#auList .arow[data-id="shifted-town"]').textContent));
  await page.click('#auList .arow[data-id="good-town"] [data-au="ok"]');
  await page.waitForFunction(() => /2 pins · 0 in water · 2 checked/.test(document.getElementById('auSum').textContent));
  await page.keyboard.press('Control+z');
  assert.strictEqual((await loc(page, 'Shifted Town')).z, -1080, 'undo works from the pin check');
  await page.keyboard.press('Escape');
  step('pin check flags a pin in water, its 480-south tile moves it onto land, "Looks right" marks the other, undo works');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await ctx.close();

  /* ---------------- phone ---------------- */
  console.log('phone 390x844');
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ph = await pctx.newPage();
  ph.on('pageerror', e => errors.push(e.message));
  await ph.goto(BASE);
  await tilesLoaded(ph);
  const pfit = await ph.evaluate(() => { const b = window.placer.map.getBounds(); return [b.getWest(), b.getEast()]; });
  assert(pfit[0] <= -3500 && pfit[1] >= 3500, 'whole box width fits on a phone: ' + pfit);
  const noScroll = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(noScroll, 'no horizontal scroll');
  await ph.screenshot({ path: path.join(OUT, 'phone-map.png') });
  await ph.tap('#drawerBtn'); await ph.waitForTimeout(350);
  await ph.screenshot({ path: path.join(OUT, 'phone-list.png') });
  await ph.locator('#list .row', { hasText: 'Aleforge' }).first().tap();
  await ph.waitForTimeout(350);
  assert(await ph.evaluate(() => !document.body.classList.contains('drawer')), 'drawer closes when arming');
  const pc = await mapCenterPx(ph);
  await ph.touchscreen.tap(pc.x, pc.y);
  const al = await loc(ph, 'Aleforge');
  assert(al.x !== null, 'tap placed Aleforge');
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: path.join(OUT, 'phone-placed.png') });
  step('phone: whole box fits, drawer list, tap to place (Aleforge at ' + fmt(al.x) + ', ' + fmt(al.z) + ')');
  await pctx.close();

  /* ---------------- login required ---------------- */
  const lctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const lp = await lctx.newPage();
  await lp.goto(LOGIN_BASE);
  await lp.waitForSelector('#loginModal.show');
  assert.strictEqual(await lp.getAttribute('#loginModal a', 'href'), '/login.html');
  await lp.screenshot({ path: path.join(OUT, 'login-required.png') });
  step('login-required card links to /login.html');
  await lctx.close();

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('all placer checks passed; screenshots in ' + OUT);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

function fmt(n) { return n < 0 ? '−' + Math.abs(n) : String(n); }
