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
