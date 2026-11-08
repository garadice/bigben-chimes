/* Big Ben Chimes — UI wiring: audio pool, gesture unlock, sequencer,
 * quarter scheduler, clock display, volume/mute, bong counter, sway,
 * vibration, STOP, hour picker. Pure logic lives in chime.js
 * (v1.2: melody-only :00 button, picker with chosen-N strikes).
 *
 * Test hooks (mirrors the london-boom __TEST__ pattern):
 *   window.__BBC__.playEvents / cancelAll / players / scheduler /
 *   setClockOffset / playQuarter / stats / pickerState
 */
(function () {
  'use strict';

  var C = window.Chimes;   // evidence-derived timing constants live there

  var BONG_POOL_SIZE = 4;    // overlapping decays need more than one player
  var MAX_EVENT_LATE_MS = 1000; // suspended tabs must not dump queued notes at once

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
    q15: makePlayer('q15'),
    q45: makePlayer('q45'),
    bongs: []
  };
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
    players.q15.volume = muted ? 0 : volume;
    players.q45.volume = muted ? 0 : volume;
    players.bongs.forEach(function (p) { p.volume = muted ? 0 : volume; });
  }

  /**
   * Android Chrome gesture unlock: on the first real touch, briefly play
   * every player muted so later unmuted play() calls are allowed.
   */
  function unlock() {
    if (unlocked) return Promise.resolve(true);
    if (unlockPromise) return unlockPromise;
    var all = [players.melody, players.q30, players.q15, players.q45]
      .concat(players.bongs);
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

  function stopAllPlayers(preserveUnlock) {
    var all = [players.melody, players.q30, players.q15, players.q45]
      .concat(players.bongs);
    all.forEach(function (p) {
      // pointerdown may still be loading the muted first-gesture sweep.
      // A manual click must cancel OLD sound, not abort its own play()
      // readiness promises. STOP still passes false and pauses everything.
      if (preserveUnlock && unlockPromise && p.muted) return;
      try {
        p.pause();
        p.currentTime = 0;
      } catch (e) { /* not ready yet — fine */ }
    });
  }

  function playerFor(file) {
    if (file === 'melody') return players.melody;
    if (file === 'q30') return players.q30;
    if (file === 'q15') return players.q15;
    if (file === 'q45') return players.q45;
    if (file === 'bong') {
      var el = players.bongs[bongCursor % players.bongs.length];
      bongCursor++;
      return el;
    }
    return null; // defensive: unknown file stays silent-safe
  }

  function playOne(file) {
    var gen = seqGen;
    var el = playerFor(file);
    if (!el) return Promise.resolve();
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

  /**
   * Schedule an event timeline [{file, at, n?}] (seconds). onEnd fires once
   * after the last event +1.2 s; onStart fires once right after scheduling
   * (post-cancelAll). Both are suppressed by a newer tap or STOP.
   * Returns gen id.
   */
  function playEvents(events, onEnd, onStart) {
    cancelAll();
    var gen = ++seqGen;
    var t0 = Date.now();
    events.forEach(function (ev) {
      var delayMs = Math.max(0, ev.at * 1000 - (Date.now() - t0));
      seqTimers.push(setTimeout(function () {
        if (gen !== seqGen) return; // superseded by a newer tap
        if (Date.now() - t0 - ev.at * 1000 > MAX_EVENT_LATE_MS) {
          cancelAll(); // resumed after a long freeze: discard the entire old tune
          return;
        }
        playOne(ev.file);
        if (ev.file === 'bong') onBongFeedback(ev.n);
      }, delayMs));
    });
    if (onEnd) {
      var lastAt = events.length ? events[events.length - 1].at : 0;
      seqTimers.push(setTimeout(function () {
        if (gen === seqGen) onEnd();
      }, lastAt * 1000 + 1200));
    }
    if (onStart && gen === seqGen) onStart();
    return gen;
  }

  function cancelAll(preserveUnlock) {
    seqGen++;
    seqTimers.forEach(clearTimeout);
    seqTimers = [];
    if (countHideTimer) { clearTimeout(countHideTimer); countHideTimer = null; }
    if (swayTimer) { clearTimeout(swayTimer); swayTimer = null; }
    $count.classList.remove('show');
    if ($tower) $tower.classList.remove('sway');
    hideArmed();
    stopAllPlayers(preserveUnlock);
  }

  // ---------- quarter scheduler ----------
  var quarterOn = false;
  var clockOffsetMs = 0; // tests only: shift the app's idea of "now"

  var scheduler = C.createQuarterScheduler(function () {
    return new Date(Date.now() + clockOffsetMs);
  }, function (d, q) {
    // A restored toggle cannot bypass browser gesture policy. A first auto
    // tap may still be priming: share that promise and the STOP generation.
    if (!unlocked && !unlockPromise) return;
    userPlay(function () { return C.quarterEvents(q, d.getHours()); })();
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

  // ---------- hour picker ----------
  var $btnPicker = document.getElementById('btn-picker');
  var $picker = document.getElementById('picker');
  var $pickerPlay = document.getElementById('picker-play');
  var $pickerClose = document.getElementById('picker-close');
  var $armed = document.getElementById('armed');
  var $pickerNums = {};
  for (var h = 1; h <= 12; h++) {
    $pickerNums[h] = document.getElementById('btn-p' + h);
  }
  var pickerOpen = false;
  var pickerHour = null; // chosen hour, cleared once playback starts

  function renderPicker() {
    for (var n = 1; n <= 12; n++) {
      $pickerNums[n].classList.toggle('sel', pickerHour === n);
    }
    $pickerPlay.classList.toggle('ready', pickerHour != null);
    $pickerPlay.setAttribute('aria-disabled', pickerHour == null ? 'true' : 'false');
    $pickerPlay.textContent = pickerHour != null ? '▶ ' + pickerHour : '▶';
  }

  function openPicker() {
    pickerOpen = true;
    $picker.classList.add('open');
    $btnPicker.classList.add('on');
    $picker.setAttribute('aria-hidden', 'false');
    renderPicker();
  }

  function closePicker() {
    pickerOpen = false;
    $picker.classList.remove('open');
    $btnPicker.classList.remove('on');
    $picker.setAttribute('aria-hidden', 'true');
  }

  function showArmed(n) {
    $armed.textContent = '🔔 ' + n;
    $armed.classList.add('show');
  }

  function hideArmed() {
    if ($armed) $armed.classList.remove('show');
  }

  $btnPicker.addEventListener('click', function () {
    if (pickerOpen) closePicker(); else openPicker();
  });
  $pickerClose.addEventListener('click', closePicker);

  (function () {
    for (var n = 1; n <= 12; n++) {
      (function (n) {
        $pickerNums[n].addEventListener('click', function () {
          pickerHour = n;
          renderPicker();
        });
      })(n);
    }
  })();

  $pickerPlay.addEventListener('click', function () {
    if (pickerHour == null) return;
    var n = pickerHour;
    pickerHour = null;      // the choice is consumed; next open starts fresh
    renderPicker();
    closePicker();
    userPlay(function () {
      return C.hourPickerEvents(n);
    }, hideArmed, function () { showArmed(n); })();
  });

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

  function userPlay(eventsFactory, onEnd, onStart) {
    return function () {
      cancelAll(true); // invalidate older taps without aborting gesture priming
      var gen = seqGen;
      unlock().then(function (ready) {
        if (ready && gen === seqGen) playEvents(eventsFactory(), onEnd, onStart);
      });
    };
  }

  function currentHour() {
    return new Date(Date.now() + clockOffsetMs).getHours();
  }

  [1, 2, 3, 0].forEach(function (q) {
    $btnQ[q].addEventListener('click', userPlay(function () {
      // the full-hour SQUARE plays only the melody (v1.2): zero strikes
      return q === 0 ? C.melodyOnlyEvents() : C.quarterEvents(q, currentHour());
    }));
  });

  $btnBongs.addEventListener('click', userPlay(function () {
    return C.bongsOnlyEvents(currentHour());
  }));

  $btnQuarter.addEventListener('click', function () {
    quarterOn = !quarterOn;
    if (quarterOn) unlock(); // start priming before an immediate in-grace fire
    scheduler.setEnabled(quarterOn); // clearing a stale mark keeps state honest
    renderQuarter();
    saveState();
  });

  // STOP: silence everything now, kill all pending timers (the auto toggle
  // stays as it is — stopping sound is not switching the mode off).
  $btnStop.addEventListener('click', function () {
    pickerHour = null;
    renderPicker();
    closePicker();
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

  // Tapping the clock opens the picker too (kid-sized target, same action).
  $clock.addEventListener('click', function () { openPicker(); });

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
      return q === 0 ? C.melodyOnlyEvents() : C.quarterEvents(q, currentHour());
    })(); },
    isUnlocked: function () { return unlocked; },
    playErrors: function () { return playErrors.slice(); },
    setClockOffset: function (ms) { clockOffsetMs = ms; renderClock(); },
    setQuarterOn: function (v) {
      quarterOn = !!v;
      scheduler.setEnabledQuiet(quarterOn);
      renderQuarter();
    },
    isQuarterOn: function () { return quarterOn; },
    pickerState: function () { return { open: pickerOpen, hour: pickerHour }; },
    openPicker: openPicker,
    closePicker: closePicker,
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
  renderPicker();
})();
