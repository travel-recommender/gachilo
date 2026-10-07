// 저장·복원 회귀검사 — 여러 탭이 localStorage를 공유할 때 입력과 자리가 섞이지 않아야 한다.
// 실행: cd web && node --test _test/persist.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_KEY, SESSION_KEY, restore, save, submitBlocker, type KV } from "../src/lib/persist.ts";
import type { AppState } from "../src/components/store";

class Memory implements KV {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

const MINE = { memberId: "me", longlist: [], picks: [], must: null, veto: null, budgetPerDay: 70000, stepLimit: 9000, activeMin: 480 };
const INITIAL = {
  nights: 3, room: null, startDate: "", members: [], mine: MINE, submitted: false,
  strategy: "fairness", allowPartial: true, customPlaces: [], inputMissing: false,
} as unknown as AppState;

function joined(roomId: string, memberId: string, longlist: string[]): AppState {
  return {
    ...INITIAL,
    startDate: "2026-10-10",
    room: { roomId, memberId, token: `tok-${roomId}-${memberId}`, startDate: "2026-10-10", endDate: "2026-10-11", ownerToken: null, members: [] },
    mine: { ...MINE, memberId, longlist },
  };
}

test("다른 방 두 탭 + 새로고침 — 각 탭이 자기 자리와 자기 초안을 되찾는다", () => {
  const local = new Memory(), tabA = new Memory(), tabB = new Memory();
  save(joined("roomA", "a1", ["osaka_castle"]), local, tabA);
  save(joined("roomB", "b1", ["glico"]), local, tabB); // B가 나중에 저장해 localStorage는 B

  const a = restore(local, tabA, INITIAL);
  assert.equal(a.room?.roomId, "roomA");
  assert.equal(a.room?.token, "tok-roomA-a1");
  assert.deepEqual(a.mine.longlist, ["osaka_castle"]);
  assert.equal(submitBlocker(a), null);

  const b = restore(local, tabB, INITIAL);
  assert.equal(b.room?.roomId, "roomB");
  assert.deepEqual(b.mine.longlist, ["glico"]);
});

test("같은 방 다른 참여자 두 탭 + 새로고침 — 토큰과 초안이 섞이지 않는다", () => {
  const local = new Memory(), tabA = new Memory(), tabB = new Memory();
  save(joined("room", "a1", ["osaka_castle"]), local, tabA);
  save(joined("room", "b1", ["glico"]), local, tabB);
  const a = restore(local, tabA, INITIAL);
  assert.equal(a.room?.memberId, "a1");
  assert.equal(a.mine.memberId, "a1");
  assert.deepEqual(a.mine.longlist, ["osaka_castle"]);
});

test("초안의 주인이 복원한 방과 다르면 초안을 버린다", () => {
  // 탭 세션이 사라지고 초안만 남은 경우 — localStorage의 다른 자리(B)로 복원된다
  const local = new Memory(), tab = new Memory();
  save(joined("roomA", "a1", ["osaka_castle"]), local, tab);
  save(joined("roomB", "b1", ["glico"]), local, new Memory());
  tab.removeItem(SESSION_KEY);
  const s = restore(local, tab, INITIAL);
  assert.equal(s.room?.memberId, "b1");
  assert.equal(s.mine.memberId, "b1");
  assert.deepEqual(s.mine.longlist, [], "A의 초안이 B 자리로 넘어오면 안 된다");
});

test("초안 없는 재접속 — 제출한 입력을 기본값으로 덮어쓰지 않는다", () => {
  const local = new Memory();
  save({ ...joined("room", "a1", ["osaka_castle"]), submitted: true }, local, new Memory());

  const fresh = new Memory(); // 새 탭: sessionStorage 비어 있음
  const s = restore(local, fresh, INITIAL);
  assert.equal(s.room?.memberId, "a1");
  assert.equal(s.mine.memberId, "a1", "초안이 없어도 내 자리는 복원한 방의 memberId");
  assert.equal(s.inputMissing, true);
  assert.notEqual(submitBlocker(s), null, "기본값 제출을 막는다");

  // 한 번 더 새로고침해도 기본값 초안을 진짜 초안으로 착각하지 않는다
  save(s, local, fresh);
  const again = restore(local, fresh, INITIAL);
  assert.equal(again.inputMissing, true);
  assert.notEqual(submitBlocker(again), null);
});

test("초안 없는 재접속은 submitted=false여도 서버 확인 전까지 막는다", () => {
  // 제출 뒤 고치면 submitted가 풀리므로, submitted만으로는 서버에 입력이 없다고 말할 수 없다
  const local = new Memory();
  save(joined("room", "a1", ["osaka_castle"]), local, new Memory());
  const s = restore(local, new Memory(), INITIAL);
  assert.equal(s.inputMissing, true);
  assert.notEqual(submitBlocker(s), null);
});

test("데모 모드(방 없음) 초안은 그대로 복원된다", () => {
  const local = new Memory(), tab = new Memory();
  save({ ...INITIAL, mine: { ...MINE, longlist: ["kuromon"] } }, local, tab);
  const s = restore(local, tab, INITIAL);
  assert.equal(s.room, null);
  assert.deepEqual(s.mine.longlist, ["kuromon"]);
});

test("이전 판 저장값은 읽지 않고 지운다", () => {
  const local = new Memory(), tab = new Memory();
  local.setItem("gatiga-v3", JSON.stringify({ mine: { ...MINE, longlist: ["old"] } }));
  local.setItem("gatiga-v4", "{}");
  tab.setItem("gatiga-v4-draft", "{}");
  const s = restore(local, tab, INITIAL);
  assert.deepEqual(s.mine.longlist, []);
  assert.equal(local.getItem("gatiga-v3"), null);
  assert.equal(local.getItem("gatiga-v4"), null);
  assert.equal(tab.getItem("gatiga-v4-draft"), null);
  assert.equal(tab.getItem(DRAFT_KEY), null);
});
