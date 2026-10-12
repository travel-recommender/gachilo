/** Echo a two-point walking result; stdout remains machine-readable JSON. Node 24+. */
import fs from 'node:fs';
import {queryWalkingRoute} from '../backend/engine/routing.ts';
try {
  const points = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!Array.isArray(points) || points.length !== 2) throw Error('Expected two {lat,lng} coordinates');
  process.stdout.write(JSON.stringify(await queryWalkingRoute(points[0], points[1])) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
