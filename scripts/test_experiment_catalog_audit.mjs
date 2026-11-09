import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./experiment_catalog_audit.mjs', import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'experiment-audit-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const records = ['chosen', 'closed_tuesday', 'excluded'].map(id => ({
    place: {place_id: id, name_ko: id, category: '자연', address: 'fixture', opening_hours: '09:00-18:00',
      latitude: 34.6, longitude: 135.5, cost: 0, stay_min: 30, bag_load: 0},
    review: {stay_policy: {representative: 30}, final_csv: {record_status: id === 'excluded' ? '제외' : '확정'}},
  }));
  const profiles = {valid_from: '2026-11-01', valid_through: '2026-11-30', japan_holidays: [],
    places: Object.fromEntries(records.map(r => [r.place.place_id, {window: [540, 1080, 1050],
      closed_weekdays: r.place.place_id === 'closed_tuesday' ? [2] : []}]))};
  const catalogPath = path.join(dir, 'catalog.json'), profilesPath = path.join(dir, 'profiles.json');
  fs.writeFileSync(catalogPath, JSON.stringify({places: records}));
  fs.writeFileSync(profilesPath, JSON.stringify(profiles));
  return (start, end) => JSON.parse(execFileSync(process.execPath, [script, start, end], {encoding: 'utf8',
    env: {...process.env, REAL_CATALOG_PATH: catalogPath, REAL_PROFILES_PATH: profilesPath}}));
}

test('audit separates API rows, excluded rows, selectable rows and dated eligibility', t => {
  const report = fixture(t)('2026-11-16', '2026-11-17');
  assert.equal(report.catalog_total, 3);
  assert.equal(report.excluded, 1);
  assert.equal(report.selectable, 2);
  assert.equal(report.catalog_total, report.excluded + report.selectable);
  assert.equal(Object.hasOwn(report, 'searchable'), false);
  assert.deepEqual(report.rows.map(r => r.place_id), ['chosen', 'closed_tuesday']);
  assert.deepEqual(report.per_day, [{date: '2026-11-16', eligible: 2}, {date: '2026-11-17', eligible: 1}]);
  assert.deepEqual(report.outside_reviewed_dates, []);
});

test('audit reports review boundaries and keeps out-of-range dates ineligible', t => {
  const report = fixture(t)('2026-11-30', '2026-12-02');
  assert.deepEqual(report.reviewed_date_range, ['2026-11-01', '2026-11-30']);
  assert.deepEqual(report.outside_reviewed_dates, ['2026-12-01', '2026-12-02']);
  assert.deepEqual(report.per_day.map(d => d.eligible), [2, 0, 0]);
  assert.ok(report.rows.every(r => r.dates.slice(1).every(d =>
    !d.eligible && d.reasons.includes('outside_reviewed_date_range'))));
  const earlier = fixture(t)('2026-10-31', '2026-11-01');
  assert.deepEqual(earlier.outside_reviewed_dates, ['2026-10-31']);
  assert.deepEqual(earlier.per_day.map(d => d.eligible), [0, 2]);
});
