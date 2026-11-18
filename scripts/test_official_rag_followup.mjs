import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {availability} from './validate_real_schedule.mjs';
import {evidenceOf, evidenceForDate} from '../backend/engine/visit_evidence.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const original=read(path.join(root,'data/final/osaka_catalog_20261112.json'));
const profiles=read(path.join(root,'data/final/osaka_profiles_20261104.json'));
let byId;
before(() => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rag-followup-test-'));
  try {
    execFileSync('python3',[path.join(root,'scripts/materialize_visit_evidence.py'),
      '--catalog',path.join(root,'data/final/osaka_catalog_20261112.json'),'--out',path.join(tmp,'new')]);
    const updated=read(path.join(tmp,'new/catalog.json'));
    byId=new Map(updated.places.map(r=>[r.place.place_id,r]));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('official source refresh leaves all 238 places and four-day scheduling decisions unchanged',()=>{
  for(const row of original.places) for(const date of ['2026-11-16','2026-11-17','2026-11-18','2026-11-19'])
    assert.deepEqual(availability(byId.get(row.place.place_id),date,profiles,{allowShopping:true}),
      availability(row,date,profiles,{allowShopping:true}));
});
test('RAG retains stale history and only the explicitly dated closure becomes usable',()=>{
  const evidence=evidenceOf(byId.get('osaka_008'),profiles,{today:'2026-11-18'});
  assert.ok(evidence.entries.some(e=>e.field==='opening_hours'&&e.state==='current'&&e.checkedAt==='2026-11-18'));
  assert.ok(evidence.entries.some(e=>e.field==='opening_hours'&&e.state==='superseded'&&e.checkedAt==='2026-09-23'));
  const date=evidenceForDate(evidence,'2026-11-19');
  const ids=new Set(date.usableEvidenceIds);
  assert.ok(evidence.entries.some(e=>ids.has(e.id)&&e.field==='operating_exception'&&e.value.closed));
  assert.equal(date.conflicts.length,0);
  const next=new Set(evidenceForDate(evidence,'2026-11-20').usableEvidenceIds);
  assert.ok(!evidence.entries.some(e=>next.has(e.id)&&e.field==='operating_exception'));
  assert.ok(!evidence.entries.some(e=>ids.has(e.id)&&e.field==='cost'));
});
test('a recheck does not invent a calendar or clear missing profile warnings',()=>{
  const r=byId.get('branch_ichiran_abeno');
  const e=evidenceOf(r,profiles,{today:'2026-11-18'});
  const check=evidenceForDate(e,'2026-11-19');
  assert.ok(check.reasons.includes('evidence_date_unknown')); // Original profile date still unknown.
  assert.ok(e.entries.filter(x=>x.state==='current'&&x.field==='cost').every(x=>x.validThrough===null));
  assert.ok(!check.usableEvidenceIds.some(id=>e.entries.find(x=>x.id===id).field==='cost'));
});

test('HEP operator notice is official while the tenant year cross-check stays reviewed',()=>{
  const e=evidenceOf(byId.get('osaka_008'),profiles,{today:'2026-11-18'}).entries
    .find(e=>e.field==='operating_exception' && e.checkedAt==='2026-11-18');
  assert.deepEqual(e.sources.map(s=>s.kind),['official','reviewed']);
  assert.match(e.note,/입점사/);
});
