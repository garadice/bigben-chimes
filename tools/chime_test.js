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
eq(C.NOTE_STEP, 0.7, 'crotchet spacing 0.7 s (measured hammer attacks)');
eq(C.MINIM_STEP, 1.4, 'minim slot 1.4 s');
eq(C.MELODY_DUR, 20.8, 'complete 16-note melody asset 20.80 s');
eq(C.Q45A_DUR, 6.55, 'q45a asset 6.55 s');

console.log('== quarterEvents(1) — :15, change 1 ==');
const q1 = C.quarterEvents(1, 14);
eq(q1.map(e => e.file), ['n-gs4', 'n-fs4', 'n-e4', 'n-b3'], ':15 = 4 note slices, change 1');
eq(q1.map(e => +e.at.toFixed(3)), [0, 0.7, 1.4, 2.1], ':15 crotchet rhythm');
eq(q1[3].file, 'n-b3', ':15 ends on the dominant B3');

console.log('== quarterEvents(2) — :30, changes 2+3 ==');
const q2 = C.quarterEvents(2, 14);
eq(q2.map(e => e.file), ['q30'], ':30 = recorded changes 2+3, eight attacks');
eq(q2.map(e => e.at), [0], ':30 keeps the original recorded rhythm intact');
eq(q2[0].file, 'q30', ':30 recorded phrase ends on tonic E4');

console.log('== quarterEvents(3) — :45, changes 4+5+1 ==');
const q3 = C.quarterEvents(3, 14);
eq(q3.map(e => e.file), ['q45a', 'n-gs4', 'n-fs4', 'n-e4', 'n-b3'],
   ':45 = recorded 4+5 chunk + assembled change 1 (12 notes)');
eq(q3.map(e => +e.at.toFixed(3)), [0, 6.55, 7.25, 7.95, 8.65],
   ':45 change 1 starts right after the q45a chunk');
eq(q3[4].file, 'n-b3', ':45 ends on the dominant B3');

console.log('== quarterEvents(0) — :00 full hour ==');
const q0_15 = C.quarterEvents(0, 15);
eq(q0_15.filter(e => e.file === 'bong').length, 3, 'hour 15 -> 3 strikes');
eq(q0_15.filter(e => e.file !== 'bong').map(e => e.file), ['melody'],
   ':00 = the original complete 16-note recording');
eq(q0_15.filter(e => e.file !== 'bong').map(e => e.at), [0], ':00 starts with the first recorded attack');
const bongs15 = q0_15.filter(e => e.file === 'bong');
eq(bongs15[0].at, 20.8 + 0.6, 'first strike after complete melody + pause');
eq(bongs15.map(e => e.n), [1, 2, 3], 'strike events carry 1-based bong count');
near(bongs15[1].at - bongs15[0].at, 4.015, 1e-9, 'strike spacing = measured 4.015 s');

for (const [h, n] of [[0, 12], [12, 12], [9, 9], [23, 11], [1, 1]]) {
  const ev = C.quarterEvents(0, h);
  eq(ev.filter(e => e.file === 'bong').length, n, `hour ${h} -> ${n} strikes`);
}

console.log('== bongsOnlyEvents (BONGY) ==');
const bo = C.bongsOnlyEvents(23);
eq(bo.length, 11, 'hour 23 -> 11 bongs only');
eq(bo[0], { file: 'bong', at: 0, n: 1 }, 'first bong immediately, count 1');
eq(bo[10].at, bo[0].at + 10 * C.BONG_GAP, 'last bong lands 10 × gap after the first');
near(bo[10].at, 40.15, 1e-9, 'last of 11 bongs after ten measured intervals');
eq(C.bongsOnlyEvents(0).length, 12, 'midnight -> 12 bongs');

console.log('== timelines are sane ==');
for (const q of [0, 1, 2, 3]) {
  const ev = C.quarterEvents(q, 10);
  let mono = true;
  for (let i = 1; i < ev.length; i++) {
    if (ev[i].at <= ev[i - 1].at) mono = false;
  }
  ok(mono, `quarter ${q}: event times strictly increasing`);
}
{
  // canonical ending-pitch rule: :15/:45 dominant B3, :30/:00 tonic E4
  const lastNote = q => {
    const ev = C.quarterEvents(q, 10).filter(e => e.file !== 'bong');
    return ev[ev.length - 1].file;
  };
  eq(lastNote(1), 'n-b3', ':15 ends B3 (dominant)');
  eq(lastNote(2), 'q30', ':30 recorded phrase ends E4 (tonic)');
  eq(lastNote(3), 'n-b3', ':45 ends B3 (dominant)');
  eq(lastNote(0), 'melody', ':00 ends with the recorded tonic-E4 phrase');
  // every event file maps to a shipped asset base
  const known = new Set(['melody', 'q30', 'q45a', 'bong', 'n-gs4', 'n-fs4', 'n-e4', 'n-b3']);
  for (const q of [0, 1, 2, 3]) {
    for (const e of C.quarterEvents(q, 10)) {
      ok(known.has(e.file), `event file "${e.file}" is a shipped asset`);
    }
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
