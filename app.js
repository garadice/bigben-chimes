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
    if (window.Bells) bellAudio.applyGain(); // the play screen obeys mute/volume too
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
   * after the final strike decay (1.2 s fallback for other event types);
   * onStart fires once right after scheduling
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
      var last = events.length ? events[events.length - 1] : null;
      var lastAt = last ? last.at : 0;
      var tailMs = last && last.file === 'bong' ? C.BONG_DUR * 1000 : 1200;
      seqTimers.push(setTimeout(function () {
        if (gen === seqGen) onEnd();
      }, lastAt * 1000 + tailMs));
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
  var $clockButton = document.getElementById('btn-clock');
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
  var $pickerStop = document.getElementById('picker-stop');
  var pickerReturnFocus = null;
  var pickerBackground = [document.querySelector('.dial'), document.querySelector('.pad'),
    document.querySelector('.volwrap')];
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
    if (pickerOpen) return;
    pickerReturnFocus = document.activeElement;
    pickerOpen = true;
    $picker.classList.add('open');
    $btnPicker.classList.add('on');
    $picker.setAttribute('aria-hidden', 'false');
    pickerBackground.forEach(function (el) { el.inert = true; });
    $btnPicker.setAttribute('aria-expanded', 'true');
    $clockButton.setAttribute('aria-expanded', 'true');
    renderPicker();
    $pickerClose.focus();
  }

  function closePicker() {
    if (!pickerOpen) return; // a closed picker owns no background state:
    // stopPlayback() calls this while the BELLS overlay is open — clearing
    // its inert here would un-modal the clock screen behind it (v1.4.0 round 3).
    pickerOpen = false;
    $picker.classList.remove('open');
    $btnPicker.classList.remove('on');
    $picker.setAttribute('aria-hidden', 'true');
    pickerBackground.forEach(function (el) { el.inert = false; });
    $btnPicker.setAttribute('aria-expanded', 'false');
    $clockButton.setAttribute('aria-expanded', 'false');
    (pickerReturnFocus || $btnPicker).focus();
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
  $picker.addEventListener('keydown', function (event) {
    if (!pickerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker();
    } else if (event.key === 'Tab') {
      var buttons = $picker.querySelectorAll('button');
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });

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

  // ---------- ZVONKY play screen (v1.4.0) ----------
  // Pure pitch/layout/voice logic lives in bells.js (window.Bells, chime.js
  // pattern). This section is only wiring + the Web Audio engine.
  var B = window.Bells;
  var $btnBells = document.getElementById('btn-bells');
  var $bells = document.getElementById('bells');
  var $bellsClose = document.getElementById('bells-close');
  var $bellsStop = document.getElementById('bells-stop');
  var $bellsStage = document.getElementById('bell-stage');
  var $bkeys = document.getElementById('bkeys');
  var $bellsModeBig = document.getElementById('bells-mode-big');
  var $bellsModeKeys = document.getElementById('bells-mode-keys');
  var bellsOpen = false;
  var bellsMode = 'big'; // persists for the SESSION (a variable, not storage)
  var bellsReturnFocus = null;
  var bellsPreloaded = false;
  var bellsBackground = [document.querySelector('.dial'), document.querySelector('.pad'),
    document.querySelector('.volwrap')];

  /**
   * Web Audio engine (NOT HTMLAudio clones): decoded buffers -> bus ->
   * DynamicsCompressor (mashing all 11 keys must never clip) -> master gain
   * (the global mute + volume) -> destination. The context is created
   * lazily inside a gesture; every path is silent-safe where Web Audio or
   * fetch is unavailable (vm harness, old browsers, offline pre-precache).
   */
  var bellAudio = (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, busIn = null, master = null;
    var buffers = {}; // file -> AudioBuffer
    var loading = {}; // file -> in-flight decode promise (deduped)
    var voices = {};  // voice id -> source node
    var ledger = B.createVoiceLedger(16); // mash-bounded polyphony

    function ensureCtx() {
      if (!AC) return null;
      if (!ctx) {
        try {
          ctx = new AC();
          busIn = ctx.createDynamicsCompressor();
          master = ctx.createGain();
          busIn.connect(master);
          master.connect(ctx.destination);
          master.gain.value = muted ? 0 : volume;
        } catch (e) {
          ctx = null;
        }
      }
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }

    function load(file) {
      if (buffers[file]) return Promise.resolve(buffers[file]);
      var c = ensureCtx(); // decoding needs a live context; a gesture owns this call path
      if (!c || typeof fetch !== 'function') return Promise.resolve(null);
      if (loading[file]) return loading[file];
      loading[file] = fetch('audio/' + audioSrc(file)).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      }).then(function (ab) {
        return c.decodeAudioData(ab);
      }).then(function (buf) {
        buffers[file] = buf;
        return buf;
      }, function () {
        return null; // offline before the first precache: this key stays silent-safe
      }).then(function (buf) {
        delete loading[file];
        return buf;
      });
      return loading[file];
    }

    function stopVoice(id) {
      var src = voices[id];
      if (!src) return;
      delete voices[id];
      try { src.stop(); } catch (e) { /* already ended */ }
    }

    /** Strike one bell. Returns the voice id (0 = nothing sounded yet). */
    function play(file) {
      var c = ensureCtx();
      if (!c) return 0;
      var buf = buffers[file];
      if (!buf) {
        load(file); // first press may precede the decode; the next lands
        return 0;
      }
      var v = ledger.acquire(file);
      v.evicted.forEach(stopVoice);
      var src = c.createBufferSource();
      src.buffer = buf;
      src.connect(busIn);
      src.onended = function () {
        ledger.release(v.id);
        delete voices[v.id];
      };
      voices[v.id] = src;
      try {
        src.start();
      } catch (e) {
        ledger.release(v.id);
        delete voices[v.id];
        return 0;
      }
      return v.id;
    }

    /** Mode A first, the remaining keys decode in the background. */
    function preload() {
      B.QUARTER_BELLS.forEach(function (b) { load(b.file); });
      load(B.GREAT_BELL.file);
      B.KEYBOARD_NOTES.forEach(function (n) { load(n.file); });
    }

    return {
      play: play,
      load: load,
      preload: preload,
      applyGain: function () { if (master) master.gain.value = muted ? 0 : volume; },
      stopAll: function () { ledger.stopAll().forEach(stopVoice); },
      activeCount: function () { return ledger.count(); },
      loadedCount: function () { return Object.keys(buffers).length; }
    };
  })();

  /** Strike + kid feedback: instant sound, buzz, swing-and-glow animation. */
  function bellHit(file, button) {
    bellAudio.play(file);
    try {
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (e) { /* no vibration support — fine */ }
    if (button) {
      button.classList.remove('hit');
      void button.offsetWidth; // restart the swing even on machine-gun taps
      button.classList.add('hit');
    }
  }

  function setBellsMode(mode) {
    bellsMode = mode === 'keys' ? 'keys' : 'big';
    var keys = bellsMode === 'keys';
    $bkeys.hidden = !keys;
    $bellsStage.hidden = keys;
    $bellsModeBig.setAttribute('aria-pressed', String(bellsMode === 'big'));
    $bellsModeKeys.setAttribute('aria-pressed', String(keys));
  }

  function preloadBells() {
    if (bellsPreloaded) return;
    bellsPreloaded = true;
    bellAudio.preload();
  }

  function openBells() {
    if (bellsOpen) return;
    bellsReturnFocus = document.activeElement;
    bellsOpen = true;
    $bells.classList.add('open');
    $btnBells.classList.add('on');
    $bells.setAttribute('aria-hidden', 'false');
    bellsBackground.forEach(function (el) { el.inert = true; });
    $btnBells.setAttribute('aria-expanded', 'true');
    setBellsMode(bellsMode); // the chosen mode persists for the session
    preloadBells();          // mode A sounds ready immediately, keys follow
    $bellsClose.focus();
  }

  function closeBells() {
    var wasOpen = bellsOpen;
    bellsOpen = false;
    $bells.classList.remove('open');
    $btnBells.classList.remove('on');
    $bells.setAttribute('aria-hidden', 'true');
    bellsBackground.forEach(function (el) { el.inert = false; });
    $btnBells.setAttribute('aria-expanded', 'false');
    if (wasOpen) (bellsReturnFocus || $btnBells).focus();
  }

  $btnBells.addEventListener('click', function () {
    if (bellsOpen) closeBells(); else openBells();
  });
  $bellsClose.addEventListener('click', closeBells);
  $bellsStop.addEventListener('click', stopPlayback); // silences chimes AND bells
  $bellsModeBig.addEventListener('click', function () { setBellsMode('big'); });
  $bellsModeKeys.addEventListener('click', function () { setBellsMode('keys'); });
  $bells.addEventListener('keydown', function (event) {
    if (!bellsOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBells();
    } else if (event.key === 'Tab') {
      var buttons = $bells.querySelectorAll('button');
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });

  (function () {
    // pointerdown, not click: a kid's machine-gun mashing needs zero latency,
    // and separate touch points (two thumbs) each fire their own press.
    function wire(file, id) {
      var button = document.getElementById(id);
      if (!button) return;
      button.addEventListener('pointerdown', function () { bellHit(file, button); });
      button.addEventListener('animationend', function () { button.classList.remove('hit'); });
    }
    wire(B.GREAT_BELL.file, 'bell-great');
    B.QUARTER_BELLS.forEach(function (b) { wire(b.file, 'bell-' + b.id); });
    B.KEYBOARD_NOTES.forEach(function (n) { wire(n.file, 'key-' + n.id); });
  })();

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
  function stopPlayback() {
    pickerHour = null;
    renderPicker();
    closePicker();
    if (window.Bells) bellAudio.stopAll(); // STOP silences the bells instantly too
    cancelAll();
    $btnStop.classList.remove('pressed');
    void $btnStop.offsetWidth; // restart the pulse animation
    $btnStop.classList.add('pressed');
  }
  $btnStop.addEventListener('click', stopPlayback);
  $pickerStop.addEventListener('click', stopPlayback);

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
  $clockButton.addEventListener('click', function () { openPicker(); });

  // First touch anywhere unlocks audio (Android Chrome gesture rule).
  ['pointerdown', 'touchend'].forEach(function (evtName) {
    document.addEventListener(evtName, function () { unlock(); }, { passive: true });
  });

  // 1 s tick: clock display, quarter scheduler (fires at :00/:15/:30/:45)
  // and the update banner's show/idle-reload heartbeat.
  setInterval(function () {
    renderClock();
    scheduler.tick();
    updateTick();
  }, 1000);

  // ---------- version badge + update detection (v1.3.1) ----------
  // VERSION is the single source of truth for the release identity; sw.js
  // CACHE ('bigben-chimes-vX.Y.Z') is bumped by hand in the SAME change and
  // app_test.js asserts the pairing. A visible version answers "which build
  // am I hearing?" — the v1.3.0 stale-cache incident had no way to tell.
  var VERSION = '1.4.0';
  var $version = document.getElementById('version');
  var $update = document.getElementById('update-banner');
  var updateReady = false; // a newer release is installed, waiting to load
  var idleSince = 0;       // last moment playback was active
  var IDLE_RELOAD_MS = 60000;

  function anythingPlaying() {
    if (window.Bells && bellAudio.activeCount() > 0) return true;
    var all = [players.melody, players.q30, players.q15, players.q45]
      .concat(players.bongs);
    for (var i = 0; i < all.length; i++) {
      if (!all[i].paused && !all[i].ended) return true;
    }
    return false;
  }

  /** A newer service worker is installed: route into the banner flow. */
  function markUpdateReady() {
    if (updateReady) return;
    updateReady = true;
    idleSince = Date.now();
    updateTick();
  }

  /**
   * 1 s heartbeat for the update flow. A chime or bong is NEVER interrupted:
   * while anything plays the banner stays hidden and the idle clock resets,
   * so a long tune cannot end in a surprise reload. Once idle, the banner
   * appears (tap = reload); only after ~60 s of continued quiet does the
   * page reload itself — otherwise it simply waits for the tap.
   */
  function updateTick() {
    if (!updateReady) return;
    if (anythingPlaying()) { idleSince = Date.now(); return; }
    if ($update.hidden) {
      $update.hidden = false; // reveal only on a quiet screen
      idleSince = Date.now();
      return;
    }
    if (Date.now() - idleSince >= IDLE_RELOAD_MS) location.reload();
  }

  if ($version) $version.textContent = 'v' + VERSION;
  if ($update) $update.addEventListener('click', function () { location.reload(); });

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' ||
       location.hostname === '127.0.0.1')) {
    // An upgrade announces itself two ways; both route into the same
    // idempotent banner. The controller guard is the reload-loop brake:
    // the FIRST install's claim (no controller existed before) is a page
    // gaining a worker, not an update, and must not look like one.
    var registered = navigator.serviceWorker.register('sw.js');
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', markUpdateReady);
    }
    registered.then(function (reg) {
      // Blocked/unavailable workers resolve with undefined (observed in
      // Chromium's blocked mode) — a page without a registration simply
      // never announces updates, which is the safe default.
      if (!reg || !reg.addEventListener) return;
      reg.addEventListener('updatefound', function () {
        var installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', function () {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            markUpdateReady();
          }
        });
      });
    }).catch(function (err) {
      console.warn('SW registration failed:', err);
    });
  }

  // ---------- test hooks ----------
  window.__BBC__ = {
    VERSION: VERSION,
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
    bells: {
      state: function () {
        return { open: bellsOpen, mode: bellsMode,
                 active: bellAudio.activeCount(), loaded: bellAudio.loadedCount() };
      },
      open: openBells,
      close: closeBells,
      setMode: setBellsMode,
      press: function (file) { return bellAudio.play(file); }, // test hook: raw engine
      stopAll: function () { bellAudio.stopAll(); }
    },
    update: {
      state: function () {
        return {
          ready: updateReady,
          visible: !$update.hidden,
          idleMs: updateReady ? Date.now() - idleSince : 0
        };
      },
      markReady: markUpdateReady, // tests only: simulate an installed upgrade
      tick: updateTick
    },
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
