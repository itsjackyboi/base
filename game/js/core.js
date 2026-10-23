/* Pintland Tap — core: Dynmap tile layer, coordinates, scoring, daily picks, storage.
 * Everything here is pure logic or Leaflet plumbing; no DOM besides the tile <img>s. */
(function (global) {
  'use strict';

  var NATIVE_ZOOM = 5;      // Dynmap flat: zoom 5 = base tiles (4 px per block); zoom 0 = 'zzzzz' tiles
  var PX_PER_BLOCK = 4;
  var TILE = 128;           // px, = 32 blocks
  var MAX_ZOOM = NATIVE_ZOOM + 2;
  var MIN_ZOOM = -3;        // below 0 the 'zzzzz' tiles are scaled down, so the whole box fits on a phone

  /* ---------- coordinates: 1 map unit = 1 block, lat = -z (north is up), lng = x ----------
   * Dynmap's HD projection (hdmap.js) puts lat = -(128 - mapY) / 2^mapzoomout, i.e. the tile grid starts one native
   * tile (32 blocks) north of z = 0. Base tiles look the same either way, but every zoomed-out tile is aligned to that
   * origin, so the CRS must carry the same offset or zoomed-out levels drift north by (2^k - 1) * 32 blocks. */
  function makeCRS() {
    var a = PX_PER_BLOCK / Math.pow(2, NATIVE_ZOOM), off = TILE / Math.pow(2, NATIVE_ZOOM);
    return L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(a, 0, -a, off) });
  }
  function toLL(x, z) { return L.latLng(-z, x); }
  function fromLL(ll) { return { x: ll.lng, z: -ll.lat }; }
  function boxToBounds(b) { return L.latLngBounds(toLL(b.x0, b.z0), toLL(b.x1, b.z1)); }
  function dist(a, b) { var dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
  /* A location is its main spot plus any extra spots in `alt` (several sewer entrances, two Tome Monuments...). */
  function spots(loc) { return [{ x: loc.x, z: loc.z }].concat(loc.alt || []); }
  /* The spot closest to p, and its distance: a guess scores against whichever spot it is nearest. */
  function nearest(p, loc) {
    var best = null;
    spots(loc).forEach(function (s) { var d = dist(p, s); if (!best || d < best.d) best = { x: s.x, z: s.z, d: d }; });
    return best;
  }

  /* ---------- Dynmap tile layer (same URL scheme as getTileInfo/getTileName in Dynmap's own page) ---------- */
  function tileUrl(base, c) {
    var k = NATIVE_ZOOM - c.z, f = Math.pow(2, k);
    var nx = c.x * f, ny = -c.y * f || 0;     // "Y is inverted for HD-map"; || 0 turns -0 into 0
    var prefix = k > 0 ? new Array(k + 1).join('z') + '_' : '';
    return base + Math.floor(nx / 32) + '_' + Math.floor(ny / 32) + '/' + prefix + nx + '_' + ny + '.jpg';
  }
  function tileBase(world, mapName) { return '/tiles/' + encodeURIComponent(world).replace(/'/g, '%27') + '/' + mapName + '/'; }
  function makeTileLayer(world, mapName) {
    var base = tileBase(world, mapName);
    var Layer = L.GridLayer.extend({
      createTile: function (c, done) {
        var img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.onload = function () { done(null, img); };
        img.onerror = function () { img.style.visibility = 'hidden'; done(null, img); };
        img.src = tileUrl(base, c);
        return img;
      }
    });
    return new Layer({
      tileSize: TILE, minNativeZoom: 0, maxNativeZoom: NATIVE_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
      noWrap: true, keepBuffer: 3, updateWhenIdle: false
    });
  }
  function makeMap(el) {
    var map = L.map(el, {
      crs: makeCRS(), minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomSnap: 0.25, zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90, attributionControl: false, zoomControl: false,
      maxBoundsViscosity: 0.85, doubleClickZoom: false
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    var sync = function () { el.classList.toggle('crisp', map.getZoom() > NATIVE_ZOOM + 0.01); };
    map.on('zoom', sync); sync();
    return map;
  }
  /* Lock the view to a box (blocks); players can't pan or zoom out beyond it. */
  function lockTo(map, box, pad) {
    var b = boxToBounds(box), padded = b.pad(pad == null ? 0.08 : pad);
    map.setMaxBounds(padded);
    map.setMinZoom(Math.max(MIN_ZOOM, map.getBoundsZoom(padded, false)));
    map.fitBounds(b, { animate: false });
  }

  /* ---------- scoring ---------- */
  /* One scale for every location: 100 within `perfect` blocks (0 = the exact block, since guesses and answers are
   * whole blocks), otherwise exponential falloff over the full distance with scale k (blocks), nothing subtracted.
   * k=200: 25 off -> 88, 50 -> 78, 100 -> 61, 200 -> 37, 500 -> 8. Tune k after play-testing. */
  function score(d, perfect, k) {
    if (d <= (perfect || 0)) return 100;
    return Math.min(99, Math.round(100 * Math.exp(-d / k)));
  }
  function verdict(s) {
    if (s >= 100) return 'Bullseye';
    if (s >= 90) return 'Spot on';
    if (s >= 70) return 'Close';
    if (s >= 40) return 'In the neighborhood';
    if (s >= 10) return 'Way off';
    return 'Lost at sea';
  }
  function tile(s) { return s >= 85 ? '🟩' : s >= 60 ? '🟨' : s >= 30 ? '🟧' : '🟥'; }

  /* ---------- daily puzzle ---------- */
  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* Walks through a freshly shuffled copy of the pool each "cycle", so nothing repeats until the pool is used up. */
  /* The whole pool in today's order: today's slot of this cycle's shuffle first, then the rest of the cycle. */
  function bagOrder(items, n, dayIdx, seedBase) {
    if (items.length <= n) return items.slice();
    var per = Math.floor(items.length / n), cycle = Math.floor(dayIdx / per), slot = dayIdx % per;
    var order = shuffled(items, mulberry32(seedBase + cycle * 7919));
    return order.slice(slot * n).concat(order.slice(0, slot * n));
  }
  function bagPick(items, n, dayIdx, seedBase) { return bagOrder(items, n, dayIdx, seedBase).slice(0, n); }
  /* Closest distance between any spot of a and any spot of b. */
  function gapBetween(a, b) {
    var best = Infinity;
    spots(a).forEach(function (p) { spots(b).forEach(function (q) { best = Math.min(best, dist(p, q)); }); });
    return best;
  }
  var DIFFS = ['easy', 'medium', 'hard', 'expert'];
  var DEFAULT_MIX = ['medium', 'hard', 'hard', 'expert', 'expert'];
  var MIN_GAP = 50;   // blocks: two picks on the same day are never closer than this, so one can't give the other away
  /* Daily rounds by difficulty mix (data.meta.mix, default 1 medium, 2 hard, 2 expert), easiest first. */
  function pickDaily(data, puzzleNo) {
    var mix = (data.meta && data.meta.mix) || DEFAULT_MIX;
    var gap = data.meta && data.meta.minGap != null ? data.meta.minGap : MIN_GAP;
    var day = puzzleNo - 1, want = {}, picks = [], have = {};
    function clear(l) { return picks.every(function (p) { return gapBetween(p, l) >= gap; }); }
    function take(seq, n) {   // first n of seq that keep their distance; if too few do, fill up from the rest in order
      var got = seq.filter(function (l) { return !have[l.id]; }).filter(function (l) {
        if (n > 0 && clear(l)) { picks.push(l); have[l.id] = 1; n--; return false; }
        return true;
      });
      got.slice(0, n).forEach(function (l) { picks.push(l); have[l.id] = 1; });
    }
    mix.forEach(function (d) { want[d] = (want[d] || 0) + 1; });
    DIFFS.forEach(function (d, i) {
      if (!want[d]) return;
      var pool = data.locations.filter(function (l) { return l.difficulty === d; });
      take(bagOrder(pool, want[d], day, 101 + i * 53), Math.min(want[d], pool.length));
    });
    if (picks.length < mix.length) {                           // a difficulty pool ran short: top up from anything left
      take(shuffled(data.locations.filter(function (l) { return !have[l.id]; }), mulberry32(303 + day)), mix.length - picks.length);
    }
    return picks.map(function (p, i) { return { p: p, i: i }; })
      .sort(function (a, b) { return (DIFFS.indexOf(a.p.difficulty) - DIFFS.indexOf(b.p.difficulty)) || (a.i - b.i); })
      .map(function (o) { return o.p; });
  }
  function ymd(tz, date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date || new Date());
  }
  function puzzleNumber(tz, epoch, date) {
    var a = Date.parse(ymd(tz, date) + 'T00:00:00Z'), b = Date.parse(epoch + 'T00:00:00Z');
    return Math.max(1, Math.round((a - b) / 86400000) + 1);
  }
  function secondsToNext(tz, date) {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date || new Date());
    var v = {}; parts.forEach(function (p) { v[p.type] = parseInt(p.value, 10); });
    return 86400 - (v.hour * 3600 + v.minute * 60 + v.second);
  }

  /* ---------- storage (never throws) ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  global.PT = {
    NATIVE_ZOOM: NATIVE_ZOOM, MIN_ZOOM: MIN_ZOOM, MAX_ZOOM: MAX_ZOOM,
    makeCRS: makeCRS, toLL: toLL, fromLL: fromLL, boxToBounds: boxToBounds, dist: dist, spots: spots, nearest: nearest,
    tileBase: tileBase, tileUrl: tileUrl, makeTileLayer: makeTileLayer, makeMap: makeMap, lockTo: lockTo,
    DIFFS: DIFFS, DEFAULT_MIX: DEFAULT_MIX, MIN_GAP: MIN_GAP, gapBetween: gapBetween, score: score, verdict: verdict, tile: tile,
    mulberry32: mulberry32, shuffled: shuffled, bagOrder: bagOrder, bagPick: bagPick, pickDaily: pickDaily,
    ymd: ymd, puzzleNumber: puzzleNumber, secondsToNext: secondsToNext, store: store
  };
})(typeof window !== 'undefined' ? window : globalThis);
