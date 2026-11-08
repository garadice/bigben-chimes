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
 const inventory=await page.locator('button,input,a,select,textarea,[role=button],summary').evaluateAll(nodes=>nodes.map(e=>({selector:'#'+e.id,label:e.getAttribute('aria-label')||e.textContent,tag:e.tagName,disabled:e.disabled||false,rect:e.getBoundingClientRect().toJSON()})));
 controls.push({screen:label,count:inventory.length,controls:inventory});return inventory;
}
async function geometry(page){
 for(const [width,height] of [[390,844],[375,812],[1280,800],[844,390],[568,320],[320,568]]){
  await page.setViewportSize({width,height});const label=width+'x'+height;
  const inventory=await census(page,label);
  for(const item of inventory){const r=item.rect;check(r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height,label+' bounds '+item.selector,r);}
  const photo=await page.locator('.tower').evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);const k=s.objectFit==='cover'?Math.max(r.width/e.naturalWidth,r.height/e.naturalHeight):Math.min(r.width/e.naturalWidth,r.height/e.naturalHeight);return {verticalFraction:Math.min(1,r.height/(e.naturalHeight*k)),fit:s.objectFit};});
  check(photo.verticalFraction>.98,label+' whole tower vertical frame',photo);
  const credit=await page.locator('.credit').evaluate(e=>({text:e.textContent,clipped:e.scrollWidth>e.clientWidth||e.scrollHeight>e.clientHeight,rect:e.getBoundingClientRect().toJSON()}));
  check(!credit.clipped&&credit.text.includes('creativecommons.org/licenses/by/2.5/'),label+' complete license attribution',credit);
  if(width===390||width>height)await page.screenshot({path:path.join(OUT,'layout-'+label+'.png')});
 }
}
async function main(){
 assert.ok(OUT,'Set BBC_EVIDENCE_DIR or TMPDIR');await fs.mkdir(OUT,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push({name:'pageerror',detail:String(e)}));
  await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await geometry(page);
  await context.close();
 }finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(OUT,'golden_inventory.json'),JSON.stringify(controls,null,2));
  await fs.writeFile(path.join(OUT,'browser-results.json'),JSON.stringify({checks,errors},null,2));
 }
 console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,errors},null,2));
 assert.equal(errors.length,0,'browser regressions; see evidence JSON');
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
