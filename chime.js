/* Big Ben Chimes — pure chime logic (no DOM, node-testable).
 *
 * Sound model v1.1 (see docs/DEV.md for the evidence behind every number):
 *   audio/melody.m4a — complete recorded 16-note hour chime, 20.80 s.
 *   audio/q30.m4a    — recorded changes 2+3 (8 notes), 7.23 s.
 *   audio/q45a.m4a   — recorded changes 4+5 (8 notes), 6.55 s.
 *   audio/n-*.m4a    — four single-bell slices (G#4, F#4, E4, B3) cut from the
 *                      same recording; used to assemble the per-quarter phrases.
 *   audio/bong.m4a   — one hour strike + natural decay, 3.43 s.
 *
 * Westminster Quarters pattern (Wikipedia, "Westminster Quarters"):
 *   five changes of the four quarter bells (G#4, F#4, E4, B3):
 *     1: G#4 F#4 E4 B3   2: E4 G#4 F#4 B3   3: E4 F#4 G#4 E4
 *     4: G#4 E4 F#4 B3   5: B3 F#4 G#4 E4
 *   :15 = change 1 · :30 = changes 2+3 · :45 = changes 4+5+1 ·
 *   :00 = changes 2+3+4+5, then N strikes of the Great Bell.
 *   Quarters ending on the tonic E4: :30 and :00. Ending on the dominant
 *   B3: :15 and :45. (Asserted in tools/chime_test.js.)
 *
 * Bong count = (hour % 12) || 12 → midnight/noon strike 12 times.
 */
(function (global) {
  'use strict';

  /* ---- evidence-derived constants (docs/DEV.md) ---- */
  var BONG_GAP = 4.015;     // mean of 11 independently measured strike intervals
  var STRIKE_PAUSE = 0.6;   // melody asset end -> first strike (kid-friendly)
  var MELODY_DUR = 20.80;   // audio/melody.m4a
  var Q45A_DUR = 6.55;      // audio/q45a.m4a
  var NOTE_STEP = 0.7;      // typical adjacent hammer attacks (not overtone peaks)
  var MINIM_STEP = 1.4;     // twice the crotchet slot

  /** Real Westminster convention: 0:00 and 12:00 both strike 12 times. */
  function bongsForHour(hour) {
    var h = ((hour % 24) + 24) % 24;
    return (h % 12) || 12;
  }

  /** 0 for :00, 1 for :15, 2 for :30, 3 for :45. */
  function quarterIndex(minute) {
    return Math.floor((((minute % 60) + 60) % 60) / 15);
  }

  /** Stable key for the quarter mark a date falls in, e.g. "2026-11-08T14:15". */
  function quarterKey(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    var markMinute = quarterIndex(d.getMinutes()) * 15;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(markMinute);
  }

  /* The four recorded single-bell slices (files in audio/). */
  var GS4 = 'n-gs4', FS4 = 'n-fs4', E4 = 'n-e4', B3 = 'n-b3';

  /* Change 1 (G#4 F#4 E4 B3) — the phrase the 1945 recording does not
   * contain; assembled from the four bell slices at the recorded rhythm. */
  function change1Events(t0) {
    return [
      { file: GS4, at: t0 },
      { file: FS4, at: t0 + NOTE_STEP },
      { file: E4, at: t0 + 2 * NOTE_STEP },
      { file: B3, at: t0 + 3 * NOTE_STEP }
    ];
  }


  /**
   * Timeline for quarter mark q (0=:00 … 3=:45) at wall-clock `hour`.
   * Returns [{file, at, n?}] sorted by time; hour-strike events carry n
   * (1-based bong count, drives the big counting display).
   * opts.bongGap / opts.strikePause / opts.melodyDur / opts.q45aDur are
   * overridable for tests; defaults are the measured constants above.
   */
  function quarterEvents(q, hour, opts) {
    opts = opts || {};
    var bongGap = opts.bongGap != null ? opts.bongGap : BONG_GAP;
    var strikePause = opts.strikePause != null ? opts.strikePause : STRIKE_PAUSE;
    var melodyDur = opts.melodyDur != null ? opts.melodyDur : MELODY_DUR;
    var q45aDur = opts.q45aDur != null ? opts.q45aDur : Q45A_DUR;

    var events;
    if (q === 1) {
      events = change1Events(0);
    } else if (q === 2) {
      events = [{ file: 'q30', at: 0 }];
    } else if (q === 3) {
      // recorded changes 4+5 (q45a), then assembled change 1 — ends on the
      // dominant B3 the way the real :45 chime does.
      events = [{ file: 'q45a', at: 0 }].concat(change1Events(q45aDur));
    } else {
      // The original source already contains ALL 16 notes. Keep its attacks
      // and natural decays intact rather than adding/repeating other phrases.
      events = [{ file: 'melody', at: 0 }];
      var n = bongsForHour(hour);
      var firstBong = melodyDur + strikePause;
      for (var i = 0; i < n; i++) {
        events.push({ file: 'bong', at: firstBong + i * bongGap, n: i + 1 });
      }
    }
    return events;
  }

  /** Timeline for bongs only (the BONGY button). */
  function bongsOnlyEvents(hour, opts) {
    opts = opts || {};
    var gap = opts.gap != null ? opts.gap : BONG_GAP;
    var events = [];
    var n = bongsForHour(hour);
    for (var i = 0; i < n; i++) {
      events.push({ file: 'bong', at: i * gap, n: i + 1 });
    }
    return events;
  }

  /**
   * Quarter scheduler. Call tick() ~every second. When enabled and the clock
   * enters a NEW quarter mark, fires play(date, quarterIndex).
   *
   * now() is injectable for tests. A mark later than graceMs (default 90 s,
   * covers Android freezing/throttling of background tabs) past its start is
   * skipped, so a tab unfrozen long after :15 never blasts a stale chime —
   * it simply waits for the next mark.
   */
  function createQuarterScheduler(now, play, opts) {
    opts = opts || {};
    var graceMs = opts.graceMs != null ? opts.graceMs : 90 * 1000;
    var enabled = false;
    var lastPlayed = null;

    function markStartTime(d) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), quarterIndex(d.getMinutes()) * 15, 0, 0).getTime();
    }

    function tick() {
      if (!enabled) return false;
      var d = now();
      var key = quarterKey(d);
      if (key === lastPlayed) return false;
      var lateMs = d.getTime() - markStartTime(d);
      lastPlayed = key; // consumed either way, so a stale mark never replays
      if (lateMs > graceMs) return false;
      play(d, quarterIndex(d.getMinutes()));
      return true;
    }

    return {
      tick: tick,
      setEnabled: function (v) {
        enabled = !!v;
        lastPlayed = null;
        if (enabled) tick(); // playing on the spot when re-enabled mid-mark is OK
      },
      setEnabledQuiet: function (v) { // enable WITHOUT an immediate fire (tests)
        enabled = !!v;
        lastPlayed = enabled ? quarterKey(now()) : null;
      },
      isEnabled: function () { return enabled; },
      lastPlayed: function () { return lastPlayed; }
    };
  }

  var api = {
    BONG_GAP: BONG_GAP,
    STRIKE_PAUSE: STRIKE_PAUSE,
    MELODY_DUR: MELODY_DUR,
    Q45A_DUR: Q45A_DUR,
    NOTE_STEP: NOTE_STEP,
    MINIM_STEP: MINIM_STEP,
    bongsForHour: bongsForHour,
    quarterIndex: quarterIndex,
    quarterKey: quarterKey,
    quarterEvents: quarterEvents,
    bongsOnlyEvents: bongsOnlyEvents,
    createQuarterScheduler: createQuarterScheduler
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Chimes = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
