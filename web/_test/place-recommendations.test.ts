import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendationClient, recommendationEvidence, RecommendationError } from "../src/lib/place-recommendations.ts";
import type { RecommendationRequest } from "../src/lib/place-recommendations.ts";

const request: RecommendationRequest = { roomId: "room/a", memberId: "m/b", token: "personal", dataset: "osaka_review_150", placeId: "source", excludePlaceIds: ["source", "already-added"] };
const item = { placeId: "new", name: "장소", category: "카페", area: "난바", coPickCount: 2, reason: "co_pick" as const };
const response = () => ({ dataset: request.dataset, sourcePlaceId: "source", limit: 3, countUnit: "room_member_list", generatedAt: "2026-11-03T05:00:00Z", eligibility: "at_least_one_trip_date", recommendations: [{ ...item }] });

test("own member token, unsaved exclusions and limit 3 are sent without mutating the list", async () => {
  let sent: RequestInit | undefined;
  const api = createRecommendationClient("http://test.invalid/", async (url, init) => {
    assert.equal(url, "http://test.invalid/rooms/room%2Fa/recommendations/m%2Fb");
    sent = init; return Response.json(response());
  });
  assert.equal((await api(request)).recommendations[0].coPickCount, 2);
  assert.deepEqual(JSON.parse(sent!.body as string), { placeId: "source", excludePlaceIds: ["source", "already-added"], limit: 3 });
  assert.equal((sent!.headers as Record<string, string>).Authorization, "Bearer personal");
  assert.equal(sent!.cache, "no-store");
});

test("numeric evidence uses saved list units; fallbacks never invent person counts", () => {
  assert.equal(recommendationEvidence(item), "2개 참여 목록에서 함께 담김");
  assert.equal(recommendationEvidence({ ...item, coPickCount: 1000 }), "1,000개 참여 목록에서 함께 담김");
  for (const [reason, label] of [["same_area_category", "같은 지역 · 같은 카테고리"], ["same_area", "같은 지역"], ["same_category", "같은 카테고리"]] as const)
    assert.equal(recommendationEvidence({ ...item, coPickCount: 0, reason }), label);
});

test("counts and reasons must agree and counts must be nonnegative safe integers", async () => {
  for (const coPickCount of [-1, 0, 1.5, "2", true, null, Number.MAX_SAFE_INTEGER + 1]) {
    const api = createRecommendationClient("", async () => Response.json({ ...response(), recommendations: [{ ...item, coPickCount }] }));
    await assert.rejects(api(request), RecommendationError);
  }
  for (const reason of ["same_area", "same_area_category", "same_category", "nearby", null]) {
    await assert.rejects(createRecommendationClient("", async () => Response.json({ ...response(), recommendations: [{ ...item, reason }] }))(request), RecommendationError);
  }
});

test("wrong source, unit, mode, eligibility, date, duplicate and over-limit responses fail closed", async () => {
  for (const change of [{ sourcePlaceId: "other" }, { countUnit: "people" }, { dataset: "prototype_demo_36" },
    { eligibility: "demo_unverified" }, { generatedAt: "invalid" }, { limit: 10 },
    { recommendations: [item, item] }, { recommendations: [{ ...item, placeId: "source" }] },
    { recommendations: [1, 2, 3, 4].map(i => ({ ...item, placeId: String(i) })) }]) {
    await assert.rejects(createRecommendationClient("", async () => Response.json({ ...response(), ...change }))(request), RecommendationError);
  }
});

test("empty and same-area fallback responses are valid, including explicitly unverified demo mode", async () => {
  for (const recommendations of [[], [{ ...item, coPickCount: 0, reason: "same_area" }]]) {
    const api = createRecommendationClient("", async () => Response.json({ ...response(), recommendations }));
    assert.equal((await api(request)).recommendations.length, recommendations.length);
  }
  const api = createRecommendationClient("", async () => Response.json({ ...response(), dataset: "prototype_demo_36", eligibility: "demo_unverified" }));
  assert.equal((await api({ ...request, dataset: "prototype_demo_36" })).eligibility, "demo_unverified");
});

test("old backend, revoked token and non-JSON errors do not fabricate recommendations", async () => {
  for (const status of [403, 404, 503]) {
    await assert.rejects(createRecommendationClient("", async () => new Response("<html>error</html>", { status }))(request), e => e instanceof RecommendationError && e.status === status);
  }
  for (const body of ["", "null", "[]", "<html>OK</html>"])
    await assert.rejects(createRecommendationClient("", async () => new Response(body))(request), RecommendationError);
});

test("cancel before dispatch and while reading a response body preserves cancellation", async () => {
  const controller = new AbortController(); controller.abort(new Error("session changed"));
  let sent = false;
  await assert.rejects(createRecommendationClient("", async () => { sent = true; return Response.json(response()); })(request, controller.signal), e => e === controller.signal.reason);
  assert.equal(sent, false);
  const next = new AbortController();
  let started!: () => void; const reading = new Promise<void>(r => { started = r; });
  const api = createRecommendationClient("", async (_url, init) => new Response(new ReadableStream({
    start(stream) { init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason), { once: true }); },
    pull() { started(); },
  }, { highWaterMark: 0 })));
  const done = assert.rejects(api(request, next.signal), e => e === next.signal.reason);
  await reading; next.abort(new Error("source changed")); await done;
});

test("response body stalls time out without retrying the request", async () => {
  let calls = 0;
  const api = createRecommendationClient("", async (_url, init) => {
    calls++; return new Response(new ReadableStream({
      start(stream) { init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason), { once: true }); },
    }));
  }, 10);
  await assert.rejects(api(request), e => e instanceof RecommendationError && /늦어지고/.test(e.message));
  assert.equal(calls, 1);
});
