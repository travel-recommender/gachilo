"use client";
import { Credit } from "@/components/gachiro";

/** 점이 커졌다 작아지는 차례 (ms). "가" → "치" → 다음 화면 */
export const DOT_GA_MS = 300;
export const DOT_CHI_MS = 1000;
/** 두 번째 점이 다 작아진 뒤 넘어간다 */
export const SPLASH_DONE_MS = 2000;

/** "가"·"치" 위 점. 차례가 오면 한 번 커졌다 작아지고 작은 채로 남는다 */
function Dotted({ ch, delay }: { ch: string; delay: number }) {
  return (
    <span className="relative inline-block">
      <span aria-hidden className="animate-pop absolute -top-[3px] left-1/2 -ml-[2.5px] h-[5px] w-[5px] rounded-full bg-white"
        style={{ animationDelay: `${delay}ms` }} />
      {ch}
    </span>
  );
}

/**
 * P0 — 처음 들어올 때 나오는 로딩 화면.
 * 방을 만드는 사람은 P1, 초대 링크로 들어온 사람은 P2로 넘어간다(넘기는 쪽은 화면마다 다르다).
 */
export function Splash() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-wine sm:min-h-[852px]">
      <div className="flex flex-1 items-center px-[29px]">
        {/* 피그마는 402px 폭에서 글자 상자 344px. 더 좁은 휴대폰(아이폰 16은 393px)에서는 같은 비율로 줄여 한 줄을 지킨다 */}
        <p className="whitespace-nowrap text-[min(33.75px,calc((100vw-58px)*0.0981))] font-extrabold leading-[1.25] text-white">
          환영합니다.
          <br />
          당신의 여행을 더 <Dotted ch="가" delay={DOT_GA_MS} /><Dotted ch="치" delay={DOT_CHI_MS} />있게
          <br />
          <br />
          Gachiro
        </p>
      </div>
      <Credit />
    </div>
  );
}
