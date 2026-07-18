import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf-8'));
const { lines, branches } = summary.total;
const THRESHOLD = 80;

if (lines.pct < THRESHOLD || branches.pct < THRESHOLD) {
  console.error(`Coverage gate failed: lines ${lines.pct}% branches ${branches.pct}% (require ${THRESHOLD}%)`);
  process.exit(1);
}
console.log(`Coverage OK: lines ${lines.pct}% branches ${branches.pct}%`);
