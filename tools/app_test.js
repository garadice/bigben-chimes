#!/usr/bin/env node
/* Regression tests for the real app wiring; no browser dependency. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
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
    pause() { this.paused = true; log.push({type: 'pause', src: this.src}); }
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
