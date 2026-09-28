import { findMember } from "./places";
import { kmToSteps, tripBudget } from "./consensus";
import type { ConsensusResult, DayPlan, Submission } from "./types";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/**
 * 규칙이 산출한 근거를 문장으로 만든다.
 * 실제 서비스에서는 이 구조화된 근거를 LLM에 넘겨 자연스러운 문장으로 다듬는다.
 * 여기서는 LLM 없이도 검증 가능하도록 규칙 기반으로 생성한다.
 */
export function explainResult(res: ConsensusResult, subs: Submission[], days: number): string[] {
  const lines: string[] = [];
  const budget = Math.min(...subs.map((s) => tripBudget(s, days)));

  lines.push(
    `${subs.length}명이 고른 ${new Set(subs.flatMap((s) => s.picks)).size}곳 중 ` +
      `${res.core.length}곳을 다 같이 가는 일정으로, ${res.options.length}곳을 원하는 사람만 가는 일정으로 나눴어요.`
  );

  lines.push(
    `예산은 가장 빠듯한 분에게 맞춰 1인 ${won(budget)}을 상한으로 뒀고, ` +
      `다 같이 가는 일정의 비용은 ${won(res.metrics.perPersonCost)}이에요.`
  );

  const keptAll = res.metrics.mustKeptRate === 1;
  if (keptAll) {
    lines.push(`${subs.length}분이 꼭 가고 싶다고 한 곳은 모두 지켰습니다.`);
  } else {
    const missed = res.satisfaction.filter((s) => !s.mustKept).length;
    lines.push(`꼭 가고 싶다고 한 곳 중 ${missed}곳은 조건이 맞지 않아 넣지 못했어요.`);
  }

  const byBudget = res.excluded.filter((e) => e.excluded === "budget").length;
  const byVeto = res.excluded.filter((e) => e.excluded === "veto").length;
  const byTime = res.excluded.filter((e) => e.excluded === "time").length;
  const parts: string[] = [];
  if (byBudget) parts.push(`예산 때문에 ${byBudget}곳`);
  if (byTime) parts.push(`일정이 꽉 차서 ${byTime}곳`);
  if (byVeto) parts.push(`빼달라는 요청이 있어 ${byVeto}곳`);
  if (parts.length) lines.push(`${parts.join(", ")}은 이번 일정에서 뺐어요.`);

  const ai = res.selections.filter((s) => s.aiAdded);
  if (ai.length) {
    lines.push(
      `아무도 고르지 않았지만 모두의 조건에 맞는 ${ai.length}곳(${ai.map((s) => s.place.name).join(", ")})은 ` +
        `AI가 채웠어요. 남은 자리와 남은 예산 안에서만 넣었어요.`
    );
  }

  if (res.options.length) {
    lines.push(
      `일부만 가는 ${res.options.length}곳은 자유시간에 배치했어요. ` +
        `모두가 모든 곳에 함께 갈 필요는 없으니까요.`
    );
  }

  return lines;
}

/** 개별 장소가 왜 들어갔는지 */
export function explainPlace(res: ConsensusResult, placeId: string): string | null {
  const sel = res.selections.find((s) => s.place.id === placeId);
  if (sel) {
    if (sel.aiAdded) return "아무도 고르지 않았지만 모두의 취향·예산에 맞아 AI가 넣은 곳이에요.";
    if (sel.mustOf) return `${findMember(sel.mustOf).name}님이 꼭 가고 싶다고 한 곳이에요.`;
    if (sel.tier === "core") return `${sel.votes}명이 골랐고 모두의 예산 안에 들어와요.`;
    return `${sel.participants.length}명만 조건이 맞아서 자유시간 일정으로 넣었어요.`;
  }
  const ex = res.excluded.find((s) => s.place.id === placeId);
  if (!ex) return null;
  const reason = {
    veto: "빼달라는 요청이 있었어요.",
    budget: "모두의 예산 안에 넣기 어려웠어요.",
    time: "일정이 꽉 차서 넣지 못했어요.",
    walk: "걷는 거리가 너무 늘어나서 뺐어요.",
  }[ex.excluded ?? "time"];
  return reason;
}

/** 일정이 무리인지 알려준다 */
export function explainDay(plan: DayPlan, walkLimit: number): string {
  const hours = Math.floor(plan.totalMoveMin / 60);
  const mins = plan.totalMoveMin % 60;
  const moveText = hours ? `${hours}시간 ${mins}분` : `${mins}분`;
  const base = `오늘은 ${plan.walkKm}km를 걷고, 이동에 약 ${moveText}이 걸려요. (대중교통 포함 총 ${plan.totalKm}km)`;
  if (plan.walkKm > walkLimit) {
    return `${base} 걷는 거리가 가장 부담되는 분의 한계 ${kmToSteps(walkLimit).toLocaleString("ko-KR")}보를 넘어요. 일부를 자유 선택으로 돌리는 게 좋겠어요.`;
  }
  return `${base} 걷는 거리가 모두의 한계 안에 들어와요.`;
}
