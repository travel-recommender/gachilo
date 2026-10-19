import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {availability, loadInputs} from './validate_real_schedule.mjs';

test('branch preview is readable by the existing validator and cannot enter a schedule', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('python3', ['-c',
    'import sys,json; sys.path.insert(0,"scripts"); from import_branch_collection import BASE,COLLECTION,build_preview; print(json.dumps(build_preview(json.loads(BASE.read_text(encoding="utf-8")),json.loads(COLLECTION.read_text(encoding="utf-8")))[0]))'],
  {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const preview = JSON.parse(result.stdout);
  const {dataset, profiles} = loadInputs();
  assert.deepEqual(preview.places.slice(0, dataset.places.length), dataset.places);
  const additions = preview.places.slice(dataset.places.length);
  assert.equal(additions.length, 55);
  for (const record of additions) {
    const checked = availability(record, '2026-10-19', profiles, {allowShopping: true});
    assert.equal(checked.eligible_for_model, false);
    assert.ok(checked.reasons.includes('coordinates_invalid'));
    assert.ok(checked.reasons.includes('branch_collection_review_required'));
    // Filling a few numeric cells cannot silently authorize a new branch.
    const numeric = structuredClone(record);
    Object.assign(numeric.place, {latitude: 34.67, longitude: 135.5, cost: 0, stay_min: 60, bag_load: 0});
    const stillHeld = availability(numeric, '2026-10-19', profiles, {allowShopping: true});
    assert.equal(stillHeld.eligible_for_model, false);
    assert.ok(stillHeld.reasons.includes('branch_collection_review_required'));
    assert.ok(stillHeld.reasons.includes('area_scheme_unconfirmed'));
    for (const reason of ['meal_role_not_full_meal', 'facility_relation_unconfirmed']) {
      if (record.review.recommendation_blockers.includes(reason)) {
        const isolated = structuredClone(numeric);
        isolated.review.recommendation_blockers = [reason];
        const result = availability(isolated, '2026-10-19', profiles, {allowShopping: true});
        assert.equal(result.eligible_for_model, false);
        assert.ok(result.reasons.includes(reason));
      }
    }
  }
});
