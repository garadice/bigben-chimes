/* Big Ben Chimes — UI wiring: audio pool, gesture unlock, sequencer,
 * quarter scheduler, clock display, volume/mute, bong counter, sway,
 * vibration, STOP. Pure logic lives in chime.js (v1.1: per-quarter events).
 *
 * Test hooks (mirrors the london-boom __TEST__ pattern):
 *   window.__BBC__.playEvents / cancelAll / players / scheduler /
 *   setClockOffset / playQuarter / stats / playSpy
 */
(function () {
  'use strict';

  var C = window.Chimes;   // evidence-derived timing constants live there

  var NOTE_FILES = ['n-gs4', 'n-fs4', 'n-e4', 'n-b3'];
  var BONG_POOL_SIZE = 4;    // overlapping decays need more than one player

  // ---------- audio pool ----------
  /** Pick the best playable encoding: AAC first, Vorbis fallback. */
  function audioSrc(base) {
    var probe = document.createElement('audio');
    if (probe.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '') return base + '.m4a';
    if (probe.canPlayType('audio/ogg; codecs="vorbis"') !== '') return base + '.ogg';
    return base + '.m4a'; // last resort — every modern browser plays one of the two
  }

  function makePlayer(base) {
    var el = new Audio(audioSrc('audio/' + base));
    el.preload = 'auto';
    return el;
  }

  var players = {
    melody: makePlayer('melody'),
    q30: makePlayer('q30'),
    q45a: makePlayer('q45a'),
    notes: {},
    bongs: []
  };
  NOTE_FILES.forEach(function (f) { players.notes[f] = makePlayer(f); });
  for (var i = 0; i < BONG_POOL_SIZE; i++) {
    players.bongs.push(makePlayer('bong'));
  }
  var bongCursor = 0;
  var playErrors = []; // capture play() rejections for tests/diagnostics

  var volume = 0.9;
  var muted = false;
  var unlocked = false;
  var unlockPromise = null; // every caller must await the SAME muted sweep

  function applyVolume() {
    players.melody.volume = muted ? 0 : volume;
    players.q30.volume = muted ? 0 : volume;
    players.q45a.volume = muted ? 0 : volume;
    NOTE_FILES.forEach(function (f) { players.notes[f].volume = muted ? 0 : volume; });
    players.bongs.forEach(function (p) { p.volume = muted ? 0 : volume; });
  }

  /**
   * Android Chrome gesture unlock: on the first real touch, briefly play
   * every player muted so later unmuted play() calls are allowed.
   */
  function unlock() {
    if (unlocked) return Promise.resolve(true);
    if (unlockPromise) return unlockPromise;
    var all = [players.melody, players.q30, players.q45a].concat(
      NOTE_FILES.map(function (f) { return players.notes[f]; }),
      players.bongs);
    unlockPromise = Promise.all(all.map(function (p) {
      p.muted = true;
      var pr = p.play();
      return Promise.resolve(pr).then(function () {
        p.pause();
        p.currentTime = 0;
        p.muted = false;
        return true;
      }, function () {
        p.muted = false; // play() rejected — nothing to unlock, stay silent-safe
        return false;
      });
    })).then(function (results) {
      unlocked = results.every(function (ready) { return ready; });
      unlockPromise = null;
      applyVolume();
      return unlocked;
    }, function () {
      unlockPromise = null; // allow a retry on the next gesture
    });
    return unlockPromise;
  }

  // ---------- sequencer ----------
  var seqTimers = [];
  var seqGen = 0; // generation counter — bumping cancels all pending strikes
  var countHideTimer = null;
  var swayTimer = null;

  // ---------- kid feedback: bong count, tower sway, vibration ----------
  var $count = document.getElementById('count');
  var $tower = document.querySelector('.tower');

  function onBongFeedback(n) {
    if (n != null) {
      $count.textContent = String(n);
      $count.classList.add('show');
      if (countHideTimer) clearTimeout(countHideTimer);
      countHideTimer = setTimeout(function () { $count.classList.remove('show'); }, 1400);
      seqTimers.push(countHideTimer); // STOP clears it too
    }
    if ($tower && !$tower.classList.contains('sway')) {
      $tower.classList.add('sway');
      swayTimer = setTimeout(function () { $tower.classList.remove('sway'); }, 900);
      seqTimers.push(swayTimer);
    }
    try {
      if (navigator.vibrate) navigator.vibrate(140);
    } catch (e) { /* no vibration support — fine */ }
  }

  function stopAllPlayers() {
    var all = [players.melody, players.q30, players.q45a].concat(
      NOTE_FILES.map(function (f) { return players.notes[f]; }), players.bongs);
    all.forEach(function (p) {
      try {
        p.pause();
        p.currentTime = 0;
      } catch (e) { /* not ready yet — fine */ }
    });
  }

  function playerFor(file) {
    if (file === 'melody') return players.melody;
    if (file === 'q30') return players.q30;
    if (file === 'q45a') return players.q45a;
    if (file === 'bong') {
      var el = players.bongs[bongCursor % players.bongs.length];
      bongCursor++;
      return el;
    }
    return players.notes[file]; // n-gs4 / n-fs4 / n-e4 / n-b3
  }

  function playOne(file) {
    var gen = seqGen;
    var el = playerFor(file);
    try {
      el.currentTime = 0;
    } catch (e) { /* seek before metadata is harmless */ }
    var pr = el.play();
    if (pr && pr.catch) {
      pr.catch(function (err) {
        playErrors.push(file + ': ' + (err && err.name || String(err)));
        if (err && err.name === 'NotAllowedError' && gen === seqGen) {
          // A gesture may unlock audio; STOP/newer taps must cancel this retry too.
          return unlock().then(function (ready) {
            if (!ready || gen !== seqGen) return;
            try { el.currentTime = 0; } catch (e2) { /* harmless */ }
            return el.play();
          }).catch(function (err2) {
            playErrors.push(file + ' retry: ' + (err2 && err2.name || String(err2)));
          });
        }
      });
    }
    return pr || Promise.resolve();
  }

  /** Schedule an event timeline [{file, at, n?}] (seconds). Returns gen id. */
  function playEvents(events) {
    cancelAll();
    var gen = ++seqGen;
    var t0 = Date.now();
    events.forEach(function (ev) {
      var delayMs = Math.max(0, ev.at * 1000 - (Date.now() - t0));
      seqTimers.push(setTimeout(function () {
        if (gen !== seqGen) return; // superseded by a newer tap
        playOne(ev.file);
        if (ev.file === 'bong') onBongFeedback(ev.n);
      }, delayMs));
    });
    return gen;
  }

  function cancelAll() {
    seqGen++;
    seqTimers.forEach(clearTimeout);
    seqTimers = [];
    if (countHideTimer) { clearTimeout(countHideTimer); countHideTimer = null; }
    if (swayTimer) { clearTimeout(swayTimer); swayTimer = null; }
    $count.classList.remove('show');
    if ($tower) $tower.classList.remove('sway');
    stopAllPlayers();
  }

  // ---------- quarter scheduler ----------
  var quarterOn = false;
  var clockOffsetMs = 0; // tests only: shift the app's idea of "now"

  var scheduler = C.createQuarterScheduler(function () {
    return new Date(Date.now() + clockOffsetMs);
  }, function (d, q) {
    playEvents(C.quarterEvents(q, d.getHours()));
  });

  // ---------- UI ----------
  var $clock = document.getElementById('clock');
  var $btnQ = {
    1: document.getElementById('btn-q1'),
    2: document.getElementById('btn-q2'),
    3: document.getElementById('btn-q3'),
    0: document.getElementById('btn-q4')
  };
  var $btnBongs = document.getElementById('btn-bongs');
  var $btnQuarter = document.getElementById('btn-quarter');
  var $btnStop = document.getElementById('btn-stop');
  var $btnMute = document.getElementById('btn-mute');
  var $vol = document.getElementById('volume');

  function pad(n) { return String(n).padStart(2, '0'); }

  function renderClock() {
    var d = new Date(Date.now() + clockOffsetMs);
    $clock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderQuarter() {
    $btnQuarter.classList.toggle('on', quarterOn);
    $btnQuarter.setAttribute('aria-pressed', String(quarterOn));
  }

  function renderMute() {
    $btnMute.textContent = muted ? '🔇' : '🔊';
    $btnMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    $vol.disabled = muted;
    $vol.style.opacity = muted ? '0.35' : '1';
  }

  function saveState() {
    try {
      localStorage.setItem('bbc-volume', String(volume));
      localStorage.setItem('bbc-muted', muted ? '1' : '0');
      localStorage.setItem('bbc-quarter', quarterOn ? '1' : '0');
    } catch (e) { /* private mode — non-fatal */ }
  }

  function loadState() {
    try {
      var v = parseFloat(localStorage.getItem('bbc-volume'));
      if (!isNaN(v)) volume = Math.min(1, Math.max(0, v));
      muted = localStorage.getItem('bbc-muted') === '1';
      quarterOn = localStorage.getItem('bbc-quarter') === '1';
    } catch (e) { /* defaults */ }
  }

  function userPlay(eventsFactory) {
    return function () {
      cancelAll(); // invalidate older taps even while their unlock is pending
      var gen = seqGen;
      unlock().then(function (ready) {
        if (ready && gen === seqGen) playEvents(eventsFactory());
      });
    };
  }

  function currentHour() {
    return new Date(Date.now() + clockOffsetMs).getHours();
  }

  [1, 2, 3, 0].forEach(function (q) {
    $btnQ[q].addEventListener('click', userPlay(function () {
      return C.quarterEvents(q, currentHour());
    }));
  });

  $btnBongs.addEventListener('click', userPlay(function () {
    return C.bongsOnlyEvents(currentHour());
  }));

  $btnQuarter.addEventListener('click', function () {
    quarterOn = !quarterOn;
    scheduler.setEnabled(quarterOn); // clearing a stale mark keeps state honest
    renderQuarter();
    saveState();
    if (quarterOn) unlock(); // pre-unlock so the next mark can sound unattended
  });

  // STOP: silence everything now, kill all pending timers (the auto toggle
  // stays as it is — stopping sound is not switching the mode off).
  $btnStop.addEventListener('click', function () {
    cancelAll();
    $btnStop.classList.remove('pressed');
    void $btnStop.offsetWidth; // restart the pulse animation
    $btnStop.classList.add('pressed');
  });

  $btnMute.addEventListener('click', function () {
    muted = !muted;
    applyVolume();
    renderMute();
    saveState();
  });

  $vol.addEventListener('input', function () {
    volume = parseFloat($vol.value);
    muted = false;
    applyVolume();
    renderMute();
    saveState();
  });

  // First touch anywhere unlocks audio (Android Chrome gesture rule).
  ['pointerdown', 'touchend'].forEach(function (evtName) {
    document.addEventListener(evtName, function () { unlock(); }, { passive: true });
  });

  // 1 s tick: clock display + quarter scheduler (fires at :00/:15/:30/:45).
  setInterval(function () {
    renderClock();
    scheduler.tick();
  }, 1000);

  // ---------- service worker ----------
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' ||
       location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('SW registration failed:', err);
    });
  }

  // ---------- test hooks ----------
  window.__BBC__ = {
    playEvents: playEvents,
    cancelAll: cancelAll,
    players: players,
    scheduler: scheduler,
    playOne: playOne,
    unlock: unlock,
    playQuarter: function (q) { return userPlay(function () {
      return C.quarterEvents(q, currentHour());
    }); },
    isUnlocked: function () { return unlocked; },
    playErrors: function () { return playErrors.slice(); },
    setClockOffset: function (ms) { clockOffsetMs = ms; renderClock(); },
    setQuarterOn: function (v) {
      quarterOn = !!v;
      scheduler.setEnabledQuiet(quarterOn);
      renderQuarter();
    },
    isQuarterOn: function () { return quarterOn; },
    stats: function () {
      return {
        timers: seqTimers.length,
        gen: seqGen,
        bongCursor: bongCursor,
        volume: volume,
        muted: muted
      };
    }
  };

  // ---------- boot ----------
  loadState();
  scheduler.setEnabledQuiet(quarterOn); // arm restored toggle; current mark consumed (no mid-mark blast)
  applyVolume();
  $vol.value = String(volume);
  renderClock();
  renderQuarter();
  renderMute();
})();
