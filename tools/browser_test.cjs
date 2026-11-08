#!/usr/bin/env node
/* Dev-only browser regression. No dependencies are shipped with the app.
 * PLAYWRIGHT_MODULE=/path/to/playwright BBC_EVIDENCE_DIR=/path node tools/browser_test.cjs
 */
'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.BBC_EVIDENCE_DIR || process.env.TMPDIR;
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.m4a':'audio/mp4','.ogg':'audio/ogg','.md':'text/plain'};
const serverRequests=[];
let revision=null;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');const name=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
  if(name.startsWith('.') || name.split('/').includes('..')){res.writeHead(404).end();return;}
  serverRequests.push(name);
  const data=revision ? execFileSync('git',['show',revision+':'+name],{cwd:ROOT,maxBuffer:10000000,stdio:['ignore','pipe','pipe']}) : await fs.readFile(path.join(ROOT,name));
  res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-store'});res.end(data);
 }catch(e){res.writeHead(404).end();}
});
const controls=[];
const checks=[];
const errors=[];
function check(condition,name,detail){checks.push({name,pass:!!condition,detail});if(!condition)errors.push({name,detail});}
async function census(page,label){
 const inventory=await page.locator('button,input,a,select,textarea,[role=button],summary').evaluateAll(nodes=>nodes.filter(e=>{
  const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('[inert]');}).map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector:'#'+e.id,label:e.getAttribute('aria-label')||e.textContent,tag:e.tagName,disabled:e.disabled||false,reachable:hit===e||e.contains(hit),rect:r.toJSON()};}));
 controls.push({screen:label,count:inventory.length,controls:inventory});return inventory;
}
async function dragVolume(page,context,to){
 const box=await page.locator('#volume').boundingBox();
 const value=Number(await page.locator('#volume').inputValue());
 const x=box.x+13+(box.width-26)*value,y=box.y+box.height/2;
 const end=box.x+13+(box.width-26)*to;
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(end-x)*i/12,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 const after=Number(await page.locator('#volume').inputValue());
 check(Math.abs(after-to)<.08,'real touch volume drag to '+to,{after});
}
async function operateSurface(page,context,label){
 for(const id of ['btn-q1','btn-q2','btn-q3','btn-q4','btn-bongs']){
  const before=await page.evaluate(()=>__BBC__.stats().gen);await page.locator('#'+id).tap();
  await page.waitForTimeout(35);check(await page.evaluate(g=>__BBC__.stats().gen>g,before),label+' operated '+id);
 }
 await page.locator('#btn-stop').tap();
 check(await page.evaluate(()=>__BBC__.stats().timers===0),label+' operated STOP');
 await page.locator('#btn-quarter').tap();check(await page.evaluate(()=>__BBC__.scheduler.isEnabled()),label+' operated auto ON');
 await page.locator('#btn-quarter').tap();
 await page.locator('#btn-mute').tap();check(await page.locator('#volume').isDisabled(),label+' operated mute');
 await page.locator('#btn-mute').tap();
 for(const target of [.15,.85,.4])await dragVolume(page,context,target);
}
async function pickerGeometry(page,label,width,height){
 await page.locator('#btn-picker').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().open),label+' picker opens');
 check(await page.locator('#picker').evaluate(e=>getComputedStyle(e).display==='flex'),label+' picker overlay is displayed');
 const alpha=await page.locator('#picker').evaluate(e=>getComputedStyle(e).backgroundColor);
 check(/rgba\([^)]+,\s*0\.\d+\)/.test(alpha),label+' picker overlay is translucent ('+alpha+')');
 const photoVisible=await page.evaluate(()=>{const p=document.querySelector('.tower');return p.naturalWidth>0;});
 check(photoVisible,label+' photo stays loaded behind the overlay');
 const inventory=await census(page,label+' picker');
 for(const item of inventory){const r=item.rect;check(item.reachable&&r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height,label+' picker bounds and hit target '+item.selector,r);}
 await page.screenshot({path:path.join(OUT,'picker-'+label+'.png')});
 const before=await page.evaluate(()=>__BBC__.stats().gen);
 const playBox=await page.locator('#picker-play').boundingBox();
 await page.touchscreen.tap(playBox.x+playBox.width/2,playBox.y+playBox.height/2);
 check(await page.evaluate(g=>__BBC__.stats().gen===g,before),label+' unchosen PLAY remains silent');
 for(const item of inventory.filter(e=>/^#btn-p\d+$/.test(e.selector))){
  await page.locator(item.selector).tap();
  const n=Number(item.selector.replace('#btn-p',''));
  check(await page.evaluate(n=>__BBC__.pickerState().hour===n,n),label+' selects '+n);
 }
 await page.locator('#picker-play').tap();await page.waitForTimeout(50);
 check(await page.evaluate(()=>!__BBC__.pickerState().open&&__BBC__.pickerState().hour===null),label+' PLAY consumes chosen number');
 await page.locator('#btn-stop').tap();await page.locator('#btn-picker').tap();
 await page.locator('#picker-close').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().open===false),label+' picker close button closes');
 // the overlay covers the pad while open (modal by design): reopen and close again
 await page.locator('#btn-picker').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().open===true),label+' picker square reopens');
 await page.locator('#picker-stop').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().open===false),label+' picker closes via its reachable STOP');
 await page.locator('#btn-clock').tap();await page.locator('#picker-close').tap();
}
async function geometry(page,context){
 for(const [width,height] of [[390,844],[375,812],[1280,800],[844,390],[568,320],[320,568]]){
  await page.setViewportSize({width,height});const label=width+'x'+height;
  await page.evaluate(()=>{window.__operated=[];});
  const inventory=await census(page,label);
  for(const item of inventory){const r=item.rect;check(item.reachable&&r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height,label+' bounds and hit target '+item.selector,r);}
  const photo=await page.locator('.tower').evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);const k=s.objectFit==='cover'?Math.max(r.width/e.naturalWidth,r.height/e.naturalHeight):Math.min(r.width/e.naturalWidth,r.height/e.naturalHeight);return {verticalFraction:Math.min(1,r.height/(e.naturalHeight*k)),fit:s.objectFit};});
  check(photo.verticalFraction>.98,label+' whole tower vertical frame',photo);
  const credit=await page.locator('.credit').evaluate(e=>({text:e.textContent,clipped:e.scrollWidth>e.clientWidth||e.scrollHeight>e.clientHeight,rect:e.getBoundingClientRect().toJSON()}));
  check(!credit.clipped&&credit.text.includes('creativecommons.org/licenses/by/2.5/'),label+' complete license attribution',credit);
  if(width===390||width>height)await page.screenshot({path:path.join(OUT,'layout-'+label+'.png')});
  await operateSurface(page,context,label);
  await pickerGeometry(page,label,width,height);
  const operated=await page.evaluate(()=>__operated);
  const full=controls.filter(s=>s.screen===label||s.screen===label+' picker').flatMap(s=>s.controls);
  check(full.every(e=>operated.includes(e.selector)),label+' every inventoried control operated',{missing:full.filter(e=>!operated.includes(e.selector)).map(e=>e.selector),count:full.length});
 }
}
const INIT=()=>{
 window.__operated=[];
 for(const name of ['click','input'])document.addEventListener(name,event=>{const e=event.target.closest('button,input,a,select,textarea,[role=button],summary');if(e&&e.id)window.__operated.push('#'+e.id);},true);
 window.__audioLog=[];window.__vibration=[];
 navigator.vibrate=value=>{window.__vibration.push(value);return true;};
 const play=HTMLMediaElement.prototype.play;
 HTMLMediaElement.prototype.play=function(){
  const event=!this.muted?{file:this.src.split('/').pop().replace(/\.(m4a|ogg)$/,''),at:performance.now(),status:'pending'}:null;
  if(event)window.__audioLog.push(event);
  const promise=play.call(this);
  if(event&&promise)promise.then(()=>{event.status='playing';},error=>{event.status=error.name;});
  return promise;
 };
};
async function shift(page,h,m,s=1){await page.evaluate(([h,m,s])=>__BBC__.setClockOffset(new Date(2026,10,8,h,m,s).getTime()-Date.now()),[h,m,s]);}
async function resetLog(page){await page.locator('#btn-stop').tap();await page.evaluate(()=>{__audioLog.length=0;__vibration.length=0;});}
async function waitPlays(page,n){await page.waitForFunction(n=>__audioLog.filter(e=>e.status==='playing').length>=n,n,{timeout:90000});}
async function files(page){return page.evaluate(()=>__audioLog.filter(e=>e.status==='playing').map(e=>e.file));}
async function playback(page){
 await page.setViewportSize({width:390,height:844});await shift(page,13,7);
 await page.locator('#btn-q1').tap();await waitPlays(page,1);await page.waitForTimeout(220);
 check(await page.evaluate(()=>__BBC__.players.q15.currentTime>.1),':15 assembled asset really advances decoded audio');
 check(JSON.stringify(await files(page))===JSON.stringify(['q15']),':15 is one assembled change-1 asset');
 await resetLog(page);await page.locator('#btn-q2').tap();await waitPlays(page,1);await page.waitForTimeout(220);
 check(await page.evaluate(()=>__BBC__.players.q30.currentTime>.1),':30 recorded eight-note asset advances');
 await resetLog(page);await page.locator('#btn-q3').tap();await waitPlays(page,1);await page.waitForTimeout(220);
 check(await page.evaluate(()=>__BBC__.players.q45.currentTime>.1),':45 joined changes-4+5+1 asset advances');
 check(JSON.stringify(await files(page))===JSON.stringify(['q45']),':45 is one joined asset');
 await resetLog(page);await page.locator('#btn-q4').tap();await waitPlays(page,1);await page.waitForTimeout(220);
 check(JSON.stringify(await files(page))===JSON.stringify(['melody']),':00 button = melody ONLY');
 await page.waitForTimeout(21500);
 check((await files(page)).length===1,'no bong ever arrives from the :00 button');
 await shift(page,15,7);await resetLog(page);await page.locator('#btn-bongs').tap();await waitPlays(page,3);
 const bongs=await page.evaluate(()=>__audioLog.filter(e=>e.file==='bong'&&e.status==='playing'));
 check(bongs.length===3,'BONGY uses the current twelve-hour count');
 for(let i=1;i<bongs.length;i++)check(Math.abs((bongs[i].at-bongs[i-1].at)/1000-4.015)<.15,'real bong spacing '+i,bongs[i].at-bongs[i-1].at);
 check(await page.locator('#count').textContent()==='3','count reaches three');
 check(await page.locator('.tower').evaluate(e=>e.classList.contains('sway')),'tower feedback runs on bong');
 check(await page.evaluate(()=>__vibration.length===3&&__vibration.every(v=>v===140)),'vibration hook per bong');
 await resetLog(page);await page.locator('#btn-bongs').tap();await waitPlays(page,1);await page.locator('#btn-stop').tap();await page.waitForTimeout(4200);
 check((await files(page)).length===1,'STOP prevents the next real scheduled strike');
 check(await page.evaluate(()=>[__BBC__.players.melody,__BBC__.players.q30,__BBC__.players.q15,__BBC__.players.q45,...__BBC__.players.bongs].every(p=>p.paused)),'STOP pauses every actual media element');
 await page.emulateMedia({reducedMotion:'reduce'});await resetLog(page);await page.locator('#btn-bongs').tap();await waitPlays(page,1);
 check(await page.locator('.tower').evaluate(e=>getComputedStyle(e).animationName==='none'),'reduced motion disables tower sway');
 await page.locator('#btn-stop').tap();check(await page.locator('#btn-stop').evaluate(e=>getComputedStyle(e).animationName==='none'),'reduced motion disables STOP pulse');
 await page.emulateMedia({reducedMotion:'no-preference'});
}
async function pickerPlayback(page){
 await page.setViewportSize({width:390,height:844});await shift(page,13,7);
 await resetLog(page);
 await page.locator('#clock').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().open),'tapping the clock opens the picker');
 await page.locator('#btn-p12').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().hour===12),'chosen hour 12 is armed');
 check((await page.locator('#picker-play').textContent()).includes('12'),'play button shows the chosen hour');
 await page.locator('#picker-play').tap();
 check(await page.evaluate(()=>__BBC__.pickerState().open===false),'overlay closes after use');
 check(await page.evaluate(()=>__BBC__.pickerState().hour===null),'choice is consumed');
 await waitPlays(page,13);
 const log=await page.evaluate(()=>__audioLog.filter(e=>e.status==='playing'));
 check(JSON.stringify(log.map(e=>e.file))===JSON.stringify(['melody',...Array(12).fill('bong')]),
   'picker 12 = melody then EXACTLY twelve real bongs');
 for(let i=2;i<log.length;i++)check(Math.abs((log[i].at-log[i-1].at)/1000-4.015)<.15,'picker real bong spacing '+(i-1),log[i].at-log[i-1].at);
 check(await page.locator('#armed').textContent()==='🔔 12','armed badge shows the chosen hour');
 check(await page.locator('#armed').evaluate(e=>e.classList.contains('show')),'armed badge is visible while playing');
 check(await page.evaluate(()=>__vibration.length===12),'picker strikes vibrate like real bongs');
 await page.waitForTimeout(1500);
 check(await page.locator('#armed').evaluate(e=>e.classList.contains('show')),'badge survives first 1.5 seconds of the final real strike');
 await page.waitForTimeout(2800);
 check(await page.locator('#armed').evaluate(e=>!e.classList.contains('show')),'badge clears after the final decay');
 check((await files(page)).length===13,'no hidden thirteenth strike after picker 12');
 await page.locator('#btn-stop').tap();await page.waitForTimeout(300);
 check(await page.evaluate(()=>__BBC__.pickerState().open===false),'STOP closes the picker');
 check(await page.locator('#armed').evaluate(e=>!e.classList.contains('show')),'STOP clears the armed badge');
 const still=await page.evaluate(()=>__audioLog.filter(e=>e.status==='playing').length);
 check(still===13,'STOP does not restart a completed picker timeline');
 check(await page.evaluate(()=>__BBC__.stats().timers===0),'STOP killed every pending picker strike');
 await page.screenshot({path:path.join(OUT,'picker-after-stop.png')});
}
async function autoAndPersistence(page){
 await shift(page,13,7);await resetLog(page);await page.locator('#btn-quarter').tap();
 check(await page.evaluate(()=>localStorage.getItem('bbc-quarter')==='1'),'auto ON is persisted');
 for(const [h,m,file,q] of [[13,15,'q15',1],[13,30,'q30',2],[13,45,'q45',3],[14,0,'melody',0]]){
  await resetLog(page);await shift(page,h,m);await waitPlays(page,1);
  check((await files(page))[0]===file,'automatic mark '+m+' selects correct sequence');
  if(q===0){
   check(await page.evaluate(()=>__BBC__.stats().timers===3),'automatic hour includes two pending strikes at 14:00');
   await waitPlays(page,3);await page.waitForTimeout(4200);
   check(JSON.stringify(await files(page))===JSON.stringify(['melody','bong','bong']),'automatic hour really plays the clock count, not the last picker choice');
  }
 }
 await resetLog(page);await shift(page,14,33);await page.waitForTimeout(1100);check((await files(page)).length===0,'stale automatic quarter is not played');
 await page.locator('#btn-mute').tap();
 const saved=await page.evaluate(()=>localStorage.getItem('bbc-volume'));
 await page.addInitScript(()=>{const NativeDate=Date,start=NativeDate.now(),base=new NativeDate(2026,10,8,14,15,30).getTime();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[base+NativeDate.now()-start]));}static now(){return base+NativeDate.now()-start;}};});
 await page.reload();await page.waitForTimeout(1100);
 check(await page.evaluate(()=>__BBC__.scheduler.isEnabled()&&__BBC__.isQuarterOn()),'saved ON auto re-arms at boot');
 check(await page.evaluate(()=>__BBC__.stats().gen===0&&__BBC__.stats().timers===0&&__audioLog.length===0),'relaunch inside grace has no mid-mark blast');
 check(await page.locator('#volume').isDisabled(),'mute survives reload');
 check(await page.locator('#volume').inputValue()===saved,'volume survives reload');
 await page.locator('#btn-mute').tap();await page.waitForFunction(()=>__BBC__.isUnlocked());await resetLog(page);await shift(page,14,30);await waitPlays(page,1);
 check((await files(page))[0]==='q30','restored automatic mode sounds the next quarter after a gesture');
 await resetLog(page);await page.locator('#btn-quarter').tap();
}
async function offlineUpgrade(browser,base){
 revision='bc8bd69';const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addInitScript(INIT);
 const page=await context.newPage();await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 check(await page.evaluate(async()=>(await caches.keys()).includes('bigben-chimes-v1.1.0')),'real previous release cache installed');
 await page.evaluate(async()=>{await caches.open('unrelated-app-v1');window.__controllerChanged=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{window.__controllerChanged=true;});});revision=null;
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
 await page.waitForFunction(()=>window.__controllerChanged&&navigator.serviceWorker.controller.state==='activated');
 check(await page.evaluate(async()=>(await caches.keys()).includes('unrelated-app-v1')),'real upgrade preserves unrelated caches');
 const state=await page.evaluate(async()=>{const c=await caches.open('bigben-chimes-v1.2.0'),r=await c.match(new URL('./',location.href));return {keys:await caches.keys(),count:(await c.keys()).length,newUI:r&&(await r.text()).includes('btn-picker')};});
 console.log('activated upgrade',state);
 check(state.newUI,'upgraded release actually contains the new page',state);
 await page.reload();await page.waitForSelector('#btn-picker');
 const sw=await fs.readFile(path.join(ROOT,'sw.js'),'utf8');const assets=[...sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 const missing=await page.evaluate(async assets=>{const c=await caches.open('bigben-chimes-v1.2.0');const misses=[];for(const a of assets)if(!await c.match(new URL(a,location.href)))misses.push(a);return misses;},assets);
 check(!missing.length&&state.count===assets.length,'all release assets cached after upgrade',{count:assets.length,missing});
 const before=serverRequests.length;await page.reload();await page.waitForTimeout(150);
 check(serverRequests.slice(before).filter(p=>p!=='sw.js').length===0,'cached reload makes no asset refetches',serverRequests.slice(before));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('.tower').naturalWidth>0);
 await page.locator('#btn-q1').tap();await waitPlays(page,1);await page.waitForTimeout(220);
 check(await page.evaluate(()=>__BBC__.players.q15.currentTime>.1),'upgraded app and real audio work offline');
 check(JSON.stringify(await files(page))===JSON.stringify(['q15']),'offline :15 uses the new assembled asset');
 await offlineAssets(page,'AAC');
 const range=await page.evaluate(async()=>{const c=await caches.open('bigben-chimes-v1.2.0'),url=new URL('audio/q15.m4a',location.href),old=await c.match(url),body=await old.arrayBuffer(),headers=new Headers(old.headers);headers.delete('Content-Length');await c.put(url,new Response(body,{headers}));const r=await fetch(url,{headers:{Range:'bytes=0-15'}});return {status:r.status,bytes:(await r.arrayBuffer()).byteLength,range:r.headers.get('Content-Range')};});
 check(range.status===206&&range.bytes===16,'real offline Range works without Content-Length',range);
 await context.close();
}
async function firstAutoGesture(browser,base){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addInitScript(INIT);
 await context.addInitScript(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const muted=this.muted,promise=play.call(this);return muted?promise.then(()=>new Promise(resolve=>setTimeout(resolve,250))):promise;};});
 const page=await context.newPage();await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await shift(page,13,15,10);await page.locator('#btn-quarter').tap();await waitPlays(page,1);
 check(JSON.stringify(await files(page))===JSON.stringify(['q15']),'first auto tap waits for slow real media priming');
 await page.locator('#btn-stop').tap();await context.close();
}
async function pickerModalInteraction(page){
 await page.setViewportSize({width:390,height:844});await shift(page,15,7);await resetLog(page);
 await page.locator('#btn-bongs').tap();await waitPlays(page,1);
 await page.locator('#btn-picker').tap();await page.locator('#btn-p7').tap();
 await page.locator('#picker-stop').tap({timeout:2000});
 check(await page.evaluate(()=>!__BBC__.pickerState().open&&__BBC__.pickerState().hour===null),'real modal STOP closes and discards choice');
 check(await page.evaluate(()=>__BBC__.players.bongs.every(p=>p.paused)&&__BBC__.stats().timers===0),'real modal STOP pauses current chime and cancels later strikes');
 await page.waitForTimeout(4200);
 check((await files(page)).length===1,'no pending strike survives modal STOP');
 await page.locator('#btn-picker').tap();
 check(await page.evaluate(()=>document.activeElement.id==='picker-close'),'picker receives keyboard focus');
 await page.keyboard.press('Shift+Tab');
 check(await page.evaluate(()=>document.activeElement.id==='picker-play'),'picker traps backward focus');
 await page.keyboard.press('Tab');
 check(await page.evaluate(()=>document.activeElement.id==='picker-close'),'picker traps forward focus');
 await page.keyboard.press('Escape');
 check(await page.evaluate(()=>!__BBC__.pickerState().open&&document.activeElement.id==='btn-picker'),'Escape closes picker and restores opener focus');
 await page.locator('#btn-clock').focus();await page.keyboard.press('Enter');
 check(await page.evaluate(()=>__BBC__.pickerState().open),'clock works as a keyboard control');
 await page.keyboard.press('Escape');
}
async function coldFirstGestures(browser,base){
 for(const target of ['btn-q1','btn-q2','btn-q3','btn-q4','btn-bongs','picker-play','stop']){
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await c.addInitScript(INIT);
  await c.route('**/audio/**',async route=>{await new Promise(r=>setTimeout(r,900));await route.continue();});
  const page=await c.newPage();page.on('pageerror',e=>errors.push({name:'cold-gesture error',detail:String(e)}));
  await page.goto(base,{waitUntil:'domcontentloaded'});await shift(page,13,7);
  if(target==='picker-play'){await page.locator('#btn-picker').tap();await page.locator('#btn-p12').tap();}
  await page.locator('#'+(target==='stop'?'btn-q1':target)).tap();
  if(target==='stop'){
   await page.locator('#btn-stop').tap();await page.waitForTimeout(1400);
   check((await files(page)).length===0,'cold STOP cancels pending first-gesture playback');
   await page.locator('#btn-q1').tap();
  }
  await waitPlays(page,1);await page.waitForTimeout(180);
  const expected=({'btn-q1':'q15','btn-q2':'q30','btn-q3':'q45','btn-q4':'melody','btn-bongs':'bong','picker-play':'melody',stop:'q15'})[target];
  check(JSON.stringify(await files(page))===JSON.stringify([expected]),'cold delayed-media first tap '+target+' really plays once');
  check(await page.evaluate(()=>__BBC__.isUnlocked()),'cold delayed-media unlock completes '+target);
  await c.close();
 }
}
async function offlineAssets(page,codec){
 await shift(page,13,7);
 for(const [button,key]of [['btn-q1','q15'],['btn-q2','q30'],['btn-q3','q45'],['btn-q4','melody'],['btn-bongs','bongs']]){
  await resetLog(page);await page.locator('#'+button).tap();await waitPlays(page,1);await page.waitForTimeout(220);
  const inspect=()=>page.evaluate(key=>{const all=key==='bongs'?__BBC__.players.bongs:[__BBC__.players[key]];return {advances:all.some(p=>!p.paused&&p.currentTime>.1),players:all.map(p=>({paused:p.paused,time:p.currentTime,ready:p.readyState,error:p.error&&p.error.code})),errors:__BBC__.playErrors()};},key);
  let state=await inspect();
  if(!state.advances){
   console.log('offline playback readiness sample',codec,key,state);
   await page.waitForTimeout(1200);state=await inspect();
  }
  check(state.advances,codec+' actual offline decoded asset '+key+' advances',state);
 }
 await page.locator('#btn-stop').tap();
}
async function fallbackAndFile(browser,base){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addInitScript(INIT);
 await context.addInitScript(()=>{const original=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return type.includes('audio/mp4')?'':original.call(this,type);};});
 const page=await context.newPage();await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true);await page.reload();await page.locator('#btn-q1').tap();await waitPlays(page,1);await page.waitForTimeout(220);
 check(await page.evaluate(()=>__BBC__.players.q15.currentSrc.endsWith('.ogg')&&__BBC__.players.q15.currentTime>.1),'real Vorbis fallback plays offline');
 await offlineAssets(page,'Vorbis');
 await context.close();
 const local=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const file=await local.newPage();const failures=[];file.on('pageerror',e=>failures.push(String(e)));
 await file.goto('file://'+path.join(ROOT,'index.html'));
 const expectedButtons=(await fs.readFile(path.join(ROOT,'index.html'),'utf8')).match(/<button\b/g).length;
 check(await file.locator('button').count()===expectedButtons&&failures.length===0,'file URL boots without service-worker errors',failures);
 await local.close();
}
async function main(){
 assert.ok(OUT,'Set BBC_EVIDENCE_DIR or TMPDIR');await fs.mkdir(OUT,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(INIT);
  const page=await context.newPage();page.on('pageerror',e=>errors.push({name:'pageerror',detail:String(e)}));
  page.on('console',message=>{if(message.type()==='error')errors.push({name:'console error',detail:message.text()});});
  const external=[];context.on('request',request=>{if(!request.url().startsWith(base))external.push(request.url());});
  await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  if(process.argv.includes('--modal-only')){
   await pickerModalInteraction(page);
  }else if(!process.argv.includes('--upgrade-only')){
   await playback(page);
   await pickerPlayback(page);
   await pickerModalInteraction(page);
   await shift(page,13,7);await geometry(page,context);
   await page.setViewportSize({width:390,height:844});await autoAndPersistence(page);
  }
  check(external.length===0,'zero external runtime requests',external);
  await context.close();
  if(!process.argv.includes('--modal-only')){
   await offlineUpgrade(browser,base);
   await firstAutoGesture(browser,base);
   await coldFirstGestures(browser,base);
   await fallbackAndFile(browser,base);
  }
 }catch(error){
  errors.push({name:'runner failure',detail:String(error)});
  throw error;
 }finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(OUT,'golden_inventory.json'),JSON.stringify(controls,null,2));
  await fs.writeFile(path.join(OUT,'browser-results.json'),JSON.stringify({checks,errors},null,2));
 }
 console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,errors},null,2));
 assert.equal(errors.length,0,'browser regressions; see evidence JSON');
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
