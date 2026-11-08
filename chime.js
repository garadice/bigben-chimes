/* Big Ben Chimes — pure chime logic (no DOM, node-testable).
 *
 * Sound model v1.2 (see docs/DEV.md for the evidence behind every number):
 *   audio/melody.m4a — complete recorded 16-note hour chime, 20.80 s.
 *   audio/q30.m4a    — recorded changes 2+3 (8 notes), 7.23 s.
 *   audio/q15.m4a    — change 1 (4 notes) assembled OFFLINE from the same
 *                      recording at its own measured rhythm, 3.44 s.
 *   audio/q45.m4a    — recorded changes 4+5 + the assembled change 1,
 *                      joined at the measured change gap, 10.05 s.
 *   audio/bong.m4a   — one hour strike + natural decay, 3.43 s.
 *
 * Westminster Quarters pattern (Wikipedia, "Westminster Quarters"):
 *   five changes of the four quarter bells (G#4, F#4, E4, B3):
 *     1: G#4 F#4 E4 B3   2: E4 G#4 F#4 B3   3: E4 F#4 G#4 E4
 *     4: G#4 E4 F#4 B3   5: B3 F#4 G#4 E4
 *   :15 = change 1 (q15) · :30 = changes 2+3 (q30) · :45 = changes 4+5+1
 *   (q45) · :00 = changes 2+3+4+5 (the melody recording). Quarters ending
 *   on the tonic E4: :30 and :00. Ending on the dominant B3: :15 and :45.
 *   (Asserted in tools/chime_test.js.)
 *
 * The full-hour BUTTON plays the melody only (Martin's v1.2 request). The
 * AUTO quarter mode and the hour picker schedule the Great Bell strikes:
 * bong count = (hour % 12) || 12 → midnight/noon strikes 12 times; the
 * picker strikes the CHOSEN number exactly.
 */
(function (global) {
  'use strict';

  /* ---- evidence-derived constants (docs/DEV.md) ---- */
  var BONG_GAP = 4.015;     // mean of 11 independently measured strike intervals
  var BONG_DUR = 3.43;     // the complete shipped strike and its decay
  var STRIKE_PAUSE = 0.6;   // melody asset end -> first strike (kid-friendly)
  var MELODY_DUR = 20.80;   // audio/melody.m4a

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

  function melodyEvents(opts) {
    return [{ file: 'melody', at: 0 }];
  }

  function strikeEvents(count, opts) {
    var gap = opts.bongGap != null ? opts.bongGap : BONG_GAP;
    var first = opts.melodyDur != null ? opts.melodyDur : MELODY_DUR;
    first += opts.strikePause != null ? opts.strikePause : STRIKE_PAUSE;
    var events = [];
    for (var i = 0; i < count; i++) {
      events.push({ file: 'bong', at: first + i * gap, n: i + 1 });
    }
    return events;
  }

  /**
   * Timeline for quarter mark q (0=:00 … 3=:45) at wall-clock `hour`.
   * Used by the AUTO quarter mode (the real tower's behavior: on the hour
   * the melody is followed by the hour strikes). Returns [{file, at, n?}]
   * sorted by time; strike events carry n (1-based bong count, drives the
   * big counting display).
   * opts.bongGap / opts.strikePause / opts.melodyDur are overridable for
   * tests; defaults are the measured constants above.
   */
  function quarterEvents(q, hour, opts) {
    opts = opts || {};
    var events;
    if (q === 1) {
      events = [{ file: 'q15', at: 0 }];
    } else if (q === 2) {
      events = [{ file: 'q30', at: 0 }];
    } else if (q === 3) {
      events = [{ file: 'q45', at: 0 }];
    } else {
      events = melodyEvents(opts).concat(strikeEvents(bongsForHour(hour), opts));
    }
    return events;
  }

  /** :00 button: the recorded 16-note chime ONLY — zero strikes. */
  function melodyOnlyEvents(opts) {
    opts = opts || {};
    return melodyEvents(opts);
  }

  /** Hour picker: melody, then EXACTLY the chosen number of strikes. */
  function hourPickerEvents(n, opts) {
    opts = opts || {};
    var count = Math.min(12, Math.max(1, Math.round(n)));
    return melodyEvents(opts).concat(strikeEvents(count, opts));
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
    BONG_DUR: BONG_DUR,
    STRIKE_PAUSE: STRIKE_PAUSE,
    MELODY_DUR: MELODY_DUR,
    bongsForHour: bongsForHour,
    quarterIndex: quarterIndex,
    quarterKey: quarterKey,
    quarterEvents: quarterEvents,
    melodyOnlyEvents: melodyOnlyEvents,
    hourPickerEvents: hourPickerEvents,
    bongsOnlyEvents: bongsOnlyEvents,
    createQuarterScheduler: createQuarterScheduler
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Chimes = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
