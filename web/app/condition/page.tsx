"use client";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { Body, Card, Footer, Notice, Screen, SectionTitle, Slider, TopBar, won } from "@/components/ui";

/** 걸음 수 단계 — 숫자만 주면 감이 안 오므로 말도 같이 준다 */
const STEP_LABEL = [
  "5,000보 · 많이 못 걸어요",
  "8,000보 · 적당히",
  "12,000보 · 꽤 걸어도 괜찮아요",
  "18,000보 · 하루 종일 걸어도 돼요",
];
const STEP_VALUE = [5000, 8000, 12000, 18000];

export default function Condition() {
  const router = useRouter();
  const { state, set, setMine } = useTrip();
  const { budgetPerDay, stepLimit } = state.mine;
  const days = state.nights + 1;
  const idx = STEP_VALUE.indexOf(stepLimit);
  const stepIdx = idx >= 0 ? idx : 1;

  const submit = () => {
    set({ submitted: true });
    router.push("/result");
  };

  return (
    <Screen>
      <TopBar title="내 조건 입력" subtitle="이것도 다른 사람에게 안 보여요" back="/shortlist" />
      <Body>
        <Notice tone="info">
          예산과 체력은 <b>말하기 어려운 정보</b>라 비공개로 받아요.
          결과에는 반영되지만 누가 얼마를 적었는지는 끝까지 공개되지 않아요.
        </Notice>

        <Card>
          <SectionTitle hint="항공·숙박 제외">하루에 쓸 수 있는 돈</SectionTitle>
          <div className="mt-2 text-[26px] font-bold tabular-nums">{won(budgetPerDay)}</div>
          <p className="mb-2 text-[11.5px] text-ink-500">
            현지에서 쓸 활동비와 식비예요. {days}일이면 {won(budgetPerDay * days)}이에요.
          </p>
          <Slider value={budgetPerDay} min={20000} max={150000} step={5000}
            onChange={(v) => setMine({ budgetPerDay: v })} left="2만원" right="15만원" />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
            그룹 예산은 가장 빠듯한 분에게 맞춰요. 그래야 아무도 무리하지 않아요.
          </p>
        </Card>

        <Card>
          <SectionTitle>하루에 얼마나 걸을 수 있나요</SectionTitle>
          <div className="mt-2 text-[18px] font-bold">{STEP_LABEL[stepIdx]}</div>
          <div className="mt-2">
            <Slider value={stepIdx} min={0} max={3} step={1}
              onChange={(i) => setMine({ stepLimit: STEP_VALUE[i] })} left="조금만" right="많이" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
            지도 좌표로 실제 걷는 거리를 계산해 걸음 수로 바꿔요(보폭 70cm 기준).
            한계를 넘으면 일부를 자유 선택으로 돌려요.
          </p>
        </Card>

        <Card>
          <SectionTitle>하루 활동 시간</SectionTitle>
          <div className="mt-2 text-[18px] font-bold">{Math.round(state.mine.activeMin / 60)}시간</div>
          <div className="mt-2">
            <Slider value={state.mine.activeMin} min={300} max={600} step={60}
              onChange={(v) => setMine({ activeMin: v })} left="5시간" right="10시간" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
            숙소에서 나와 돌아올 때까지, 이동을 포함한 시간이에요.
          </p>
        </Card>
      </Body>
      <Footer>
        <button onClick={submit} className="btn-primary w-full">입력 마치고 결과 보기</button>
      </Footer>
    </Screen>
  );
}
