/* Big Ben Chimes — pure ZVONKY play-screen logic (no DOM, node-testable).
 *
 * v1.4.0 play modes (Martin's decision, implemented as chosen):
 *   MODE A "big bells"  — the tower's REAL quarter instrument per chime.js
 *                         (B3, E4, F#4, G#4) plus one dominant GREAT BELL
 *                         that reuses audio/bong.* (the genuine 1945 PD
 *                         Great Bell recording already shipped).
 *   MODE B "keyboard"   — 11 diatonic E-major bells B3…E5 (Lurie Carillon
 *                         samples, CC BY 4.0), numbered 1–11 like the video.
 *
 * E major is chosen so every Westminster change (G#4 F#4 E4 B3) lands on
 * keys of this keyboard and anything a child plays fits the chime world.
 *
 * Audio provenance (docs/DEV.md, LICENSES.md): Ann & Robert H. Lurie
 * Carillon, University of Michigan — bells cast by Royal Eijsbouts,
 * recorded October 2016 by Isaac Levine et al., CC BY 4.0. The carillon is
 * chromatic and ET-tuned: each target note uses the bell whose MEASURED
 * nominal is nearest (all within ±7 cents, see centsOff below). No pitch
 * shifting anywhere.
 */
(function (global) {
  'use strict';

  /* Equal-temperament reference (A4 = 440) and the Lurie sample measured
   * on 2026-11-21 (tools/make_bells.py measurement log). */
  var ET_HZ = {
    b3: 246.94, cs4: 277.18, ds4: 311.13, e4: 329.63, fs4: 369.99,
    gs4: 415.30, a4: 440.00, b4: 493.88, cs5: 554.37, ds5: 622.25, e5: 659.26
  };
  var MEASURED_HZ = {
    b3: 246.6, cs4: 276.6, ds4: 310.2, e4: 329.4, fs4: 371.4,
    gs4: 414.5, a4: 439.7, b4: 493.9, cs5: 554.8, ds5: 621.4, e5: 659.8
  };

  var NOTE_IDS = ['b3', 'cs4', 'ds4', 'e4', 'fs4', 'gs4',
                  'a4', 'b4', 'cs5', 'ds5', 'e5'];

  /** The 11 keyboard bells, low → high, with kid-visible number badges 1–11. */
  var KEYBOARD_NOTES = NOTE_IDS.map(function (id, index) {
    return { id: id, num: index + 1, file: 'bell-' + id, hz: ET_HZ[id] };
  });

  /** Mode A: the real Westminster quarter bells + the Great Bell. */
  var QUARTER_BELLS = ['b3', 'e4', 'fs4', 'gs4'].map(function (id) {
    return { id: id, file: 'bell-' + id, hz: ET_HZ[id] };
  });
  var GREAT_BELL = { id: 'great', file: 'bong' };

  /**
   * Keyboard grouping per orientation. Portrait = two staggered rows
   * (6 + 5); landscape = one full-width row of all 11. The DOM ships the
   * same two row containers; styles.css flattens them with display:contents
   * in landscape — this function is the tested model of that contract.
   */
  function keyRows(orientation) {
    if (orientation === 'landscape') return [NOTE_IDS.slice()];
    return [NOTE_IDS.slice(0, 6), NOTE_IDS.slice(6)];
  }

  /** Measured tuning distance of a key from its equal-tempered pitch. */
  function centsOff(id) {
    return 1200 * Math.log2(MEASURED_HZ[id] / ET_HZ[id]);
  }

  /**
   * Polyphony bookkeeping (pure). acquire(noteId) FIFO-evicts the oldest
   * active voice when the mash exceeds max, so 11 thumbs can never pile up
   * unbounded WebAudio nodes. release/stopAll return the evicted ids so the
   * engine can stop those sources.
   */
  function createVoiceLedger(max) {
    var limit = Math.max(1, max | 0);
    var active = [];       // [{id, note}] oldest first
    var nextId = 0;
    return {
      acquire: function (note) {
        var evicted = [];
        while (active.length >= limit) evicted.push(active.shift().id);
        var id = ++nextId;
        active.push({ id: id, note: note });
        return { id: id, evicted: evicted };
      },
      release: function (id) {
        for (var i = 0; i < active.length; i++) {
          if (active[i].id === id) return active.splice(i, 1)[0].id === id;
        }
        return false;
      },
      stopAll: function () {
        var ids = active.map(function (v) { return v.id; });
        active = [];
        return ids;
      },
      count: function () { return active.length; },
      notes: function () { return active.map(function (v) { return v.note; }); }
    };
  }

  var api = {
    ET_HZ: ET_HZ,
    MEASURED_HZ: MEASURED_HZ,
    NOTE_IDS: NOTE_IDS,
    KEYBOARD_NOTES: KEYBOARD_NOTES,
    QUARTER_BELLS: QUARTER_BELLS,
    GREAT_BELL: GREAT_BELL,
    keyRows: keyRows,
    centsOff: centsOff,
    createVoiceLedger: createVoiceLedger
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Bells = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
