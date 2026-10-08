"use client";
import { Credit } from "@/components/gachiro";

/** "가"·"치" 위 점. 둘이 번갈아 커졌다 작아진다 */
function Dotted({ ch, delay }: { ch: string; delay: string }) {
  return (
    <span className="relative inline-block">
      <span aria-hidden className="animate-breathe absolute -top-[3px] left-1/2 -ml-[2.5px] h-[5px] w-[5px] rounded-full bg-white"
        style={{ animationDelay: delay }} />
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
        <p className="text-[33.75px] font-extrabold leading-[1.25] text-white">
          환영합니다.
          <br />
          당신의 여행을 더 <Dotted ch="가" delay="0s" /><Dotted ch="치" delay="0.55s" />있게
          <br />
          <br />
          Gachiro
        </p>
      </div>
      <Credit />
    </div>
  );
}
