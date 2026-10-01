import test from 'node:test';
import assert from 'node:assert/strict';
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
