"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useTrip} from './store';
import {EXPERIMENT_MODE,type Letter} from '@/lib/experiment';
import {experimentResponse} from '@/lib/experiment-api';
/** A display event means this screen was visible, not that the person read it. */
export function ExperimentSurveyLink({letter,revision}:{letter?:Letter;revision?:number}) {
 const {state}=useTrip();const room=state.room;const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!EXPERIMENT_MODE||!room||!letter)return;
  let active=true,started=false;
  const visible=async()=>{if(document.visibilityState!=='visible'||started)return;started=true;setError('');try{const s=await experimentResponse(room);if(!active)return;if(!s.pre)throw Error('사전 질문을 먼저 저장해 주세요.');if(s.revision!==revision)throw Error('일정이 바뀌었어요. 화면을 새로고침해 주세요.');await experimentResponse(room,{kind:'view',letter,revision:s.revision,candidateHash:s.candidateHash});}catch(e){if(active)setError(e instanceof Error?e.message:'표시 기록을 저장하지 못했어요.');}};
  void visible();document.addEventListener('visibilitychange',visible);return()=>{active=false;document.removeEventListener('visibilitychange',visible);};
 },[room?.roomId,room?.memberId,room?.token,letter,revision,attempt]);
 if(!EXPERIMENT_MODE)return null;
 return <aside className="m-5 rounded-xl border border-line bg-white p-4 text-sm"><Link className="font-bold text-wine underline" href={letter?`/experiment/?c=${letter}`:'/experiment/'}>{letter?`일정 ${letter} 평가하기`:'실험 설문 · 저장 상태'}</Link>{error&&<p role="alert" className="mt-2">{error} <button className="underline" onClick={()=>setAttempt(n=>n+1)}>기록 다시 저장</button></p>}</aside>;
}
