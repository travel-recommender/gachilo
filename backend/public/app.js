import {createTripClient} from '/client.js';
import {planningResultReasonLines} from '/planning-reasons.mjs';
import {readInvite, inviteUrl, ownerUrl, saveSession, loadSession, clearSession} from '/session.mjs';
import {startStatusPolling} from '/polling.mjs';
const api=createTripClient(), $=id=>document.getElementById(id);
let session=null, room=null, catalog=[], busy=false, lastResult=null, stopPolling=()=>{}, lastRendered='';
let requestEpoch=0;
let storage=null;
try { storage=window.sessionStorage; } catch { /* This browser may disable session persistence. */ }
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
function option(value,text){const el=document.createElement('option');el.value=value;el.textContent=text;return el;}
function selected(){return [...document.querySelectorAll('#place-options input:checked')].map(e=>e.value);}
function updateMust(){const old=$('must').value;$('must').replaceChildren(option('','선택 안 함'));for(const id of selected())$('must').append(option(id,catalog.find(p=>p.id===id).name));if(selected().includes(old))$('must').value=old;}
function restoreInput(input){
  document.querySelectorAll('#place-options input').forEach(e=>e.checked=!!input?.picks.includes(e.value));
  updateMust();$('must').value=input?.must??'';$('veto').value=input?.veto??'';
  $('budget').value=input?.budgetPerDay??75000;$('steps').value=input?.stepLimit??10000;$('active').value=input?.activeMin??480;
}
function updateButtons(){
  $('calculate').disabled=busy||session?.role!=='owner'||lastResult?.submittedCount!==lastResult?.memberCount||!lastResult;
}
function render(data){lastResult=data;$('progress').textContent=`${data.submittedCount} / ${data.memberCount}명 입력 저장 · ${data.status==='draft'?'실제 장소 초안 저장':data.status==='ready'?'일정 저장 완료':data.status==='collecting'?'입력을 기다리고 있어요':'계산 준비 완료'}`;updateButtons();const target=$('result');target.replaceChildren();if(!data.result)return;const summary=document.createElement('p');summary.textContent=data.result.summary;target.append(summary);if(data.planning){const note=document.createElement('p');note.textContent=`검증 상태: ${data.planning.status==='model_checks_passed'?'모델 검사 통과':'추가 확인 필요'} · 배치 ${data.planning.scheduled_count}곳 / 미배치 ${data.planning.unplaced_count}곳 · 환율 ${data.planning.exchange_rate.krw_per_jpy}원/엔 (${data.planning.exchange_rate.as_of}, ${data.planning.exchange_rate.source})`;target.append(note);const list=document.createElement('ul');for(const text of planningResultReasonLines(data.planning)){const li=document.createElement('li');li.textContent=text;list.append(li);}target.append(list);}for(const day of data.result.days){const article=document.createElement('article');article.className='day';const title=document.createElement('h3');title.textContent=day.date;const list=document.createElement('ol');for(const id of day.placeIds){const li=document.createElement('li');li.textContent=catalog.find(p=>p.id===id)?.name??id;list.append(li);}if(!day.placeIds.length){const p=document.createElement('p');p.textContent='배치된 장소가 없습니다.';article.append(p);}article.prepend(title);article.append(list);target.append(article);}}

function acceptResult(data){
  if(lastResult && data.revision<lastResult.revision)return;
  const key=JSON.stringify(data);
  if(key!==lastRendered){lastRendered=key;render(data);}
  $('connection').textContent='연결됨 · 참여 현황을 자동으로 확인하고 있어요.';
}
function forget(){try{if(storage)clearSession(storage);}catch{/* Memory access still works. */}}
function disconnect(){
  stopPolling();session=null;room=null;lastResult=null;lastRendered='';forget();
  $('invite-links').replaceChildren();$('result').replaceChildren();restoreInput(null);
  for(const id of ['session-section','invite-section','input-section','result-section'])$(id).hidden=true;
  $('create-section').hidden=false;
}
function handleFailure(e){
  if(e.status===403||e.status===404){disconnect();message('접속 정보를 확인할 수 없어요. 본인의 초대 링크를 다시 열어 주세요.',true);}
  else message(e.name==='AbortError'?'연결이 지연되고 있어요. 잠시 후 다시 시도해 주세요.':e.message,true);
}
async function act(fn){
  if(busy)return;busy=true;requestEpoch++;document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await fn();}catch(e){handleFailure(e);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);updateButtons();}
}
async function loadCatalog(dataset){
  const real=dataset==='osaka_review_150';
  const data=real?await api.realPlaces():await api.places();
  catalog=data.places.map(p=>real?{id:p.place_id,name:p.name_ko,review:p.planning.review_required}:p);
  $('place-options').replaceChildren();$('veto').replaceChildren(option('','선택 안 함'));
  for(const p of catalog){const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=p.id;input.addEventListener('change',updateMust);label.append(input,document.createTextNode(p.name));$('place-options').append(label);$('veto').append(option(p.id,p.name));}
  $('strategy').replaceChildren(...(real?[option('average','선택 수 우선')]:[option('fairness','공정성'),option('average','평균 만족'),option('least_misery','최소 불만')]));
  $('catalog-status').textContent=`${catalog.length}곳 · ${real?'운영·가격 확인 상태에 따라 일정 배치를 보류할 수 있습니다.':'시연 데이터입니다.'}`;
}
async function connect(credentials){
  stopPolling();
  const info=await api.room(credentials.roomId,credentials.token);
  const mine=credentials.role==='owner'?null:await api.ownSubmission(credentials.roomId,credentials.memberId,credentials.token);
  await loadCatalog(info.dataset??'prototype_demo_36');
  session=credentials;room=info;lastResult=null;lastRendered='';
  let remembered=false;
  try{if(storage){saveSession(storage,session);remembered=true;}}catch{/* Explain below instead of losing access. */}
  $('create-section').hidden=true;$('session-section').hidden=false;$('result-section').hidden=false;
  $('input-section').hidden=session.role==='owner';$('owner-controls').hidden=session.role!=='owner';
  $('room-status').textContent=`${room.startDate} ~ ${room.endDate} · ${room.members.length}명의 여행`;
  $('identity').textContent=session.role==='owner'?'방장 화면 · 입력 현황과 계산을 관리해요.':`${room.members.find(m=>m.id===session.memberId)?.name??'참여자'}님의 입력 화면`;
  restoreInput(mine?.submission);
  message(remembered?(mine?.submission?'저장된 나의 입력을 복원했어요.':'여행방에 연결했어요.'):'이 브라우저에서는 재접속 정보를 저장할 수 없어요. 새로고침 전에 초대 링크를 보관해 주세요.',!remembered);
  const current=session;
  stopPolling=startStatusPolling({
    read:async signal=>{const epoch=requestEpoch;const data=await api.getResult(current.roomId,current.token,signal);return {epoch,data};},
    active:()=>!document.hidden&&!busy&&navigator.onLine,
    onData:packet=>{if(session===current&&!busy&&packet.epoch===requestEpoch)acceptResult(packet.data);},
    onError:e=>{if(session!==current)return;if(e.status===403||e.status===404)handleFailure(e);else $('connection').textContent='연결이 끊겼어요. 자동으로 다시 연결을 시도하고 있어요.';},
  });
  acceptResult(await api.getResult(session.roomId,session.token));
}
function showInvites(created){
  $('invite-links').replaceChildren();
  const entries=[{name:'방장 재접속',href:ownerUrl(location.origin,created.roomId,created.ownerToken)},...created.members.map(member=>({name:member.name,href:inviteUrl(location.origin,created.roomId,member)}))];
  for(const entry of entries){
    const card=document.createElement('div');card.className='invite-card';
    const link=document.createElement('a');link.href=entry.href;link.textContent=entry.name==='방장 재접속'?'방장 재접속 링크 · 본인만 보관':`${entry.name}님의 입력 화면 열기`;link.target='_blank';link.rel='noopener noreferrer';
    const input=document.createElement('input');input.readOnly=true;input.value=link.href;input.setAttribute('aria-label',`${entry.name} 초대 링크`);
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`${entry.name} 링크 복사`;
    button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(input.value);message(entry.name==='방장 재접속'?'방장 재접속 링크는 다른 사람에게 보내지 말고 본인만 보관하세요.':'이 참여자에게만 링크를 보내 주세요.');}catch{input.focus();input.select();message('선택된 링크를 복사해 주세요.');}});
    card.append(link,input,button);$('invite-links').append(card);
  }
  $('invite-section').hidden=false;
}
const today=new Date();today.setDate(today.getDate()+7);$('start').value=today.toISOString().slice(0,10);$('end').value=$('start').value;
$('room-form').addEventListener('submit',e=>{e.preventDefault();act(async()=>{
  const created=await api.createRoom({dataset:$('dataset').value,startDate:$('start').value,endDate:$('end').value,memberNames:$('names').value.split(',').map(n=>n.trim())});
  // Preserve the issued links even if a later catalogue request fails.
  showInvites(created);
  const owner={version:1,role:'owner',roomId:created.roomId,token:created.ownerToken};
  try{if(storage)saveSession(storage,owner);}catch{}
  await connect(owner);
});});
$('input-form').addEventListener('submit',e=>{e.preventDefault();act(async()=>{
  await api.submit(session.roomId,session.memberId,session.token,{longlist:selected(),picks:selected(),must:$('must').value||null,veto:$('veto').value||null,budgetPerDay:Number($('budget').value),stepLimit:Number($('steps').value),activeMin:Number($('active').value)});
  acceptResult(await api.getResult(session.roomId,session.token));message('나의 입력을 저장했어요. 다른 참여자의 입력을 기다려 주세요.');
});});
$('calculate').addEventListener('click',()=>act(async()=>{message('일정을 계산하고 있어요.');acceptResult(await api.calculate(session.roomId,session.token,$('strategy').value));message(room.dataset==='osaka_review_150'?'실제 장소 초안을 저장했어요.':'함께 볼 일정을 저장했어요.');}));
$('refresh').addEventListener('click',()=>act(async()=>acceptResult(await api.getResult(session.roomId,session.token))));
$('leave').addEventListener('click',()=>{disconnect();message('이 탭의 접속 정보를 지웠어요. 다시 들어오려면 초대 링크를 열어 주세요.');});
window.addEventListener('offline',()=>{if(session)$('connection').textContent='오프라인이에요. 인터넷 연결이 돌아오면 다시 확인합니다.';});
window.addEventListener('pagehide',()=>stopPolling());
window.addEventListener('pageshow',e=>{if(e.persisted&&session)act(()=>connect(session));});
// Read the credential once and remove it from the address before any API request.
let incoming=null, inviteError=null;
try{incoming=readInvite(location.href);}catch(e){inviteError=e;}
finally{if(incoming||inviteError)history.replaceState(null,'',location.pathname);}
if(incoming||inviteError)forget();
if(inviteError)message(inviteError.message,true);
else{
  const previous=incoming??(storage?loadSession(storage):null);
  if(previous)await act(()=>connect(previous));
  else try{await loadCatalog($('dataset').value);}catch(e){handleFailure(e);}
}
