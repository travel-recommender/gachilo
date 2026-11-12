import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadRuntimeInputs, availability, toEnginePlace} from './validate_real_schedule.mjs';

const {dataset, profiles} = loadRuntimeInputs();
const old = JSON.parse(fs.readFileSync(new URL('../data/final/osaka_catalog_20261104.json', import.meta.url)));
const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));

test('the engine receives stable identity and branch-format keys', () => {
  const r = byId.get('branch_551_namba_walk');
  const check = availability(r, '2026-11-16', profiles, {allowShopping: true});
  assert.equal(check.eligible_for_model, true);
  const place = toEnginePlace(r, check, '9');
  assert.equal(place.brandId, '551_horai');
  assert.equal(place.branchGroupId, '551_horai:restaurant');
  assert.equal(place.mealRole, 'meal');
});

test('adding identity does not change availability of any of the 238 records across all four travel dates', () => {
  for (const r of old.places) for (const date of ['2026-11-16','2026-11-17','2026-11-18','2026-11-19']) {
    assert.deepEqual(availability(byId.get(r.place.place_id), date, profiles, {allowShopping: true}),
      availability(r, date, profiles, {allowShopping: true}));
  }
});

test('a closed same-brand place and held coffee branches remain ineligible', () => {
  for (const id of ['osm_node_2546559085','branch_starbucks_ebisubashi']) {
    assert.ok(byId.get(id).place.brand_id);
    assert.equal(availability(byId.get(id), '2026-11-16', profiles, {allowShopping: true}).eligible_for_model, false);
  }
});

test('551 restaurants have different holidays; brand membership never copies calendars', () => {
  const eligible = (id, date) => availability(byId.get(id), date, profiles, {allowShopping: true}).eligible_for_model;
  assert.equal(eligible('branch_551_honten', '2026-11-17'), false);
  assert.equal(eligible('branch_551_namba_walk', '2026-11-17'), true);
  assert.equal(eligible('branch_551_namba_walk', '2026-11-18'), false);
  assert.equal(eligible('branch_551_honten', '2026-11-18'), true);
});
