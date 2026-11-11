// 방문 조건 안내 응답 검사·조회·안내 문구 (이슈 #6 RAG, 혜인)
// 실행: cd web && node --test _test/visit-conditions.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createVisitConditionsClient, decodeVisitConditions, hoursLine, liveLine, VisitConditionsError,
} from "../src/lib/visit-conditions.ts";

const request = { roomId: "r1", token: "t", placeIds: ["osaka_007"], dates: ["2026-11-17"] };
const ok = () => ({
  roomId: "r1", checkedOn: "2026-11-11", liveSource: "google_places", profilesCheckedAt: "2026-10-06",
  places: [{
    placeId: "osaka_007", name: "우메다 공중정원 전망대", reviewedThrough: "2026-11-30",
    sources: [{ url: "https://www.skybldg.co.jp/observatory/information/", label: "운영 정보", checkedAt: "2026-09-23" }],
    dates: [{ date: "2026-11-17", status: "confirmed", hours: [{ open: "09:30", close: "22:30", lastEntry: "22:00" }],
      costBasis: null, live: "confirmed", notices: [] }],
  }],
});

test("정상 응답은 그대로 받는다", () => {
  assert.equal(decodeVisitConditions(ok(), request).places[0].dates[0].status, "confirmed");
});

test("요청과 다른 방·장소·날짜, 알 수 없는 상태, http가 아닌 출처는 거절한다", () => {
  const bad = (patch: (v: ReturnType<typeof ok>) => void) => {
    const v = ok(); patch(v);
    assert.throws(() => decodeVisitConditions(v, request), VisitConditionsError);
  };
  bad((v) => { v.roomId = "other"; });
  bad((v) => { v.places[0].placeId = "osaka_001"; });
  bad((v) => { v.places[0].dates[0].date = "2026-11-18"; });
  bad((v) => { (v.places[0].dates[0] as { status: string }).status = "open"; });
  bad((v) => { (v.places[0].dates[0] as { live: string }).live = "ok"; });
  bad((v) => { v.places[0].sources[0].url = "javascript:alert(1)"; });
  bad((v) => { v.places[0].dates[0].hours[0].open = "9:30"; });
  bad((v) => { v.places = []; });
});

test("조회: 본문·인증을 보내고, 서버 오류 문구를 그대로 보여준다", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(ok()), { status: 200 });
  }) as unknown as typeof fetch;
  await createVisitConditionsClient("http://api/", fetcher)(request);
  assert.equal(sent[0].url, "http://api/rooms/r1/visit-conditions");
  assert.equal((sent[0].init.headers as Record<string, string>).Authorization, "Bearer t");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { placeIds: ["osaka_007"], dates: ["2026-11-17"] });

  const failing = (status: number, body: object) => createVisitConditionsClient("http://api",
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch)(request);
  await assert.rejects(failing(400, { error: "여행 기간 안의 날짜만 조회할 수 있습니다." }), /여행 기간 안의 날짜/);
  await assert.rejects(failing(403, {}), /초대 링크/);
  await assert.rejects(failing(503, { error: "방문 조건을 불러오지 못했습니다." }), /불러오지 못했습니다/);
  const offline = createVisitConditionsClient("http://api", (async () => { throw new TypeError("network"); }) as unknown as typeof fetch);
  await assert.rejects(offline(request), /서버 연결/);
});

test("안내 문구: 실시간 조회 상태마다 다르고, 조회 실패·불가는 공식 안내 확인을 권한다", () => {
  assert.equal(liveLine("confirmed", "2026-11-11"), "11월 11일 실시간 조회에서 영업이 확인됐어요.");
  assert.match(liveLine("failed", null), /공식 안내/);
  assert.match(liveLine("unavailable", null), /출처로 확인/);
  assert.match(liveLine("changed", null), /검토 자료와 달라요/);
  const day = ok().places[0].dates[0];
  assert.equal(hoursLine(day as never), "09:30~22:30 (입장 마감 22:00)");
  assert.equal(hoursLine({ ...day, hours: [] } as never), "영업시간 정보 없음");
});

test("출처 사이트 이름: www를 빼고 호스트만", async () => {
  const { sourceHost } = await import("../src/lib/visit-conditions.ts");
  assert.equal(sourceHost("https://www.skybldg.co.jp/observatory/information/"), "skybldg.co.jp");
  assert.equal(sourceHost("https://hepfive.jp/ferris/"), "hepfive.jp");
});
