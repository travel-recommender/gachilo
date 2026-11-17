import fs from 'node:fs';
import {assignment, placedEquivalentOf, explanationPolicy, LEGACY_EXPLANATION_POLICY} from '../../web/src/lib/experiment.ts';
import {satisfactionOf} from './consensus.ts';
import {withPlaceCatalog} from './places.ts';

// Export passes the hash-verified, frozen experiment catalogue, never today's runtime catalogue.
const records = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).places : null;
const groups = new Map((records ?? []).map(r => [r.place.place_id, r.place.branch_group_id ?? null]));
const metricBasis = records
  ? 'satisfactionOf/v2; frozen catalogue; branch_group_id for picks/musts; exact ID veto; candidate per-day cost and walking; not a participant answer'
  : 'satisfactionOf/v1; exact IDs; scheduled union; candidate per-day cost and walking; not a participant answer';

function record(p) {
  // Unversioned frozen sessions used the original per-candidate condition.
  const policy = explanationPolicy(p.explanationPolicy ?? LEGACY_EXPLANATION_POLICY);
  const assigned = assignment(p.roomId, p.memberId, p.memberIds, policy);
  if (!assigned) throw Error('unknown member');
  if (!p.candidate) return assigned;
  const c = p.candidate, ids = [...new Set(c.days.flatMap(d => d.placeIds))];
  const represented = placedEquivalentOf(ids, id => groups.get(id));
  const selections = ids.map(id => ({place: {id}, tier: 'core', participants: []}));
  const scores = p.submissions.map(s => satisfactionOf(
    {...s, budget: s.budgetPerDay, walkLimit: s.stepLimit}, selections,
    c.metrics.costKrwPerDay, c.metrics.walkStepsPerDay, undefined, represented));
  const mine = scores.find(s => s.memberId === p.memberId), values = scores.map(s => s.score);
  const slot = assigned.slots.find(s => s.strategy === c.strategy);
  return {seat: assigned.seat, ...slot, explanationPolicy: policy, automatic: mine,
    group: {mean: values.reduce((a,b) => a+b, 0)/values.length, min: Math.min(...values), gap: Math.max(...values)-Math.min(...values)},
    metrics: c.metrics, placeIds: ids, metricBasis};
}
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const calculate = () => Array.isArray(payload) ? payload.map(record) : record(payload);
// satisfactionOf's must/veto input validation must also see real IDs, not the demo registry.
const result = records ? withPlaceCatalog(records.map(r => ({id: r.place.place_id})), calculate) : calculate();
process.stdout.write(JSON.stringify(result));
