import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadInputs} from './validate_real_schedule.mjs';
import {categoryReport} from './report_week6_catalog.mjs';
const {dataset, profiles} = loadInputs();
const audit = JSON.parse(fs.readFileSync(new URL('../data/week5/real_catalog_integration_20260930.json', import.meta.url), 'utf8'));

test('stale source and date-profile reports cannot be published as the current category audit', () => {
  const edited = structuredClone(dataset); edited.places[0].place.address = 'changed';
  assert.throws(() => categoryReport(edited, profiles, audit), /Regenerate/);
  const changedProfiles = structuredClone(profiles); changedProfiles.checked_at = '2099-01-01';
  assert.throws(() => categoryReport(dataset, changedProfiles, audit), /Regenerate/);
});
test('missing or duplicate individual IDs cannot silently change category completion counts', () => {
  const edited = structuredClone(audit);
  edited.individual_validation.places[0] = edited.individual_validation.places[1];
  assert.throws(() => categoryReport(dataset, profiles, edited), /exactly one/);
});
test('model passes do not promote records, and missing weather facts remain visible', () => {
  const r = categoryReport(dataset, profiles, audit);
  assert.equal(r.total_records, 150);
  assert.equal(r.individual_passed, audit.summary.passed_individual_model);
  assert.equal(r.promotion_complete, 0);
  assert.ok(r.individual_passed > r.promotion_complete);
  assert.equal(r.categories.reduce((n,c) => n+c.covered_unknown, 0), dataset.places.filter(x => x.place.covered == null).length);
  const ids = r.categories.flatMap(c => [...c.passed_ids, ...c.held_ids]);
  assert.equal(ids.length, 150); assert.equal(new Set(ids).size, 150);
});
