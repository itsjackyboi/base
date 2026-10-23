/* Pintland Tap — the daily game. Needs Leaflet and core.js (PT). */
(function () {
  'use strict';

  var GAME_KEY = 'pt-game-v1-', STATS_KEY = 'pt-stats-v1';
  var GLYPH = { town: 'T', building: 'B', landmark: 'L', npc: 'N', other: '•' };
  var SQ_COLOR = { '🟩': 'var(--green)', '🟨': 'var(--yellow)', '🟧': 'var(--orange)', '🟥': 'var(--red)' };
  var $ = function (id) { return document.getElementById(id); };
  var TAP = window.matchMedia && window.matchMedia('(hover: none)').matches ? 'Tap' : 'Click';

  var data, meta, play, day, prog, map, N, pool;
  var phase = 'loading';          // start | guess | reveal | results | review
  var guess = null, guessMarker = null, layers = null;

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function blockCenter(x, z) { return PT.toLL(x + 0.5, z + 0.5); }
  function blockAt(ll) { return { x: Math.floor(ll.lng), z: Math.floor(-ll.lat) }; }
  function inPlay(b) { return b.x >= play.x0 && b.x < play.x1 && b.z >= play.z0 && b.z < play.z1; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function addDays(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function show(id, on) { $(id).classList.toggle('show', !!on); }
  function fail(msg) { $('oopsMsg').textContent = msg; show('oops', true); }

  /* Today's puzzle in meta.tz. Days before the epoch are an unnumbered preview with their own picks. */
  function today() {
    var ymd = PT.ymd(meta.tz), n = Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.parse(meta.epoch + 'T00:00:00Z')) / 86400000) + 1;
    return n >= 1 ? { ymd: ymd, no: n, seedNo: n, label: '#' + n }
                  : { ymd: ymd, no: 0, seedNo: 5000 - n, label: 'Preview' };
  }

  /* ---------------- boot ---------------- */
  fetch('/up/configuration', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (c) { if (c && c.error === 'login-required') { show('login', true); throw 'login'; } })
    .catch(function (e) { if (e === 'login') throw e; /* Dynmap unreachable: try anyway */ })
    .then(function () { return fetch('locations.json', { cache: 'no-cache' }); })
    .then(function (r) { if (!r.ok) throw new Error('locations.json: HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) { if (e !== 'login') fail(e && e.message ? e.message : String(e)); });

  function init(d) {
    data = d;
    meta = Object.assign({ tz: 'America/New_York', epoch: '2026-10-24', mix: ['easy', 'medium', 'medium', 'hard', 'expert'],
      scoring: { k: 200, perfect: 0 }, world: "Jack's Long Island Iced Tea (World 1)-2", mapName: 'flat' }, d.meta || {});
    meta.scoring = Object.assign({ k: 200, perfect: 0 }, meta.scoring || {});
    play = d.play || { x0: -3500, z0: -3500, x1: 3500, z1: 3500 };
    pool = (d.locations || []).filter(function (l) {
      return l && l.id && l.name && isFinite(l.x) && isFinite(l.z) && PT.DIFFS.indexOf(l.difficulty) >= 0;
    });
    if (pool.length < 1) return fail('locations.json has no placed locations yet.');

    day = today();
    prog = PT.store.get(GAME_KEY + day.ymd, null);
    if (!prog || !Array.isArray(prog.locs) || !prog.locs.length) { prog = newProg(day.seedNo, 1); save(); }
    N = prog.locs.length;

    map = PT.makeMap($('map'));
    PT.makeTileLayer(meta.world, meta.mapName || 'flat').addTo(map);
    PT.lockTo(map, play, 0.05);
    map.on('resize', function () { map.setMinZoom(Math.max(PT.MIN_ZOOM, map.getBoundsZoom(PT.boxToBounds(play).pad(0.05), false))); });
    L.rectangle(PT.boxToBounds(play), { color: '#C9A84C', weight: 2, fill: false, interactive: false }).addTo(map);
    layers = L.layerGroup().addTo(map);
    map.on('click', onMapClick);

    $('pno').textContent = day.label;
    $('lockBtn').onclick = lockIn;
    $('nextBtn').onclick = next;
    $('startBtn').onclick = function () { show('start', false); if (phase === 'start') startRound(); };
    $('ruleScore').textContent = '100 for the exact block, ' + PT.score(25, meta.scoring.perfect, meta.scoring.k) + ' at 25 blocks off, ' +
      PT.score(100, meta.scoring.perfect, meta.scoring.k) + ' at 100.';
    $('helpBtn').onclick = function () { $('startBtn').textContent = phase === 'start' ? 'Play' : 'Back'; show('start', true); };
    $('reviewBtn').onclick = review;
    $('backBtn').onclick = showResults;
    $('copyBtn').onclick = copyShare;
    $('againBtn').onclick = playAgain;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (phase === 'guess' && guess) lockIn(); else if (phase === 'reveal') next();
    });

    renderTop();
    if (prog.rounds.length >= N) showResults();
    else if (prog.rounds.length > prog.ack) showReveal(prog.rounds.length - 1, false);   // reloaded on a reveal
    else if (prog.rounds.length > 0) startRound();
    else { phase = 'start'; $('sKicker').textContent = day.no ? 'Puzzle ' + day.label : 'Preview · unlimited games'; show('start', true); }
  }

  /* Freeze a game's picks (with their positions) so a mid-day edit to locations.json can't change a game in progress. */
  function newProg(seedNo, attempt) {
    var picks = PT.pickDaily({ meta: meta, locations: pool }, seedNo);
    return { ymd: day.ymd, no: day.no, label: day.label, attempt: attempt, ack: 0, rounds: [], locs: picks.map(function (l) {
      return { id: l.id, name: l.name, kind: l.kind || 'other', difficulty: l.difficulty, hint: l.hint || '', x: Math.floor(l.x), z: Math.floor(l.z),
        alt: (Array.isArray(l.alt) ? l.alt : []).filter(function (a) { return a && isFinite(a.x) && isFinite(a.z); })
          .map(function (a) { return { x: Math.floor(a.x), z: Math.floor(a.z) }; }) };
    }) };
  }

  /* Preview days only: start another game with fresh picks, avoiding the last game's locations where the pool allows. */
  function playAgain() {
    if (prog.no) return;
    var last = {}, best = null, bestOverlap = Infinity;
    prog.locs.forEach(function (l) { last[l.id] = 1; });
    for (var t = 0; t < 30 && bestOverlap > 0; t++) {
      var p = newProg(10000 + Math.floor(Math.random() * 1e6), (prog.attempt || 1) + 1);
      var overlap = p.locs.filter(function (l) { return last[l.id]; }).length;
      if (overlap < bestOverlap) { best = p; bestOverlap = overlap; }
    }
    prog = best; N = prog.locs.length; save();
    startRound();
  }

  function save() {
    if (!PT.store.set(GAME_KEY + prog.ymd, prog)) toast('Your browser blocked saving. Progress may not survive a reload.');
  }

  /* ---------------- top bar ---------------- */
  function renderTop() {
    var tot = 0;
    $('dots').innerHTML = prog.locs.map(function (l, i) {
      var r = prog.rounds[i];
      if (r) tot += r.s;
      var cur = !r && i === prog.rounds.length && phase !== 'results';
      return '<i class="' + (cur ? 'cur' : '') + '" style="' + (r ? 'background:' + SQ_COLOR[PT.tile(r.s)] + ';border-color:transparent' : '') +
        '" title="Round ' + (i + 1) + (r ? ': ' + r.s : '') + '"></i>';
    }).join('');
    $('total').innerHTML = prog.rounds.length ? '<b>' + tot + '</b> pts' : '';
  }

  /* ---------------- rounds ---------------- */
  function startRound() {
    var i = prog.rounds.length, l = prog.locs[i];
    phase = 'guess';
    document.body.classList.add('guessing');
    guess = null; layers.clearLayers(); guessMarker = null;
    $('pRound').textContent = 'Round ' + (i + 1) + ' of ' + N;
    $('pDiff').textContent = l.difficulty; $('pDiff').className = 'diff ' + l.difficulty;
    $('pName').textContent = l.name;
    $('pSub').textContent = cap(l.kind === 'npc' ? 'NPC' : l.kind) + (l.hint ? ' · ' + l.hint : '');
    show('prompt', true); show('bar', true); show('reviewBar', false); show('results', false);
    $('lockBtn').style.display = ''; $('reveal').style.display = 'none';
    setLock();
    map.fitBounds(PT.boxToBounds(play), { animate: i > 0 });
    renderTop();
  }
  function setLock() {
    var b = $('lockBtn');
    b.disabled = !guess;
    b.textContent = guess ? 'Lock in guess' : TAP + ' the map to guess';
  }
  function onMapClick(e) {
    if (phase !== 'guess') return;
    var b = blockAt(e.latlng);
    if (!inPlay(b)) { toast('Guess inside the gold box'); return; }
    guess = b;
    if (guessMarker) guessMarker.setLatLng(blockCenter(b.x, b.z));
    else guessMarker = L.marker(blockCenter(b.x, b.z), { interactive: false, keyboard: false,
      icon: L.divIcon({ className: '', iconSize: [22, 22], html: '<div class="guess-dot"></div>' }) }).addTo(layers);
    setLock();
  }

  function lockIn() {
    if (phase !== 'guess' || !guess) return;
    var i = prog.rounds.length, l = prog.locs[i];
    var n = PT.nearest(guess, l), d = n.d, s = PT.score(d, meta.scoring.perfect, meta.scoring.k);   // closest spot counts
    prog.rounds.push({ id: l.id, gx: guess.x, gz: guess.z, ax: n.x, az: n.z, d: Math.round(d * 10) / 10, s: s });
    save();                                   // locked the instant it is made
    if (prog.rounds.length >= N) recordStats();
    showReveal(i, true);
  }

  function answerIcon(l, faint) {
    var svg = '<svg width="28" height="38" viewBox="0 0 24 32"><path d="M12 31C12 31 2 19.5 2 11.5a10 10 0 1 1 20 0C22 19.5 12 31 12 31Z" fill="#C9A84C" stroke="#15100d" stroke-width="1.5"/>' +
      '<text x="12" y="15.5" text-anchor="middle" font-size="11" font-weight="700" font-family="system-ui,sans-serif" fill="#15100d">' + GLYPH[l.kind] + '</text></svg>';
    return L.divIcon({ className: 'ans' + (faint ? ' faint' : ''), iconSize: [28, 38], iconAnchor: [14, 37], tooltipAnchor: [0, -34], html: svg });
  }
  function drawPair(l, r, label) {
    var ax = r.ax != null ? r.ax : l.x, az = r.az != null ? r.az : l.z;   // the spot this guess was scored against
    var a = blockCenter(ax, az), g = blockCenter(r.gx, r.gz);
    PT.spots(l).forEach(function (sp) {   // the location's other spots, faded
      if (sp.x === ax && sp.z === az) return;
      L.marker(blockCenter(sp.x, sp.z), { icon: answerIcon(l, true), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(layers);
    });
    L.polyline([g, a], { color: '#C9A84C', weight: 2.5, dashArray: '7 7', interactive: false }).addTo(layers);
    L.marker(g, { interactive: false, keyboard: false,
      icon: label ? L.divIcon({ className: '', iconSize: [20, 20], html: '<div class="num">' + label + '</div>' })
                  : L.divIcon({ className: '', iconSize: [22, 22], html: '<div class="guess-dot"></div>' }) }).addTo(layers);
    L.marker(a, { icon: answerIcon(l), keyboard: false, zIndexOffset: 500 })
      .bindTooltip(esc(l.name), { className: 'lbl', direction: 'top', permanent: true, offset: [0, 0] }).addTo(layers);
    return [a, g];
  }
  function fitPoints(pts) {
    var top = $('prompt').classList.contains('show') ? $('prompt').getBoundingClientRect().bottom : $('top').getBoundingClientRect().bottom;
    var bottom = window.innerHeight - $('bar').getBoundingClientRect().top;
    if ($('reviewBar').classList.contains('show')) bottom = window.innerHeight - $('reviewBar').getBoundingClientRect().top;
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, top + 46], paddingBottomRight: [60, bottom + 24], maxZoom: PT.NATIVE_ZOOM });
  }

  function showReveal(i, animate) {
    var l = prog.locs[i], r = prog.rounds[i];
    phase = 'reveal';
    document.body.classList.remove('guessing');
    layers.clearLayers(); guessMarker = null;
    $('pRound').textContent = 'Round ' + (i + 1) + ' of ' + N;
    $('pDiff').textContent = l.difficulty; $('pDiff').className = 'diff ' + l.difficulty;
    $('pName').textContent = l.name;
    $('pSub').textContent = cap(l.kind === 'npc' ? 'NPC' : l.kind) + (l.hint ? ' · ' + l.hint : '');
    show('prompt', true); show('bar', true);
    $('lockBtn').style.display = 'none'; $('reveal').style.display = '';
    $('rScore').textContent = r.s;
    $('rScore').style.color = SQ_COLOR[PT.tile(r.s)];
    $('rVerdict').textContent = PT.verdict(r.s);
    var dd = Math.round(r.d);
    $('rDist').textContent = r.d === 0 ? 'Exact block!' : plural(dd, 'block') + ' away';
    $('nextBtn').textContent = i + 1 >= N ? 'See results' : 'Next';
    var pts = drawPair(l, r);
    fitPoints(pts);
    renderTop();
    if (animate) $('nextBtn').focus({ preventScroll: true });
  }

  function next() {
    if (phase !== 'reveal') return;
    prog.ack = prog.rounds.length; save();
    if (prog.rounds.length >= N) showResults(); else startRound();
  }

  /* ---------------- results ---------------- */
  function totals() {
    var t = 0; prog.rounds.forEach(function (r) { t += r.s; }); return t;
  }
  // Dynmap's web server doesn't serve folder index pages, so the link must name index.html
  function shareUrl() { return location.origin + location.pathname.replace(/\/$/, '/index.html'); }
  function shareText() {
    return 'Pintland Tap ' + prog.label + ' — ' + totals() + '/' + (N * 100) + '\n' +
      prog.rounds.map(function (r) { return PT.tile(r.s); }).join('') + '\n' + shareUrl();
  }

  function recordStats() {
    if (!prog.no) return;                     // preview games don't count
    var st = PT.store.get(STATS_KEY, { days: {} });
    st.days = st.days || {};
    st.days[prog.ymd] = { no: prog.no, total: totals() };
    PT.store.set(STATS_KEY, st);
  }
  function stats() {
    var st = PT.store.get(STATS_KEY, { days: {} }), days = {}, keys;
    Object.keys(st.days || {}).forEach(function (k) { if (st.days[k].no) days[k] = st.days[k]; });
    keys = Object.keys(days).sort();
    var played = keys.length, sum = 0, best = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      sum += days[k].total;
      run = prev && addDays(prev, 1) === k ? run + 1 : 1;
      best = Math.max(best, run); prev = k;
    });
    var t = PT.ymd(meta.tz), cur = 0, k = days[t] ? t : addDays(t, -1);
    while (days[k]) { cur++; k = addDays(k, -1); }
    return { played: played, streak: cur, best: best, avg: played ? Math.round(sum / played) : 0 };
  }

  function showResults() {
    phase = 'results';
    if (prog.rounds.length >= N) recordStats();
    document.body.classList.remove('guessing');
    show('prompt', false); show('bar', false); show('reviewBar', false); show('start', false);
    layers.clearLayers();
    map.fitBounds(PT.boxToBounds(play), { animate: false });
    $('resKicker').textContent = prog.no ? 'Puzzle ' + prog.label : 'Preview · game ' + (prog.attempt || 1);
    $('resTotal').textContent = totals();
    $('resSquares').textContent = prog.rounds.map(function (r) { return PT.tile(r.s); }).join('');
    $('resRounds').innerHTML = prog.rounds.map(function (r, i) {
      var l = prog.locs[i];
      return '<tr><td class="n">' + (i + 1) + '</td><td class="nm">' + esc(l.name) + '<small>' + l.difficulty + ' · ' + PT.verdict(r.s) + '</small></td>' +
        '<td class="d">' + (r.d === 0 ? 'exact' : plural(Math.round(r.d), 'block')) + '</td>' +
        '<td class="s" style="color:' + SQ_COLOR[PT.tile(r.s)] + '">' + r.s + '</td></tr>';
    }).join('');
    $('shareText').textContent = shareText();
    var s = stats();
    $('stats').innerHTML = [['Played', s.played], ['Streak', s.streak], ['Best streak', s.best], ['Average', s.avg]]
      .map(function (p) { return '<div><b>' + p[1] + '</b><span>' + p[0] + '</span></div>'; }).join('');
    $('againBtn').style.display = prog.no ? 'none' : '';
    $('previewNote').style.display = prog.no ? 'none' : '';
    $('previewNote').textContent = 'Preview games don\'t count toward your stats. Puzzle #1 starts ' +
      new Date(meta.epoch + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) + '.';
    renderTop();
    show('results', true);
    tick();
  }

  /* countdown to midnight in meta.tz, shown in 12-hour time */
  var tickTimer = null;
  function tick() {
    clearTimeout(tickTimer);
    if (phase !== 'results' && phase !== 'review') return;
    var now = new Date(), secs = PT.secondsToNext(meta.tz, now);
    if (PT.ymd(meta.tz, now) !== prog.ymd) {
      $('nextPuzzle').innerHTML = '<button class="big gold" onclick="location.reload()">Play the new puzzle</button>';
      return;
    }
    var h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), sec = secs % 60;
    var at = new Date(now.getTime() + secs * 1000);
    var fmt = function (tz) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at); };
    var localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    var same = fmt(localTz) === fmt(meta.tz);
    $('nextPuzzle').innerHTML = 'Next puzzle in <b>' + h + 'h ' + (m < 10 ? '0' : '') + m + 'm ' + (sec < 10 ? '0' : '') + sec + 's</b><br>' +
      '<small>at ' + fmt(meta.tz) + ' Eastern' + (same ? '' : ' (' + fmt(localTz) + ' your time)') + '</small>';
    tickTimer = setTimeout(tick, 1000 - now.getMilliseconds() + 5);
  }

  function review() {
    phase = 'review';
    show('results', false); show('reviewBar', true);
    layers.clearLayers();
    var pts = [];
    prog.rounds.forEach(function (r, i) { pts = pts.concat(drawPair(prog.locs[i], r, String(i + 1))); });
    fitPoints(pts);
  }

  function copyShare() {
    var text = shareText();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) toast('Copied. Paste it in Discord.');
      else {
        var r = document.createRange(); r.selectNodeContents($('shareText'));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        toast('Selected. Press Ctrl+C / ⌘C, or long-press to copy.');
      }
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste it in Discord.'); }, fallback);
    else fallback();
  }

  // read-only hooks for the e2e test
  window.ptGame = { get map() { return map; }, get prog() { return prog; }, get phase() { return phase; }, shareText: function () { return shareText(); } };
})();
