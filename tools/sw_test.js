#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function harness(headers={}) {
 const handlers={};const stores=new Map();const requests=[];
 const origin='https://example.test';
 const key='bigben-chimes-v1.2.0';
 const cache={
  match:async req=>new Response('0123456789',{headers}),
  put:async()=>{},addAll:async()=>{}
 };
 stores.set(key,cache);
 const caches={open:async k=>stores.get(k)||cache,match:cache.match,keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k)};
 const context={self:{addEventListener:(type,fn)=>{handlers[type]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
  location:{origin},caches,URL,Request,Response,
  fetch:async req=>{requests.push(req);return new Response('network');}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),context);
 return {stores,requests,cache,key,
  async get(range) {let response;handlers.fetch({request:new Request(origin+'/audio/bong.m4a',{headers:range?{Range:range}:{}}),respondWith:p=>{response=p;}});return response;},
  async activate(){let work;handlers.activate({waitUntil:p=>{work=p;}});await work;}
 };
}

test('cached shell hits do not make background network requests',async()=>{
 const h=harness();assert.equal(await (await h.get()).text(),'0123456789');
 assert.equal(h.requests.length,0);
});
test('activation removes only this app\'s obsolete caches',async()=>{
 const h=harness();h.stores.set('bigben-chimes-v1.0.1',h.cache);h.stores.set('another-app-v3',h.cache);
 await h.activate();
 assert.deepEqual([...h.stores.keys()],[h.key,'another-app-v3']);
});
test('byte ranges use actual body size when Content-Length is absent',async()=>{
 const h=harness({'Content-Type':'audio/mp4'});const response=await h.get('bytes=2-5');
 assert.equal(response.status,206);assert.equal(await response.text(),'2345');
 assert.equal(response.headers.get('Content-Range'),'bytes 2-5/10');
});
test('compressed/stale Content-Length does not truncate decoded range bodies',async()=>{
 const h=harness({'Content-Length':'4'});const response=await h.get('bytes=5-');
 assert.equal(response.status,206);assert.equal(await response.text(),'56789');
});
test('suffix, open, clamped and unsatisfiable media ranges are correct',async()=>{
 for(const [range,status,text] of [['bytes=-3',206,'789'],['bytes=8-',206,'89'],['bytes=8-99',206,'89'],['bytes=10-',416,''],['bytes=-0',416,'']]){
  const h=harness({'Content-Length':'10'});const response=await h.get(range);
  assert.equal(response.status,status,range);assert.equal(await response.text(),text,range);
 }
});
