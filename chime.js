/* Big Ben Chimes — pure chime logic (no DOM, node-testable).
 *
 * Sound model (matches the shipped assets, see LICENSES.md):
 *   audio/melody.m4a — the full Westminster Quarters sequence (17.67 s),
 *                      real Big Ben broadcast, New Year 1945.
 *   audio/bong.m4a   — a single hour strike with its natural decay (4.10 s).
 *
 * Because freely-licensed recordings of the distinct short quarter phrases
 * (the 15/30/45 chimes) are not available, every quarter plays the full
 * recorded sequence; the hour adds the correct number of bongs.
 * Bong count = (hour % 12) || 12  →  midnight/noon strike 12 times.
 */
(function (global) {
  'use strict';

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

  /**
   * Timeline for the FULL chime (quarter sequence + N hour bongs).
   * Returns [{file:'melody'|'bong', at:seconds}, ...] in play order.
   * opts.melodyDur default 17.67 (the shipped file), opts.gap default 2.0 s —
   * the card-mandated realistic 1.5–2 s bong spacing.
   */
  function fullChimeEvents(hour, opts) {
    opts = opts || {};
    var melodyDur = opts.melodyDur != null ? opts.melodyDur : 17.67;
    var gap = opts.gap != null ? opts.gap : 2.0;
    var events = [{ file: 'melody', at: 0 }];
    var n = bongsForHour(hour);
    for (var i = 0; i < n; i++) {
      events.push({ file: 'bong', at: melodyDur + gap + i * gap });
    }
    return events;
  }

  /** Timeline for bongs only (the "just the bongs" button). */
  function bongsOnlyEvents(hour, opts) {
    opts = opts || {};
    var gap = opts.gap != null ? opts.gap : 2.0;
    var events = [];
    var n = bongsForHour(hour);
    for (var i = 0; i < n; i++) {
      events.push({ file: 'bong', at: i * gap });
    }
    return events;
  }

  /** Timeline for the quarter melody alone (used on :15/:30/:45). */
  function melodyOnlyEvents() {
    return [{ file: 'melody', at: 0 }];
  }

  /**
   * Quarter scheduler. Call tick() ~every second. When enabled and the clock
   * enters a NEW quarter mark, fires play(date, quarterIndex) — quarter 0 gets
   * the full chime, 1–3 the melody alone.
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
    bongsForHour: bongsForHour,
    quarterIndex: quarterIndex,
    quarterKey: quarterKey,
    fullChimeEvents: fullChimeEvents,
    bongsOnlyEvents: bongsOnlyEvents,
    melodyOnlyEvents: melodyOnlyEvents,
    createQuarterScheduler: createQuarterScheduler
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Chimes = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
