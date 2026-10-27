// Run from web/: node --test _test/*.test.ts _test/search.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import ts from "typescript";

// Use the TypeScript compiler already required by the web project.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  for (const candidate of [request, request + ".ts"]) {
    try { return originalResolve.call(this, candidate, ...args); } catch {}
  }
  return originalResolve.call(this, request, ...args);
};
Module._extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText,
  filename,
);
const require = Module.createRequire(import.meta.url);
const { searchPlaces } = require("../src/lib/search.ts");
const { PLACES } = require("../src/lib/places.ts");
const byId = (id) => PLACES.find((place) => place.id === id);

const variants = [
  ["usj", ["유니버설", "유니버셜", "USJ", "Universal Studios Japan"]],
  ["glico", ["글리고", "글리코상", "Glico sign"]],
  ["tsutenkaku", ["쓰텐카쿠", "츠텐카쿠", "Tsutenkaku"]],
  ["kuromon", ["쿠로몬시장", "Kuromon Market"]],
  ["shitennoji", ["시텐노우지", "Shitennoji"]],
  ["kaiyukan", ["카이유칸", "해유관", "Kaiyukan"]],
  ["tempozan", ["텐포잔대관람차", "Tempozan Ferris Wheel"]],
  ["tennoji_zoo", ["덴노지동물원", "Tennoji Zoo"]],
  ["namba_parks", ["남바파크스", "Namba Parks"]],
  ["umeda_sky", ["우메다 공중정원", "Umeda Sky Building"]],
  ["grand_front", ["그랜드프론트오사카", "Grand Front Osaka"]],
  ["shinsaibashi", ["신사이바시수지상점가", "Shinsaibashi-suji Shopping Street"]],
  ["sumiyoshi", ["스미요시 대사", "Sumiyoshi Taisha"]],
  ["tsuruhashi", ["쓰루하시 코리아타운", "Tsuruhashi Koreatown"]],
  ["harukas", ["하루카스300", "Harukas 300"]],
  ["amemura", ["아메무라", "Amerikamura"]],
];
for (const [id, queries] of variants) {
  test(`${id}: alternate names return the original place once`, () => {
    for (const query of queries) {
      const matches = searchPlaces(PLACES, query);
      assert.equal(matches[0], byId(id), query);
      assert.equal(matches.filter((place) => place.id === id).length, 1, query);
    }
  });
}

test("spacing, punctuation, Latin case and full-width Latin are interchangeable", () => {
  for (const query of ["u.s.j", " ＵＳＪ ", "universal-studios JAPAN", "유니버셜스튜디오재팬".normalize("NFD")]) {
    assert.equal(searchPlaces(PLACES, query)[0], byId("usj"), query);
  }
});
test("Korean initials still match names and aliases", () => {
  assert.ok(searchPlaces(PLACES, "ㄱㄹㅋ").includes(byId("glico")));
  assert.ok(searchPlaces(PLACES, "ㅇㅅㅋㅅ").includes(byId("osaka_castle")));
});
test("matching is independent of catalog ID and accepts the previous display name", () => {
  const imported = { ...byId("tsutenkaku"), id: "osaka_draft_test", name: "츠텐카쿠" };
  assert.deepEqual(searchPlaces([imported], "쓰텐카쿠"), [imported]);
  assert.equal(imported.name, "츠텐카쿠");
});
test("a partial name does not assign a facility's aliases to another place", () => {
  const shop = { ...byId("usj"), id: "separate-shop", name: "유니버셜 스튜디오 재팬 기념품점", area: "별도 지역", blurb: "별도 시설" };
  assert.deepEqual(searchPlaces([shop], "USJ"), []);
});
test("ordinary names, area and category searches keep working", () => {
  assert.equal(searchPlaces(PLACES, "한큐백화점")[0], byId("hankyu"));
  assert.ok(searchPlaces(PLACES, "우메다", 50).includes(byId("hankyu")));
  assert.ok(searchPlaces(PLACES, "쇼핑", 50).includes(byId("hankyu")));
});
test("empty and punctuation-only input produce no results", () => {
  for (const query of ["", "  ", "・-."]) assert.deepEqual(searchPlaces(PLACES, query), []);
});
test("the result limit is preserved and catalog objects are not modified", () => {
  const before = JSON.stringify(PLACES);
  assert.equal(searchPlaces(PLACES, "우메다", 2).length, 2);
  searchPlaces(PLACES, "글리고");
  assert.equal(JSON.stringify(PLACES), before);
});


test("the real catalog Umeda observatory name accepts its building aliases", () => {
  const catalog = JSON.parse(fs.readFileSync(new URL("../../data/week5/live_20260923/processed/osaka_places_150_fresh.json", import.meta.url), "utf8"));
  const source = catalog.places.find((record) => record.place.place_id === "osaka_007").place;
  assert.equal(source.name_ko, "우메다 공중정원 전망대");
  const imported = { ...byId("umeda_sky"), id: source.place_id, name: source.name_ko };
  for (const query of ["우메다 스카이빌딩", "Umeda Sky Building", "우메다 공중정원 전망대"]) {
    assert.deepEqual(searchPlaces([imported], query), [imported]);
  }
  assert.equal(imported.id, "osaka_007");
  assert.equal(imported.name, source.name_ko);
});


test("expanded final catalog searches all 205 records, including original Japanese and English names", () => {
  const {toPlace}=require("../src/lib/catalog.ts");
  const rows=Array.from({length:205},(_,i)=>toPlace({place_id:`branch_${i}`,name:`GU JAPAN ${i}`,name_ko:`지유 지점 ${i}`,category:"쇼핑",area:null,address:null,latitude:null,longitude:null,stay_min:null,bag_load:null,covered:null,cost_krw:null}));
  assert.equal(searchPlaces(rows,"GU",rows.length).length,205);
  assert.equal(searchPlaces(rows,"지유 지점 204",rows.length)[0].id,"branch_204");
  const cultural={...rows[0],category:"culture",categoryLabel:"복합문화",searchNames:["天王寺公園"]};
  assert.equal(searchPlaces([cultural],"복합문화")[0].id,cultural.id);
  assert.equal(searchPlaces([cultural],"天王寺公園")[0].id,cultural.id);
});


test("published branch data finds the missing Ichiran branches in the actual UI search", () => {
  const {toPlace}=require("../src/lib/catalog.ts");
  const data=JSON.parse(fs.readFileSync(new URL("../../data/final/osaka_catalog_20261026.json",import.meta.url),"utf8"));
  const places=data.places.map(r=>toPlace({...r.place,cost_krw:null}));
  for(const [q,id] of [["이치란 아베노","branch_ichiran_abeno"],["이치란 신사이바시","branch_ichiran_shinsaibashi"]])
    assert.ok(searchPlaces(places,q,places.length).some(p=>p.id===id),q);
  assert.equal(searchPlaces(places,"이치란",places.length).length,7);
});
