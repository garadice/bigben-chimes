/* Headless logic tests for bells.js (no DOM needed): node tools/bells_test.js */
'use strict';

const B = require('../bells.js');

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

console.log('== the 11-key E-major keyboard ==');
eq(B.NOTE_IDS, ['b3', 'cs4', 'ds4', 'e4', 'fs4', 'gs4', 'a4', 'b4', 'cs5', 'ds5', 'e5'],
  'keyboard spans B3…E5 diatonic E major, low to high');
eq(B.KEYBOARD_NOTES.map(n => n.num), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'number badges are 1–11 in pitch order');
eq(B.KEYBOARD_NOTES.map(n => n.file),
  ['bell-b3', 'bell-cs4', 'bell-ds4', 'bell-e4', 'bell-fs4',
   'bell-gs4', 'bell-a4', 'bell-b4', 'bell-cs5', 'bell-ds5', 'bell-e5'],
  'every key names its shipped audio file');
ok(B.KEYBOARD_NOTES.every(n => n.file === 'bell-' + n.id),
  'every key file is derived from its note id');

console.log('== mode A: the real tower instrument ==');
eq(B.QUARTER_BELLS.map(b => b.id), ['b3', 'e4', 'fs4', 'gs4'],
  'quarter bells are the Westminster pitches (chime.js NOTES)');
eq(B.GREAT_BELL, { id: 'great', file: 'bong' },
  'the Great Bell reuses the genuine 1945 bong recording');

console.log('== tuning provenance ==');
for (const id of B.NOTE_IDS) {
  const cents = B.centsOff(id);
  ok(Math.abs(cents) <= 8, `${id} measured within 8 cents of ET (${cents.toFixed(1)})`);
  ok(Math.abs(B.MEASURED_HZ[id] / B.ET_HZ[id] - 1) < 0.01, `${id} measured near ET frequency`);
}
ok(Math.abs(B.centsOff('b3') + 2.2) < 0.6, 'b3 keeps its documented -2.2 cent measurement');

console.log('== keyboard layout model ==');
const portrait = B.keyRows('portrait');
eq(portrait.map(r => r.length), [6, 5], 'portrait: two staggered rows of 6 + 5');
eq(portrait.flat(), B.NOTE_IDS, 'portrait rows keep low→high order across rows');
eq(B.keyRows('landscape'), [B.NOTE_IDS], 'landscape: one full-width row of all 11');
eq(B.keyRows('anything-else').map(r => r.length), [6, 5],
  'unknown orientation falls back to portrait rows');

console.log('== voice ledger (polyphony bookkeeping) ==');
{
  const ledger = B.createVoiceLedger(16);
  const ids = [];
  for (let i = 0; i < 16; i++) ids.push(ledger.acquire('b3').id);
  eq(ledger.count(), 16, '16 simultaneous voices are allowed');
  const overflow = ledger.acquire('e5');
  eq(ledger.count(), 16, 'the 17th press evicts before allocating');
  eq(overflow.evicted, [ids[0]], 'the OLDEST voice is evicted (FIFO)');
  ok(ledger.release(ids[1]), 'release finds an active id');
  eq(ledger.release(ids[1]), false, 'releasing twice reports nothing');
  eq(ledger.notes().slice(0, 2), ['b3', 'b3'], 'the ledger remembers each voice note');
}
{
  const ledger = B.createVoiceLedger(2);
  ledger.acquire('b3');
  ledger.acquire('e4');
  const third = ledger.acquire('gs4');
  eq(third.evicted.length, 1, 'small ledgers still evict exactly one');
  const all = ledger.stopAll();
  eq(all.length, 2, 'stopAll reports every active voice');
  eq(ledger.count(), 0, 'stopAll clears the ledger');
  ok(ledger.acquire('b3').id > third.id, 'voice ids never repeat');
}
{
  const ledger = B.createVoiceLedger(0);
  eq(ledger.acquire('b3').evicted, [], 'a nonsensical limit still allows one voice');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
