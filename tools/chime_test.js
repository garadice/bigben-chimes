#!/usr/bin/env node
/* Headless logic tests for chime.js (no DOM needed): node tools/chime_test.js */
'use strict';

const C = require('../chime.js');

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}`);
  }
}

function near(actual, expected, eps, label) {
  ok(Math.abs(actual - expected) <= (eps || 1e-6),
     `${label} (${actual} ≈ ${expected})`);
}

function d(h, m, s, ms) {
  // fixed date so keys are deterministic
  return new Date(2026, 10, 8, h, m, s || 0, ms || 0);
}

console.log('== bongsForHour (12 o’clock convention) ==');
for (let h = 0; h < 24; h++) {
  const expected = (h % 12) || 12;
  eq(C.bongsForHour(h), expected, `hour ${h} -> ${expected} bongs`);
}

console.log('== quarterIndex ==');
eq(C.quarterIndex(0), 0, 'minute 0 -> quarter 0');
eq(C.quarterIndex(14), 0, 'minute 14 -> quarter 0');
eq(C.quarterIndex(15), 1, 'minute 15 -> quarter 1');
eq(C.quarterIndex(29), 1, 'minute 29 -> quarter 1');
eq(C.quarterIndex(30), 2, 'minute 30 -> quarter 2');
eq(C.quarterIndex(44), 2, 'minute 44 -> quarter 2');
eq(C.quarterIndex(45), 3, 'minute 45 -> quarter 3');
eq(C.quarterIndex(59), 3, 'minute 59 -> quarter 3');

console.log('== quarterKey ==');
eq(C.quarterKey(d(14, 7)), '2026-11-08T14:00', '14:07 keys to the 14:00 mark');
eq(C.quarterKey(d(14, 15)), '2026-11-08T14:15', '14:15 keys to the 14:15 mark');
eq(C.quarterKey(d(14, 59)), '2026-11-08T14:45', '14:59 keys to the 14:45 mark');
eq(C.quarterKey(d(0, 1)), '2026-11-08T00:00', '00:01 keys to the 00:00 mark');

console.log('== measured constants ==');
eq(C.BONG_GAP, 4.015, 'strike gap = independently measured mean 4.015 s');
eq(C.MELODY_DUR, 20.8, 'complete 16-note melody asset 20.80 s');
eq(C.STRIKE_PAUSE, 0.6, 'explicit melody-end -> first-strike pause 0.6 s');

console.log('== quarterEvents(1) — :15, change 1 as one assembled asset ==');
const q1 = C.quarterEvents(1, 14);
eq(q1, [{ file: 'q15', at: 0 }], ':15 = the assembled change-1 recording, one event');
eq(C.quarterEvents(1, 23), [{ file: 'q15', at: 0 }], ':15 never schedules strikes');

console.log('== quarterEvents(2) — :30, changes 2+3 ==');
eq(C.quarterEvents(2, 14), [{ file: 'q30', at: 0 }],
   ':30 = the recorded changes-2+3 recording, one event');

console.log('== quarterEvents(3) — :45, changes 4+5+1 as one joined asset ==');
eq(C.quarterEvents(3, 14), [{ file: 'q45', at: 0 }],
   ':45 = the joined changes-4+5+1 recording, one event');

console.log('== quarterEvents(0) — :00 auto mode: melody AND hour strikes ==');
const q0_15 = C.quarterEvents(0, 15);
eq(q0_15.filter(e => e.file === 'bong').length, 3, 'hour 15 -> 3 strikes');
eq(q0_15.filter(e => e.file !== 'bong').map(e => e.file), ['melody'],
   ':00 starts with the original complete 16-note recording');
eq(q0_15.filter(e => e.file !== 'bong').map(e => e.at), [0], ':00 starts with the first recorded attack');
const bongs15 = q0_15.filter(e => e.file === 'bong');
eq(bongs15[0].at, 20.8 + 0.6, 'first strike after complete melody + pause');
eq(bongs15.map(e => e.n), [1, 2, 3], 'strike events carry 1-based bong count');
near(bongs15[1].at - bongs15[0].at, 4.015, 1e-9, 'strike spacing = measured 4.015 s');

for (const [h, n] of [[0, 12], [12, 12], [9, 9], [23, 11], [1, 1]]) {
  const ev = C.quarterEvents(0, h);
  eq(ev.filter(e => e.file === 'bong').length, n, `hour ${h} -> ${n} strikes`);
}

console.log('== melodyOnlyEvents — the :00 BUTTON is melody only ==');
eq(C.melodyOnlyEvents(), [{ file: 'melody', at: 0 }],
   ':00 button = the 16-note recording, zero strikes');
ok(C.melodyOnlyEvents().every(e => e.file !== 'bong'),
   'no hidden strike path in melodyOnlyEvents');

console.log('== hourPickerEvents — melody + exactly N strikes ==');
const p1 = C.hourPickerEvents(1);
eq(p1.filter(e => e.file === 'bong').length, 1, 'picker 1 -> exactly one strike');
eq(p1.filter(e => e.file !== 'bong').map(e => e.file), ['melody'], 'picker 1 opens with the melody');
near(p1.find(e => e.file === 'bong').at, 20.8 + 0.6, 1e-9, 'picker first strike after melody + pause');

const p12 = C.hourPickerEvents(12);
eq(p12.filter(e => e.file === 'bong').length, 12, 'picker 12 -> exactly twelve strikes');
eq(p12.filter(e => e.file === 'bong').map(e => e.n), Array.from({ length: 12 }, (_, i) => i + 1),
   'picker strikes carry 1..12 counts');
near(p12.filter(e => e.file === 'bong')[11].at - p12.filter(e => e.file === 'bong')[0].at,
     11 * 4.015, 1e-9, 'picker strike spacing = measured 4.015 s');

for (let n = 1; n <= 12; n++) {
  eq(C.hourPickerEvents(n).filter(e => e.file === 'bong').length, n,
     `picker ${n} -> ${n} strikes`);
}
eq(C.hourPickerEvents(7).filter(e => e.file === 'bong').length, 7,
   'picker 7 -> 7 strikes (chosen count wins over the real hour)');

console.log('== bongsOnlyEvents (BONGY) ==');
const bo = C.bongsOnlyEvents(23);
eq(bo.length, 11, 'hour 23 -> 11 bongs only');
eq(bo[0], { file: 'bong', at: 0, n: 1 }, 'first bong immediately, count 1');
eq(bo[10].at, bo[0].at + 10 * C.BONG_GAP, 'last bong lands 10 × gap after the first');
near(bo[10].at, 40.15, 1e-9, 'last of 11 bongs after ten measured intervals');
eq(C.bongsOnlyEvents(0).length, 12, 'midnight -> 12 bongs');

console.log('== timelines are sane ==');
const known = new Set(['melody', 'q30', 'q45', 'q15', 'bong']);
for (const q of [0, 1, 2, 3]) {
  const ev = C.quarterEvents(q, 10);
  let mono = true;
  for (let i = 1; i < ev.length; i++) {
    if (ev[i].at <= ev[i - 1].at) mono = false;
  }
  ok(mono, `quarter ${q}: event times strictly increasing`);
  for (const e of C.quarterEvents(q, 10)) {
    ok(known.has(e.file), `event file "${e.file}" is a shipped asset`);
  }
}
{
  // canonical ending rule: :15/:45 end on the dominant B3, :30/:00 on tonic E4.
  // :15 and :45 are single assets whose final note is asserted by
  // tools/audio_test.py (fingerprint bands); here we assert the asset choice.
  eq(C.quarterEvents(1, 10)[0].file, 'q15', ':15 = change-1 asset (ends B3, verified in audio_test.py)');
  eq(C.quarterEvents(2, 10)[0].file, 'q30', ':30 recorded phrase ends E4 (tonic)');
  eq(C.quarterEvents(3, 10)[0].file, 'q45', ':45 joined asset (ends B3, verified in audio_test.py)');
  eq(C.melodyOnlyEvents()[0].file, 'melody', ':00 button ends with the recorded tonic-E4 phrase');
  const all = [...C.quarterEvents(0, 10), ...C.melodyOnlyEvents(),
               ...C.hourPickerEvents(12), ...C.bongsOnlyEvents(10)];
  for (const e of all) {
    ok(known.has(e.file), `event file "${e.file}" is a shipped asset`);
  }
}

console.log('== quarter scheduler ==');
function makeHarness(start) {
  const log = [];
  let t = start.getTime();
  const sched = C.createQuarterScheduler(
    () => new Date(t),
    (date, q) => log.push({ key: C.quarterKey(date), q }),
    { graceMs: 90 * 1000 }
  );
  return { sched, log, set(h, m, s) { t = d(h, m, s || 0).getTime(); } };
}

{
  const h = makeHarness(d(14, 7));
  h.sched.setEnabledQuiet(true);
  h.sched.tick();
  eq(h.log, [], 'enable-quiet at 14:07 fires nothing (stale 14:00 mark)');
  h.set(14, 15, 0.5); h.sched.tick();
  eq(h.log, [{ key: '2026-11-08T14:15', q: 1 }], '14:15:00.5 fires quarter 1');
  h.set(14, 15, 2); h.sched.tick();
  eq(h.log.length, 1, 'same mark does not double-fire');
  h.set(14, 30, 1); h.sched.tick();
  eq(h.log[1], { key: '2026-11-08T14:30', q: 2 }, '14:30 fires quarter 2');
  h.set(14, 45, 1); h.sched.tick();
  eq(h.log[2], { key: '2026-11-08T14:45', q: 3 }, '14:45 fires quarter 3');
  h.set(15, 0, 1); h.sched.tick();
  eq(h.log[3], { key: '2026-11-08T15:00', q: 0 }, '15:00 fires quarter 0 (full hour)');
}

{
  // hour rollover at midnight: 23:00 mark then 00:00 with 12 bongs
  const h = makeHarness(d(23, 30));
  h.sched.setEnabledQuiet(true);
  h.set(0, 0, 1); h.sched.tick();
  eq(h.log, [{ key: '2026-11-08T00:00', q: 0 }], 'midnight rollover fires hour mark q0');
  const ev = C.quarterEvents(0, 0);
  eq(ev.filter(e => e.file === 'bong').length, 12, 'midnight timeline has 12 strikes');
}

{
  // grace window: tab frozen 3 min past the mark -> skipped, waits for next
  const h = makeHarness(d(14, 7));
  h.sched.setEnabledQuiet(true);
  h.set(14, 33, 0); h.sched.tick();
  eq(h.log, [], 'stale 14:30 mark (3 min late) skipped');
  h.set(14, 45, 0.2); h.sched.tick();
  eq(h.log.length, 1, 'next fresh mark fires normally after a skip');
}

{
  // late-but-within-grace: frozen tab resumes 60 s late -> still plays
  const h = makeHarness(d(14, 7));
  h.sched.setEnabledQuiet(true);
  h.set(14, 31, 0); h.sched.tick();
  eq(h.log.length, 1, 'mark 60 s late fires (inside 90 s grace)');
}

{
  // disable/enable: no fires while off; plain setEnabled fires immediately mid-mark
  const h = makeHarness(d(14, 7));
  h.sched.setEnabledQuiet(true);
  h.sched.setEnabled(false);
  h.set(14, 15, 1); h.sched.tick();
  eq(h.log, [], 'disabled scheduler never fires');
  h.set(14, 16, 0);
  h.sched.setEnabled(true);
  eq(h.log.length, 1, 'plain enable mid-mark fires the current mark at once');
  eq(h.sched.isEnabled(), true, 'isEnabled reflects state');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
