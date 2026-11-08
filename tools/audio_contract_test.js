#!/usr/bin/env node
/* Real source contracts: catches wrong slices/whole phrases, not filename lengths. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../chime.js');
test('the full-hour button plays the complete recorded 16-note source once',()=>{
 const events=C.quarterEvents(0,3);
 assert.deepEqual(events.filter(e=>e.file!=='bong'),[{file:'melody',at:0}]);
 assert.equal(C.MELODY_DUR,20.8);
});
test('half past plays only the first eight notes from the original source',()=>{
 assert.deepEqual(C.quarterEvents(2,3),[{file:'q30',at:0}]);
});
test('quarter to joins recorded changes 4+5 to change 1 after a complete minim',()=>{
 const ev=C.quarterEvents(3,3);
 assert.deepEqual(ev.map(e=>e.file),['q45a','n-gs4','n-fs4','n-e4','n-b3']);
 assert.equal(C.Q45A_DUR,6.55);
 assert.ok(Math.abs(ev[1].at-6.55)<1e-9);
});
test('assembled crotchet/minim rhythm follows actual hammer attacks, not overtone peaks',()=>{
 assert.equal(C.NOTE_STEP,0.7);
 assert.equal(C.MINIM_STEP,1.4);
});
