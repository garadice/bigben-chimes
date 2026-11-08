#!/usr/bin/env node
/* Regression tests for the real app wiring; no browser dependency. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(options = {}) {
  const elements = new Map();
  const audio = [];
  const timers = new Map();
  const log = [];
  let timerId = 0;
  let clock = Date.now();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = {
      id, value: '0.9', style: {}, listeners: {}, textContent: '',
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }
      },
      setAttribute(name, value) { this[name] = value; },
      focus() { context.document.activeElement = this; },
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
      fire(name) { for (const fn of this.listeners[name] || []) fn(); }
    };
    elements.set(id, el);
    return el;
  }
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.pending = []; audio.push(this); }
    play() {
      this.paused = false;
      log.push({type: 'play', src: this.src, muted: this.muted});
      return new Promise((resolve, reject) => this.pending.push({resolve, reject}));
    }
    pause() {
      this.paused = true; log.push({type: 'pause', src: this.src});
      // Real HTMLMediaElement rejects play() if paused before media is ready.
      if (options.abortOnPause) for (const p of this.pending.splice(0)) p.reject({name:'AbortError'});
    }
  }
  const storage = new Map();
  const context = {
    document: {
      getElementById: element, querySelector: element,
      createElement: () => ({canPlayType: () => 'probably'}),
      addEventListener: (...args) => element('document').addEventListener(...args)
    },
    Audio, Date: ClockDate, navigator: {}, location: {protocol: 'http:', hostname: '127.0.0.1'},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)},
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {}, console
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['chime.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, {filename:file});
  return {
    app: context.__BBC__, element, audio, timers, log,
    advance(ms) { clock += ms; },
    resolveAudio() { for (const p of audio) for (const item of p.pending.splice(0)) item.resolve(); },
    rejectAudio(name) { for (const p of audio) for (const item of p.pending.splice(0)) item.reject({name}); },
    async settle() { for (let i=0; i<12; i++) await Promise.resolve(); },
    runTimers() { const due = [...timers.entries()]; timers.clear(); for (const [,t] of due) t.fn(); }
  };
}

test('a cold pointerdown-to-click does not abort its own pending media unlock', async () => {
  const h = harness({abortOnPause:true});
  h.element('document').fire('pointerdown');
  h.element('btn-q1').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.app.isUnlocked(), true);
  h.runTimers();
  assert.deepEqual(h.log.filter(e => e.type === 'play' && !e.muted).map(e => e.src), ['audio/q15.m4a']);
});

test('STOP invalidates a button tap still waiting for audio unlock', async () => {
  const h = harness();
  h.element('btn-q1').fire('click');
  h.element('btn-stop').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 0, 'pending unlock must not resurrect stopped playback');
  assert.equal(h.audio.every(p => p.paused), true);
});

test('only the newest tap survives a shared pending audio unlock', async () => {
  const h = harness();
  h.element('btn-q1').fire('click');
  h.element('btn-q2').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 1);
  h.runTimers();
  assert.deepEqual(h.log.filter(e => e.type === 'play' && !e.muted).map(e => e.src), ['audio/q30.m4a']);
});

test('STOP also invalidates a pending NotAllowedError playback retry', async () => {
  const h = harness();
  h.app.playEvents([{file:'bong',at:0,n:1}]);
  h.runTimers();
  h.rejectAudio('NotAllowedError');
  await h.settle(); // retry is now waiting for the muted sweep
  h.element('btn-stop').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.log.filter(e => e.type === 'play' && !e.muted).length, 1,
    'only the original failed attempt, never a retry after STOP');
  assert.equal(h.audio.every(p => p.paused), true);
});

test('first automatic quarter waits for its gesture unlock before scheduling', async () => {
  const h = harness();
  h.app.setClockOffset(new Date(2026,10,8,14,15,10).getTime()-Date.now());
  h.element('btn-quarter').fire('click');
  assert.equal(h.timers.size, 0, 'the auto button must also wait for priming');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 1, ':15 is one assembled asset event');
});

test('automatic marks before any gesture are consumed without false playback', () => {
  const h = harness();
  h.app.setQuarterOn(true);
  h.app.setClockOffset(new Date(2026,10,8,14,15,10).getTime()-Date.now());
  h.app.scheduler.tick();
  assert.equal(h.timers.size, 0);
  assert.equal(h.log.filter(e => e.type === 'play').length, 0);
});

test('the playQuarter test hook actually starts the requested quarter', async () => {
  const h = harness();
  h.app.playQuarter(1);
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 1, ':15 plays one assembled asset');
});

test('the :00 button plays the melody ONLY — no strike path', async () => {
  const h = harness();
  h.element('btn-q4').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 1, 'melody only: a single event');
  h.runTimers();
  const plays = h.log.filter(e => e.type === 'play' && !e.muted).map(e => e.src);
  assert.deepEqual(plays, ['audio/melody.m4a'], 'no bong asset is ever started');
});

test('the picker overlay opens, picks a number and arms PLAY', () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  assert.equal(h.app.pickerState().open, true);
  assert.equal(h.app.pickerState().hour, null);
  const play = h.element('picker-play');
  play.fire('click'); // nothing chosen: must stay inert
  assert.equal(h.timers.size, 0);
  h.element('btn-p7').fire('click');
  assert.equal(h.app.pickerState().hour, 7);
  assert.equal(play.textContent, '▶ 7', 'the chosen hour shows on the play button');
});

test('picker PLAY schedules the melody then EXACTLY the chosen strikes', async () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p2').fire('click');
  h.element('picker-play').fire('click');
  assert.equal(h.app.pickerState().open, false, 'overlay closes after use');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 4, 'melody + 2 strikes + the armed-hide timer');
  h.runTimers();
  const plays = h.log.filter(e => e.type === 'play' && !e.muted).map(e => e.src);
  assert.deepEqual(plays, ['audio/melody.m4a', 'audio/bong.m4a', 'audio/bong.m4a'],
    'exactly two bong starts after the melody');
  assert.equal(h.element('armed').classList.contains('show'), false,
    'the armed badge clears when the timeline ends');
});

test('the chosen-hour badge lasts through the final strike decay', async () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p1').fire('click');
  h.element('picker-play').fire('click');
  h.resolveAudio(); await h.settle();
  const last = Math.max(...[...h.timers.values()].map(t => t.ms));
  assert.ok(last >= (20.8 + .6 + 3.43) * 1000 - 1,
    'badge must not clear 1.2 seconds into a 3.43-second strike');
});

test('the armed badge shows the chosen hour while the picker plays', async () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p11').fire('click');
  h.element('picker-play').fire('click');
  h.resolveAudio();
  await h.settle();
  const armed = h.element('armed');
  assert.equal(armed.textContent, '🔔 11');
  assert.equal(armed.classList.contains('show'), true);
  h.element('btn-stop').fire('click');
  assert.equal(armed.classList.contains('show'), false, 'STOP clears the badge');
});

test('STOP kills picker playback and closes the overlay', async () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p5').fire('click');
  h.element('picker-play').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 7, 'melody + 5 strikes + armed-hide timer');
  h.element('btn-stop').fire('click');
  assert.equal(h.timers.size, 0, 'STOP kills the whole picker timeline');
  assert.equal(h.audio.every(p => p.paused), true);
  assert.equal(h.app.pickerState().open, false, 'overlay closed by STOP');
  const due = [...h.timers.values()]; due.length = 0;
  h.runTimers();
  const plays = h.log.filter(e => e.type === 'play' && !e.muted).map(e => e.src);
  assert.equal(plays.filter(s => s.endsWith('bong.m4a')).length, 0,
    'no scheduled strike survives STOP');
});

test('the picker choice never leaks into BONGY or auto-chime', async () => {
  const h = harness();
  h.app.setClockOffset(new Date(2026,10,8,15,7,0).getTime()-Date.now());
  h.element('btn-picker').fire('click');
  h.element('btn-p7').fire('click');
  h.element('picker-play').fire('click');
  h.resolveAudio();
  await h.settle();
  h.element('btn-stop').fire('click');
  h.element('btn-bongs').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 3, 'BONGY at 15:07 still strikes the real 3');
  h.runTimers();
  const plays = h.log.filter(e => e.type === 'play' && !e.muted).map(e => e.src);
  assert.equal(plays.filter(s => s.endsWith('bong.m4a')).length, 3,
    'BONGY count comes from the clock, not the picker');
});

test('the consumed choice resets: the next picker open starts fresh', async () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p9').fire('click');
  h.element('picker-play').fire('click');
  h.resolveAudio();
  await h.settle();
  h.element('btn-picker').fire('click');
  assert.equal(h.app.pickerState().hour, null, 'no stale hour is preselected');
  h.element('btn-p9').fire('click');
  h.element('picker-play').fire('click');
  h.resolveAudio();
  await h.settle();
  assert.equal(h.timers.size, 11, 'picker 9 again: melody + 9 strikes + hide timer');
});

test('the overlay close button closes without playing', () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p3').fire('click');
  h.element('picker-close').fire('click');
  assert.equal(h.app.pickerState().open, false);
  assert.equal(h.timers.size, 0, 'closing never starts audio');
});

test('tapping the clock opens the picker', () => {
  const h = harness();
  h.element('btn-clock').fire('click');
  assert.equal(h.app.pickerState().open, true);
  h.element('btn-picker').fire('click'); // toggle closes it again
  assert.equal(h.app.pickerState().open, false);
});

test('STOP clears an unplayed picker choice before the next open', () => {
  const h = harness();
  h.element('btn-picker').fire('click');
  h.element('btn-p7').fire('click');
  h.element('btn-stop').fire('click');
  h.element('btn-picker').fire('click');
  assert.equal(h.app.pickerState().hour, null, 'STOP must discard the unfinished choice');
  assert.equal(h.element('picker-play').textContent, '▶');
});

test('a long-suspended timeline never dumps stale strikes on resume', () => {
  const h = harness();
  h.app.playEvents([{file:'bong',at:0,n:1},{file:'bong',at:4.015,n:2}]);
  h.advance(60000);
  h.runTimers();
  assert.equal(h.log.filter(e => e.type === 'play').length, 0);
  assert.equal(h.timers.size, 0);
});

test('failed audio priming is not reported as unlocked and can retry', async () => {
  const h = harness();
  h.app.unlock();
  h.rejectAudio('NotAllowedError');
  await h.settle();
  assert.equal(h.app.isUnlocked(), false);
  h.app.unlock();
  h.resolveAudio();
  await h.settle();
  assert.equal(h.app.isUnlocked(), true);
});

test('concurrent unlock callers wait for the same in-flight audio sweep', async () => {
  const h = harness();
  let first = false;
  let second = false;
  h.app.unlock().then(() => { first = true; });
  h.app.unlock().then(() => { second = true; });
  await h.settle();
  assert.equal(first, false);
  assert.equal(second, false, 'a second caller must not start a note before the muted sweep has paused it');
  h.resolveAudio();
  await h.settle();
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(h.audio.length, h.log.filter(e => e.type === 'play').length);
});
