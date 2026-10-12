// 저장·복원 회귀검사 — 방·자리는 탭에만 남고(화면을 닫으면 사라짐), 탭끼리 섞이지 않아야 한다.
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
  // 같은 탭에서 자리를 바꿨는데 초안이 이전 자리 것으로 남은 경우
  const local = new Memory(), tab = new Memory();
  save(joined("roomA", "a1", ["osaka_castle"]), local, tab);
  const draftA = tab.getItem(DRAFT_KEY)!;
  save(joined("roomB", "b1", ["glico"]), local, tab);
  tab.setItem(DRAFT_KEY, draftA);
  const s = restore(local, tab, INITIAL);
  assert.equal(s.room?.memberId, "b1");
  assert.equal(s.mine.memberId, "b1");
  assert.deepEqual(s.mine.longlist, [], "A의 초안이 B 자리로 넘어오면 안 된다");
});

// 10/12 결정 — 화면을 나갔다 들어오면 자리는 사라지고, 링크 + 이름 + PIN으로 다시 들어온다
test("화면을 닫았다 새로 열면(새 탭) 이전 방·자리를 이어받지 않는다", () => {
  const local = new Memory();
  save({ ...joined("room", "a1", ["osaka_castle"]), submitted: true }, local, new Memory());
  assert.equal(local.getItem(SESSION_KEY), null, "localStorage에 마지막 방을 남기지 않는다");
  const s = restore(local, new Memory(), INITIAL);
  assert.equal(s.room, null);
  assert.deepEqual(s.mine.longlist, []);
});

test("예전 판이 localStorage에 남긴 마지막 방은 읽지 않고 지운다", () => {
  const local = new Memory();
  local.setItem(SESSION_KEY, JSON.stringify({ room: joined("room", "a1", []).room }));
  const s = restore(local, new Memory(), INITIAL);
  assert.equal(s.room, null);
  assert.equal(local.getItem(SESSION_KEY), null);
});

test("같은 탭 새로고침은 이어지고, 초안만 없으면 서버 확인 전까지 제출을 막는다", () => {
  const local = new Memory(), tab = new Memory();
  save(joined("room", "a1", ["osaka_castle"]), local, tab);
  tab.removeItem(DRAFT_KEY);
  const s = restore(local, tab, INITIAL);
  assert.equal(s.room?.memberId, "a1");
  assert.equal(s.mine.memberId, "a1", "초안이 없어도 내 자리는 복원한 방의 memberId");
  assert.equal(s.inputMissing, true);
  assert.notEqual(submitBlocker(s), null, "기본값 제출을 막는다");
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
