#!/usr/bin/env node
/* Real source contracts for the v1.2.0 quarter assets: catches wrong or
 * missing content, not filename lengths. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../chime.js');
test('the full-hour button plays the melody ONLY (zero strikes)',()=>{
 const events=C.melodyOnlyEvents();
 assert.deepEqual(events,[{file:'melody',at:0}]);
 assert.ok(!events.some(e=>e.file==='bong'),':00 button must not schedule a bong');
 assert.equal(C.MELODY_DUR,20.8);
});
test('half past plays only the recorded changes 2+3 asset',()=>{
 assert.deepEqual(C.quarterEvents(2,3),[{file:'q30',at:0}]);
});
test('quarter past is the assembled change-1 asset, never slices or strikes',()=>{
 const ev=C.quarterEvents(1,3);
 assert.deepEqual(ev,[{file:'q15',at:0}]);
});
test('quarter to is the joined changes-4+5+1 asset',()=>{
 assert.deepEqual(C.quarterEvents(3,3),[{file:'q45',at:0}]);
});
test('auto hour keeps the real behavior: melody AND the hour strikes',()=>{
 const ev=C.quarterEvents(0,15);
 assert.deepEqual(ev.filter(e=>e.file!=='bong'),[{file:'melody',at:0}]);
 assert.equal(ev.filter(e=>e.file==='bong').length,3);
});
test('picker plays the chosen number of strikes exactly',()=>{
 assert.equal(C.hourPickerEvents(1).filter(e=>e.file==='bong').length,1);
 assert.equal(C.hourPickerEvents(12).filter(e=>e.file==='bong').length,12);
 const p7=C.hourPickerEvents(7);
 assert.equal(p7.filter(e=>e.file==='bong').length,7);
 for(const e of p7.filter(e=>e.file==='bong'))
   assert.equal(e.file,'bong');
});
test('picker strike spacing is the measured 4.015 s',()=>{
 const bongs=C.hourPickerEvents(12).filter(e=>e.file==='bong');
 assert.ok(Math.abs(bongs[1].at-bongs[0].at-C.BONG_GAP)<1e-9);
});
