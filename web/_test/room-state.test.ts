// 방 입장·입력 수정 회귀검사 — PR #32 리뷰에서 재현된 세 경로.
// 실행: cd web && node --test _test/room-state.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import { editedState, joinedState, restoredFromServer } from "../src/lib/room-state.ts";
import { submitBlocker } from "../src/lib/persist.ts";
import type { AppState } from "../src/components/store";

const DEFAULTS = { memberId: "me", longlist: [], picks: [], must: null, veto: null, budgetPerDay: 70000, stepLimit: 9000, activeMin: 480 };
const INITIAL = {
  nights: 3, room: null, startDate: "", members: [], mine: DEFAULTS, submitted: false,
  strategy: "fairness", allowPartial: true, customPlaces: [], inputMissing: false,
} as unknown as AppState;
const INFO = { roomId: "r1", startDate: "2026-10-10", endDate: "2026-10-12", members: [{ id: "a", name: "가" }, { id: "b", name: "나" }] };
const MEMBERS = [{ id: "a", name: "가", color: "#111" }, { id: "b", name: "나", color: "#222" }];
const FIVE = ["glico", "kuromon", "umeda_sky", "nakazaki", "ichiran"];
const SAVED = { longlist: FIVE, picks: FIVE, must: "glico", veto: null, budgetPerDay: 40000, stepLimit: 8000, activeMin: 420 };

function seated(memberId: string, patch: Partial<AppState> = {}): AppState {
  return {
    ...INITIAL,
    room: { roomId: "r1", memberId, token: `tok-${memberId}`, startDate: "2026-10-10", endDate: "2026-10-12", ownerToken: null, members: [] },
    mine: { ...DEFAULTS, memberId, longlist: FIVE, budgetPerDay: 40000 },
    ...patch,
  };
}
const join = (s: AppState, memberId: string, saved: typeof SAVED | null) =>
  joinedState(s, { roomId: "r1", memberId, token: `tok-${memberId}` }, INFO, MEMBERS, 2, saved, DEFAULTS);

test("같은 자리 링크로 다시 들어오면 이 기기의 입력(아직 안 낸 수정 포함)을 그대로 둔다", () => {
  const before = seated("a", { submitted: true });
  const after = join(before, "a", { ...SAVED, budgetPerDay: 99999 });
  assert.deepEqual(after.mine.longlist, FIVE);
  assert.equal(after.mine.budgetPerDay, 40000);
  assert.equal(after.submitted, true);
  assert.equal(submitBlocker(after), null);
});

test("같은 자리라도 이 기기에 입력이 없으면 서버의 본인 입력으로 채운다", () => {
  const after = join(seated("a", { mine: { ...DEFAULTS, memberId: "a" }, submitted: true, inputMissing: true }), "a", SAVED);
  assert.deepEqual(after.mine.picks, FIVE);
  assert.equal(after.mine.budgetPerDay, 40000);
  assert.equal(after.submitted, true);
  assert.equal(after.inputMissing, false);
});

test("다른 자리로 들어오면 이전 사람 입력을 버리고 그 자리의 서버 입력(없으면 기본값)을 쓴다", () => {
  const restored = join(seated("a"), "b", SAVED);
  assert.equal(restored.mine.memberId, "b");
  assert.equal(restored.mine.budgetPerDay, 40000);
  assert.equal(restored.submitted, true);
  const fresh = join(seated("a", { submitted: true }), "b", null);
  assert.deepEqual(fresh.mine, { ...DEFAULTS, memberId: "b" });
  assert.equal(fresh.submitted, false);
  assert.equal(fresh.room?.ownerToken, null);
});

test("방장이 자기 초대 링크를 같은 탭에서 열어도 방장 토큰은 남는다", () => {
  const owner = seated("a", { room: { ...seated("a").room!, ownerToken: "owner-tok" } });
  assert.equal(join(owner, "a", null).room?.ownerToken, "owner-tok");
});

test("새로고침 후 초안이 없으면 서버 입력으로 채우고, 서버에도 없으면 제출 막기를 푼다", () => {
  const missing = seated("a", { mine: { ...DEFAULTS, memberId: "a" }, submitted: true, inputMissing: true });
  const filled = restoredFromServer(missing, SAVED);
  assert.equal(filled.mine.budgetPerDay, 40000);
  assert.equal(submitBlocker(filled), null);
  const none = restoredFromServer(missing, null);
  assert.equal(none.inputMissing, false);
  assert.equal(none.submitted, false);
  // 조회에 실패하면 이 함수가 호출되지 않으므로 막힌 상태가 남는다
  assert.notEqual(submitBlocker(missing), null);
});

test("온라인 방에서는 직접 추가한 장소가 든 입력을 제출하지 않는다", () => {
  const custom = seated("a", { mine: { ...DEFAULTS, memberId: "a", longlist: [...FIVE.slice(0, 4), "custom_x_1"], picks: ["custom_x_1"] } });
  assert.match(submitBlocker(custom) ?? "", /직접 추가한 장소/);
  // 로컬 데모 모드에서는 그대로 쓴다
  assert.equal(submitBlocker({ ...custom, room: null }), null);
});

test("제출 뒤 1차 선택을 고치면 최종 대기가 아니라 다시 입력 단계가 된다", () => {
  const submitted = seated("a", { submitted: true });
  const edited = editedState(submitted, { longlist: [...FIVE.slice(0, 4), "dotonbori"] });
  assert.equal(edited.submitted, false); // waiting 화면의 online 판정이 false → /shortlist로 이어진다
  assert.equal(editedState(submitted, { budgetPerDay: 50000 }).submitted, false);
});
