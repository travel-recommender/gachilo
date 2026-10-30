// 실제 장소 150곳 → 화면 Place 변환과 목록 교체.
// 실행: cd web && node --test _test/catalog.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlace, type ApiCatalogPlace } from "../src/lib/catalog.ts";

const GLICO: ApiCatalogPlace = {
  place_id: "osaka_001", name: "道頓堀グリコサイン", name_ko: "도톤보리 글리코 사인", category: "명소",
  area: "大阪市中央区", address: "大阪府大阪市中央区道頓堀1丁目10-4", latitude: 34.668926, longitude: 135.5010546,
  stay_min: 120, bag_load: 0, covered: null, cost_krw: null,
};

test("한국어 이름·분류·주소·좌표를 쓰고, 모르는 비용은 0이다", () => {
  const p = toPlace(GLICO);
  assert.equal(p.id, "osaka_001");
  assert.equal(p.name, "도톤보리 글리코 사인");
  assert.equal(p.category, "landmark");
  assert.equal(p.address, "大阪府大阪市中央区道頓堀1丁目10-4");
  assert.deepEqual([p.lat, p.lng, p.cost, p.stayMin, p.covered], [34.668926, 135.5010546, 0, 120, false]);
});

test("한국어 이름이 없으면 원래 이름, 모르는 분류는 명소다", () => {
  const p = toPlace({ ...GLICO, name_ko: null, category: "기타" });
  assert.equal(p.name, "道頓堀グリコサイン");
  assert.equal(p.category, "landmark");
  assert.equal(toPlace({ ...GLICO, category: "식사" }).category, "food");
});

test("150곳 목록을 넣으면 데모 36곳 대신 그 목록만 찾는다", async () => {
  const { allPlaces, findPlace, setCatalog } = await import("../src/lib/places.ts");
  assert.ok(findPlace("glico"));
  setCatalog([toPlace(GLICO)]);
  try {
    assert.equal(findPlace("glico"), undefined);
    assert.equal(findPlace("osaka_001")?.name, "도톤보리 글리코 사인");
    assert.deepEqual(allPlaces().map((p) => p.id), ["osaka_001"]);
  } finally {
    setCatalog(null);
  }
  assert.ok(findPlace("glico"));
});
