import {test} from "node:test";
import assert from "node:assert/strict";
import {loadCatalogPages} from "../src/lib/catalog-pages.ts";
import {toPlace,type ApiCatalogPlace} from "../src/lib/catalog.ts";
const place=(i:number):ApiCatalogPlace=>({place_id:`branch_${i}`,name:`GU JAPAN ${i}`,name_ko:`지유 지점 ${i}`,category:"쇼핑",area:null,address:null,latitude:null,longitude:null,stay_min:null,bag_load:null,covered:null,cost_krw:null});
test("205 records including second-page branches load and can be searched",async()=>{
 const rows=Array.from({length:205},(_,i)=>place(i));const offsets:number[]=[];
 const result=await loadCatalogPages(async(offset)=>{offsets.push(offset);return {dataset:"osaka_review_150",total:205,next_offset:offset===0?150:null,places:rows.slice(offset,offset+150)}});
 assert.deepEqual(offsets,[0,150]);assert.equal(result.places.length,205);
 const ui=result.places.map(toPlace);
 assert.ok(Number.isNaN(ui[0].lat));assert.equal(ui[0].costKnown,false);
});
test("truncated and looping catalogs fail rather than show partial results",async()=>{
 await assert.rejects(loadCatalogPages(async()=>({dataset:"x",total:205,next_offset:null,places:[place(1)]})));
 await assert.rejects(loadCatalogPages(async()=>({dataset:"x",total:205,next_offset:0,places:[place(1)]})));
});
test("activity and complex culture preserve real display labels",()=>{
 assert.equal(toPlace({...place(1),category:"체험·오락"}).category,"activity");
 const p=toPlace({...place(2),category:"복합문화",record_status:"이용 조건 보류"});
 assert.equal(p.category,"culture");assert.equal(p.categoryLabel,"복합문화");
});

test("verified branch conditions and budget estimates remain visible",()=>{
 const p=toPlace({...place(1),latitude:34.7042542,longitude:135.494773,cost_krw:21563,
   cost_status:"estimate",cost_basis:"공식 평균예산, 메뉴 확정가 아님",visit_conditions:["15~17시 휴식"],record_status:"일정 조건 확인 · 방문일 검사"});
 assert.equal(p.costEstimated,true);assert.equal(p.costKnown,true);
 assert.match(p.blurb,/평균예산/);assert.match(p.blurb,/15~17시/);
 assert.equal(p.lat,34.7042542);
});


test("shopping purchase exclusions remain distinct from unknown prices",()=>{
 const shopping=toPlace({...place(1),cost_status:"not_applicable_shopping"});
 assert.equal(shopping.shoppingSpendExcluded,true);
 assert.equal(shopping.costKnown,false);
 assert.equal(toPlace(place(2)).shoppingSpendExcluded,false);
});
test("room date checks preserve all 205 searchable entries but disable unavailable ones",async()=>{
 const {roomCatalog}=await import("../src/lib/catalog.ts");
 const rows=Array.from({length:205},(_,i)=>place(i));
 const list=roomCatalog(rows,["branch_204"]);
 assert.equal(list.length,205);
 assert.equal(list[204].selectionDisabledReason,null);
 assert.ok(list[0].selectionDisabledReason);
 assert.equal(roomCatalog([{...rows[0],selection_disabled_reason:"폐업"}],["branch_0"])[0].selectionDisabledReason,"폐업");
});
