// Prints the reference house (ANALYTIC-001) as a saved-project JSON for browser checks: npx tsx scripts/seed-project.ts > /tmp/claude-0/seed.json
import { buildProject } from '../tests/fixtures/analytic-box-room';
const p = buildProject(); p.name = 'Smith residence'; p.client = 'J. Smith'; p.address = '12 Maple St';
console.log(JSON.stringify(p));
