import { Body, Notice, Screen } from "@/components/ui";

/** 실험 모드에서 닫아 둔 화면 */
export function ExperimentClosed() {
  return (
    <Screen>
      <Body>
        <Notice tone="info">실험 중에는 이 화면을 쓰지 않아요. 진행자 안내에 따라 여행방 화면으로 돌아가 주세요.</Notice>
      </Body>
    </Screen>
  );
}
