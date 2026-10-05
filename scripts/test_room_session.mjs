import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {readInvite, inviteUrl, ownerUrl, saveSession, loadSession, clearSession} from '../backend/public/session.mjs';
import {startStatusPolling} from '../backend/public/polling.mjs';
const member = {id: 'member_12345', submissionToken: 'secret_123456789'};
const roomId = 'room_123456';
function storage() { const values = new Map(); return {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k)}; }

test('share links keep credentials out of request path and query, and round-trip the identity', () => {
  const href = inviteUrl('https://trip.example', roomId, member), url = new URL(href);
  assert.equal(url.pathname, '/join'); assert.equal(url.search, '');
  assert.equal(url.hash.includes('secret_'), true);
  assert.deepEqual(readInvite(href), {version:1, roomId, memberId:member.id, token:member.submissionToken});
});
test('legacy frontend query links remain readable, malformed credentials cannot fall back to another session', () => {
  assert.equal(readInvite('https://trip.example/join?room=room_123456&m=member_12345&t=secret_123456789').memberId, member.id);
  assert.throws(() => readInvite('https://trip.example/join?room=wrong'));
  assert.throws(() => readInvite('https://trip.example/join#room=room_123456&m=member_12345&t=%3Cscript%3E'));
  assert.equal(readInvite('https://trip.example/'), null);
});
test('refresh restores one identity per tab and logout clears it', () => {
  const a=storage(), b=storage();
  const s={version:1, roomId, memberId:member.id, token:member.submissionToken};
  saveSession(a,{...s,ownerToken:'DO_NOT_PERSIST',members:[member]});
  assert.deepEqual(loadSession(a), s); assert.equal(loadSession(b), null);
  clearSession(a); assert.equal(loadSession(a), null);
});
test('host session never stores the issued list of member credentials', () => {
  const tab=storage(); saveSession(tab,{version:1,role:'owner',roomId,token:'owner_123456789',members:[member]});
  assert.deepEqual(Object.keys(loadSession(tab)).sort(), ['role','roomId','token','version']);
});
test('host can reopen its private recovery link in a new tab without member credentials', () => {
  const href=ownerUrl('https://trip.example',roomId,'owner_123456789');
  assert.equal(new URL(href).search,'');
  assert.deepEqual(readInvite(href),{version:1,role:'owner',roomId,token:'owner_123456789'});
  assert.throws(()=>readInvite('https://trip.example/join#role=owner&room=room_123456&t=bad'));
});
test('corrupted or unavailable storage does not masquerade as an authenticated session', () => {
  assert.equal(loadSession({getItem:()=>'{'}), null);
  assert.equal(loadSession({getItem:()=>JSON.stringify({version:1,token:'secret_123456'})}), null);
  assert.equal(loadSession({getItem:()=>{throw new Error('disabled');}}), null);
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function timers(){let queued;return {schedule:(fn,delay)=>{queued={fn,delay};return 1;},cancel:()=>{queued=null;},next:()=>queued};}

test('status is delivered immediately, does not overlap, and late results are ignored after logout', async () => {
  const clock=timers(), seen=[];let resolveRead, calls=0;
  const stop=startStatusPolling({read:()=>{calls++;return new Promise(r=>resolveRead=r);},onData:d=>seen.push(d),onError:assert.fail,...clock});
  assert.equal(calls,1); assert.equal(clock.next(),undefined);
  stop();resolveRead({submittedCount:3});await flush();
  assert.deepEqual(seen,[]); assert.equal(clock.next(),null);
});
test('connection errors retry with backoff, recovery resets delay, and inactive tabs skip requests', async () => {
  const clock=timers(), seen=[], errors=[];let fail=true, active=true, calls=0;
  const stop=startStatusPolling({read:async()=>{calls++;if(fail)throw new Error('offline');return {submittedCount:2};},
    onData:d=>seen.push(d),onError:e=>errors.push(e.message),active:()=>active,...clock});
  await flush();assert.equal(clock.next().delay,6000);assert.deepEqual(errors,['offline']);
  fail=false;await clock.next().fn();assert.equal(clock.next().delay,3000);assert.equal(seen[0].submittedCount,2);
  active=false;await clock.next().fn();assert.equal(calls,2);stop();
});

// Run the real page startup with an isolated DOM and API boundary. Only imports
// are replaced with dependencies; invite parsing, connection and failure handling
// execute from app.js so persisting too late fails the reload regression.
const appSource=readFileSync(new URL('../backend/public/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
async function openPage(tabStorage,href,{failAt,failWith}={}) {
  const elements=new Map(), calls=[];
  function element(){return {value:'',textContent:'',hidden:true,children:[],listeners:{},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},
    addEventListener(type,fn){this.listeners[type]=fn;}};}
  const byId=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  byId('create-section').hidden=false;byId('dataset').value='osaka_review_150';
  const document={hidden:false,getElementById:byId,createElement:element,createTextNode:text=>({textContent:text}),
    querySelectorAll(selector){
      const inputs=byId('place-options').children.flatMap(label=>label.children).filter(node=>node.type==='checkbox');
      if(selector==='#place-options input:checked')return inputs.filter(node=>node.checked);
      return selector==='#place-options input'?inputs:[];
    }};
  const location=new URL(href);
  const data={room:{roomId,startDate:'2026-10-10',endDate:'2026-10-10',dataset:'osaka_review_150',members:[{id:member.id,name:'참여자'}]},
    ownSubmission:{submission:{picks:['place_01'],must:'place_01',veto:null,budgetPerDay:81000,stepLimit:9000,activeMin:420}},
    realPlaces:{places:[{place_id:'place_01',name_ko:'검사 장소',planning:{review_required:[]}}]},
    getResult:{submittedCount:1,memberCount:1,status:'waiting',revision:1,result:null}};
  const api=Object.fromEntries(Object.keys(data).map(key=>[key,async(...args)=>{
    calls.push({method:key,args});if(key===failAt)throw failWith;return data[key];
  }]));
  await runInNewContext(`(async()=>{${appSource}\n})()`,{
    document,location,history:{replaceState(_state,_title,path){location.href=new URL(path,location).href;}},
    window:{sessionStorage:tabStorage,addEventListener(){}},navigator:{onLine:true},
    createTripClient:()=>api,readInvite,inviteUrl,ownerUrl,saveSession,loadSession,clearSession,
    startStatusPolling:()=>()=>{},planningResultReasonLines:()=>[],
  });
  return {elements,location,calls};
}

test('first invite timeout, offline or 503 at any connection stage survives a reload',async()=>{
  for(const failAt of ['room','ownSubmission','realPlaces'])for(const failWith of [
    Object.assign(new Error('timeout'),{name:'AbortError'}),new TypeError('Failed to fetch'),Object.assign(new Error('temporary'),{status:503}),
  ]){
    const tab=storage(), href=inviteUrl('https://trip.example',roomId,member);
    const first=await openPage(tab,href,{failAt,failWith});
    assert.equal(first.location.hash,'');assert.equal(first.location.search,'');
    assert.deepEqual(loadSession(tab),readInvite(href));
    const reloaded=await openPage(tab,first.location.href);
    assert.equal(reloaded.elements.get('create-section').hidden,true);
    assert.equal(reloaded.elements.get('input-section').hidden,false);
    assert.equal(reloaded.elements.get('budget').value,81000);
    assert.deepEqual(reloaded.calls.find(c=>c.method==='ownSubmission').args,[roomId,member.id,member.submissionToken]);
  }
});
test('first owner recovery failure preserves the owner identity for reload',async()=>{
  const tab=storage(),href=ownerUrl('https://trip.example',roomId,'owner_123456789');
  const first=await openPage(tab,href,{failAt:'realPlaces',failWith:new Error('offline')});
  assert.deepEqual(loadSession(tab),readInvite(href));
  const reloaded=await openPage(tab,first.location.href);
  assert.equal(reloaded.elements.get('owner-controls').hidden,false);
  assert.equal(reloaded.elements.get('input-section').hidden,true);
  assert.equal(reloaded.calls.some(c=>c.method==='ownSubmission'),false);
});
test('403 or 404 during first connection clears the rejected identity',async()=>{
  for(const status of [403,404])for(const failAt of ['room','ownSubmission','realPlaces']){
    const tab=storage();
    const first=await openPage(tab,inviteUrl('https://trip.example',roomId,member),{failAt,failWith:Object.assign(new Error('rejected'),{status})});
    assert.equal(loadSession(tab),null);assert.equal(first.location.hash,'');
    assert.equal(first.elements.get('create-section').hidden,false);
  }
});
test('a failing new invite replaces the previously stored participant rather than restoring it',async()=>{
  const tab=storage();saveSession(tab,{version:1,roomId:'previous_room',memberId:'previous_member',token:'previous_secret'});
  const first=await openPage(tab,inviteUrl('https://trip.example',roomId,member),{failAt:'room',failWith:new Error('offline')});
  assert.equal(loadSession(tab).memberId,member.id);
  const reloaded=await openPage(tab,first.location.href);
  assert.equal(reloaded.calls[0].args[0],roomId);
});
test('a malformed new invite removes old credentials and makes no authenticated request',async()=>{
  const tab=storage();saveSession(tab,{version:1,roomId,memberId:member.id,token:member.submissionToken});
  const first=await openPage(tab,'https://trip.example/join#room=bad');
  assert.equal(loadSession(tab),null);assert.equal(first.location.hash,'');assert.deepEqual(first.calls,[]);
});
test('disabled session storage still permits a live connection and explains the reload limitation',async()=>{
  const disabled={getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');},removeItem(){throw new Error('disabled');}};
  const page=await openPage(disabled,inviteUrl('https://trip.example',roomId,member));
  assert.equal(page.elements.get('create-section').hidden,true);
  assert.match(page.elements.get('message').textContent,/재접속 정보를 저장할 수 없어요/);
});
