'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {roomApi, type ApiRoom, type ApiPlace, type ApiResult} from '@/lib/room-api';
import {Body, Card, Screen, TopBar, Notice} from '@/components/ui';

export default function ServerCheck() {
  const [places,setPlaces]=useState<ApiPlace[]>([]),[room,setRoom]=useState<ApiRoom|null>(null),[result,setResult]=useState<ApiResult|null>(null);
  const [names,setNames]=useState('조은, 윤진, 혜인'),[start,setStart]=useState(''),[end,setEnd]=useState('');
  const [memberId,setMemberId]=useState(''),[picks,setPicks]=useState<string[]>([]),[must,setMust]=useState(''),[veto,setVeto]=useState('');
  const [budget,setBudget]=useState(75000),[steps,setSteps]=useState(10000),[active,setActive]=useState(480),[strategy,setStrategy]=useState('fairness');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{roomApi.places().then(x=>setPlaces(x.places)).catch(()=>setMessage('서버에 연결되지 않았어요. 로컬 서버 실행 상태를 확인해 주세요.'));const d=new Date();d.setDate(d.getDate()+7);const text=d.toISOString().slice(0,10);setStart(text);setEnd(text);},[]);
  function resetInput(id:string){setMemberId(id);setPicks([]);setMust('');setVeto('');setBudget(75000);setSteps(10000);setActive(480);}
  async function action(fn:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('처리 중이에요.');try{await fn();}catch(e){setMessage(e instanceof Error?e.message:'요청 실패');}finally{setBusy(false);}}
  const control='mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
  return <Screen><TopBar title="서버 연결 확인" back="/"/><Body>
    <Notice tone="info">회의용 연결 확인 화면이에요. 같은 화면에서 참여자를 바꿔 입력합니다. 기존 시연용 36곳으로 계산하며 실제 여행 일정과 개인정보를 넣지 마세요.</Notice>
    <p role="status" aria-live="polite" className="text-sm text-brand-700">{message}</p>
    <Card><h2 className="font-bold">1. 여행방 만들기</h2><form onSubmit={e=>{e.preventDefault();void action(async()=>{const r=await roomApi.create(start,end,names.split(',').map(n=>n.trim()));setRoom(r);setResult(null);resetInput(r.members[0].id);setMessage('여행방을 서버에 저장했어요.');});}}>
      <label className="block mt-3">시작일<input aria-label="시작일" className={control} type="date" required value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label className="block mt-3">종료일<input aria-label="종료일" className={control} type="date" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label className="block mt-3">참여자 이름 (쉼표 구분)<input className={control} required value={names} onChange={e=>setNames(e.target.value)}/></label>
      <button disabled={busy||!places.length} className="btn-primary w-full mt-3">여행방 만들기</button>
    </form></Card>
    {room&&<><Card><h2 className="font-bold">2. 참여자별 선택 저장</h2><form onSubmit={e=>{e.preventDefault();void action(async()=>{const member=room.members.find(m=>m.id===memberId)!;await roomApi.submit(room,member,{longlist:picks,picks,must:must||null,veto:veto||null,budgetPerDay:budget,stepLimit:steps,activeMin:active});setResult(await roomApi.result(room));setMessage(`${member.name}님의 입력을 서버에 저장했어요.`);});}}>
      <label className="block mt-3">참여자<select className={control} value={memberId} onChange={e=>resetInput(e.target.value)}>{room.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <fieldset className="mt-3"><legend>가고 싶은 장소 (최대 30곳)</legend><div className="max-h-56 overflow-auto rounded-lg border p-2">{places.map(p=><label key={p.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={picks.includes(p.id)} onChange={()=>{const next=picks.includes(p.id)?picks.filter(id=>id!==p.id):[...picks,p.id];setPicks(next);if(!next.includes(must))setMust('');}}/>{p.name}</label>)}</div></fieldset>
      <label className="block mt-3">꼭 가고 싶은 곳<select className={control} value={must} onChange={e=>setMust(e.target.value)}><option value="">선택 안 함</option>{places.filter(p=>picks.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block mt-3">제외할 곳<select className={control} value={veto} onChange={e=>setVeto(e.target.value)}><option value="">선택 안 함</option>{places.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block mt-3">하루 예산(원)<input type="number" required min={0} max={10000000} className={control} value={budget} onChange={e=>setBudget(Number(e.target.value))}/></label>
      <label className="block mt-3">하루 걸음 수<input type="number" required min={0} max={100000} className={control} value={steps} onChange={e=>setSteps(Number(e.target.value))}/></label>
      <label className="block mt-3">활동 시간(분)<input type="number" required min={1} max={1440} className={control} value={active} onChange={e=>setActive(Number(e.target.value))}/></label>
      <button disabled={busy||picks.length>30} className="btn-primary w-full mt-3">이 참여자의 선택 저장</button>
    </form></Card><Card><h2 className="font-bold">3. 계산 결과 확인</h2><p className="my-3 text-sm">{result?.submittedCount??0}/{room.members.length}명 입력 저장</p>
      <select aria-label="추천 기준" className={control} value={strategy} onChange={e=>setStrategy(e.target.value)}><option value="fairness">공정성</option><option value="average">평균 만족</option><option value="least_misery">최소 불만</option></select>
      <button className="btn-primary w-full mt-3" disabled={busy||result?.submittedCount!==room.members.length} onClick={()=>void action(async()=>{setResult(await roomApi.calculate(room,strategy));setMessage('계산한 결과를 서버에 저장했어요.');})}>일정 계산하기</button>
      <button className="btn w-full bg-surface mt-2" disabled={busy} onClick={()=>void action(async()=>{setResult(await roomApi.result(room));setMessage('저장된 결과를 불러왔어요.');})}>저장된 결과 다시 조회</button>
      {result?.result?<><p className="mt-4 text-xs text-ink-500">{result.result.summary}</p>{result.result.days.map(day=><div className="border-t mt-4 pt-3" key={day.date}><h3 className="font-bold">{day.date}</h3><ol className="list-decimal pl-5 text-sm">{day.placeIds.map(id=><li key={id}>{places.find(p=>p.id===id)?.name??id}</li>)}</ol>{!day.placeIds.length&&<p>배치된 장소가 없어요.</p>}</div>)}</>:<p className="text-sm mt-3">{result?.status==='awaiting_result'?'입력이 모였어요. 계산을 시작할 수 있어요.':'전원의 입력을 기다리고 있어요.'}</p>}
    </Card></>}
    <p className="text-xs text-ink-500">새로고침하면 접근 정보가 초기화돼요. 입력 수정 후에는 다시 계산하세요. 실제 초대·참여 인증은 6주차 연결 항목입니다.</p>
    <Link href="/" className="text-sm underline">기존 데모로 돌아가기</Link>
  </Body></Screen>;
}
