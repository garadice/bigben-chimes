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

console.log('== fullChimeEvents ==');
const ev23 = C.fullChimeEvents(23, { melodyDur: 17.67, gap: 2.0 });
eq(ev23.length, 12, 'hour 23 -> melody + 11 bongs');
eq(ev23[0], { file: 'melody', at: 0 }, 'melody first at t=0');
eq(ev23[1].at, 19.67, 'first bong lands after melody + gap (17.67+2.0)');
eq(ev23[2].at - ev23[1].at, 2.0, 'bong spacing 2.0 s');
eq(C.fullChimeEvents(0).length, 13, 'midnight -> melody + 12 bongs');
eq(C.fullChimeEvents(12).length, 13, 'noon -> melody + 12 bongs');
eq(C.fullChimeEvents(9).length, 10, '9:00 -> melody + 9 bongs');

console.log('== bongsOnlyEvents ==');
const bo = C.bongsOnlyEvents(23, { gap: 2.0 });
eq(bo.length, 11, 'hour 23 -> 11 bongs only');
eq(bo[0].at, 0, 'first bong immediately');
eq(bo[10].at, 20, 'last of 11 bongs at 20.0 s');
eq(C.bongsOnlyEvents(0).length, 12, 'midnight -> 12 bongs');

console.log('== melodyOnlyEvents ==');
eq(C.melodyOnlyEvents(), [{ file: 'melody', at: 0 }], 'single melody event');

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
  eq(h.log, [{ key: '2026-11-08T14:15', q: 1 }], '14:15:00.5 fires quarter 1 (melody)');
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
