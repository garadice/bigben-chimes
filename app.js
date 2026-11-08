/* Big Ben Chimes — UI wiring: audio pool, gesture unlock, sequencer,
 * quarter scheduler, clock display, volume/mute. Pure logic lives in chime.js.
 *
 * Test hooks (mirrors the london-boom __TEST__ pattern):
 *   window.__BBC__.playEvents / cancelAll / players / scheduler /
 *   setClockOffset / stats / playSpy
 */
(function () {
  'use strict';

  var BONG_GAP = 2.0;        // card: realistic 1.5–2 s spacing (s)
  var MELODY_DUR = 17.67;    // audio/melody.m4a duration (s)
  var BONG_POOL_SIZE = 4;    // overlapping decays need more than one player

  var C = window.Chimes;

  // ---------- audio pool ----------
  /** Pick the best playable encoding: AAC first, Vorbis fallback. */
  function audioSrc(base) {
    var probe = document.createElement('audio');
    if (probe.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '') return base + '.m4a';
    if (probe.canPlayType('audio/ogg; codecs="vorbis"') !== '') return base + '.ogg';
    return base + '.m4a'; // last resort — every modern browser plays one of the two
  }

  function makePlayer(base) {
    var el = new Audio(audioSrc(base));
    el.preload = 'auto';
    return el;
  }

  var players = {
    melody: makePlayer('audio/melody'),
    bongs: []
  };
  for (var i = 0; i < BONG_POOL_SIZE; i++) {
    players.bongs.push(makePlayer('audio/bong'));
  }
  var bongCursor = 0;
  var playErrors = []; // capture play() rejections for tests/diagnostics

  var volume = 0.9;
  var muted = false;
  var unlocked = false;

  function applyVolume() {
    players.melody.volume = muted ? 0 : volume;
    players.bongs.forEach(function (p) { p.volume = muted ? 0 : volume; });
  }

  /**
   * Android Chrome gesture unlock: on the first real touch, briefly play
   * every player muted so later unmuted play() calls are allowed.
   */
  function unlock() {
    if (unlocked) return Promise.resolve();
    var all = [players.melody].concat(players.bongs);
    return Promise.all(all.map(function (p) {
      p.muted = true;
      var pr = p.play();
      return Promise.resolve(pr).then(function () {
        p.pause();
        p.currentTime = 0;
        p.muted = false;
      }, function () {
        p.muted = false; // play() rejected — nothing to unlock, stay silent-safe
      });
    })).then(function () {
      unlocked = true;
      applyVolume();
    });
  }

  // ---------- sequencer ----------
  var seqTimers = [];
  var seqGen = 0; // generation counter — bumping cancels all pending strikes

  function stopAllPlayers() {
    [players.melody].concat(players.bongs).forEach(function (p) {
      try {
        p.pause();
        p.currentTime = 0;
      } catch (e) { /* not ready yet — fine */ }
    });
  }

  function playOne(file) {
    var el;
    if (file === 'melody') {
      el = players.melody;
    } else {
      el = players.bongs[bongCursor % players.bongs.length];
      bongCursor++;
    }
    try {
      el.currentTime = 0;
    } catch (e) { /* seek before metadata is harmless */ }
    var pr = el.play();
    if (pr && pr.catch) {
      pr.catch(function (err) {
        playErrors.push(file + ': ' + (err && err.name || String(err)));
        if (err && err.name === 'NotAllowedError') {
          // no user activation yet (e.g. scripted clicks) — unlock muted, retry once
          return unlock().then(function () {
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

  /** Schedule an event timeline [{file, at}] (seconds). Returns generation id. */
  function playEvents(events) {
    cancelAll();
    var gen = ++seqGen;
    var t0 = Date.now();
    events.forEach(function (ev) {
      var delayMs = Math.max(0, ev.at * 1000 - (Date.now() - t0));
      seqTimers.push(setTimeout(function () {
        if (gen !== seqGen) return; // superseded by a newer tap
        playOne(ev.file);
      }, delayMs));
    });
    return gen;
  }

  function cancelAll() {
    seqGen++;
    seqTimers.forEach(clearTimeout);
    seqTimers = [];
    stopAllPlayers();
  }

  // ---------- quarter scheduler ----------
  var quarterOn = false;
  var scheduler = C.createQuarterScheduler(function () {
    return new Date(Date.now() + clockOffsetMs);
  }, function (d, q) {
    if (q === 0) {
      playEvents(C.fullChimeEvents(d.getHours(), { gap: BONG_GAP, melodyDur: MELODY_DUR }));
    } else {
      playEvents(C.melodyOnlyEvents());
    }
  });

  var clockOffsetMs = 0; // tests only: shift the app's idea of "now"

  // ---------- UI ----------
  var $clock = document.getElementById('clock');
  var $btnFull = document.getElementById('btn-full');
  var $btnBongs = document.getElementById('btn-bongs');
  var $btnQuarter = document.getElementById('btn-quarter');
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
    $btnQuarter.querySelector('.state').textContent = quarterOn ? 'ZAP' : 'VYP';
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
      unlock().then(function () {
        playEvents(eventsFactory());
      });
    };
  }

  $btnFull.addEventListener('click', userPlay(function () {
    var d = new Date(Date.now() + clockOffsetMs);
    return C.fullChimeEvents(d.getHours(), { gap: BONG_GAP, melodyDur: MELODY_DUR });
  }));

  $btnBongs.addEventListener('click', userPlay(function () {
    var d = new Date(Date.now() + clockOffsetMs);
    return C.bongsOnlyEvents(d.getHours(), { gap: BONG_GAP });
  }));

  $btnQuarter.addEventListener('click', function () {
    quarterOn = !quarterOn;
    scheduler.setEnabled(quarterOn); // clearing a stale mark keeps state honest
    renderQuarter();
    saveState();
    if (quarterOn) unlock(); // pre-unlock so the next mark can sound unattended
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
  applyVolume();
  $vol.value = String(volume);
  renderClock();
  renderQuarter();
  renderMute();
})();
