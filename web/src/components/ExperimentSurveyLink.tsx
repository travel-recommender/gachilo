"use client";
import {useTrip} from './store';
import {EXPERIMENT_MODE} from '@/lib/experiment';
import experimentConfig from '../../../config/experiment.json';
export const SURVEY_URL=experimentConfig.surveyUrl;
/** Answers belong only in the team's Google Form; no extra in-app survey or tracking. */
export function ExperimentSurveyLink() {
 const {state}=useTrip();
 if(!EXPERIMENT_MODE || !state.room)return null;
 const code=state.members.find(m=>m.id===state.room?.memberId)?.name;
 return <aside className="m-5 rounded-xl border border-line bg-white p-4 text-sm leading-relaxed">
   <p>일정 A·B·C를 모두 살펴본 뒤 혜인님이 만든 설문에 답해 주세요.</p>
   {code&&<p className="mt-2 font-semibold">내 참가자 번호: {code}</p>}
   <a className="mt-3 inline-block font-bold text-wine underline" href={SURVEY_URL} target="_blank" rel="noopener noreferrer">Google 설문 열기</a>
   <p className="mt-2 text-xs text-mute">다른 사람과 상의하지 않고 작성해 주세요. 설문 제출 여부는 Google 설문에서 확인합니다.</p>
 </aside>;
}
