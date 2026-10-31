import { spawnSync } from 'node:child_process';

// Keep optional development tooling outside the repository. The delivered site uses none.
const compiler = process.env.WHEELY_TSC;
const result = compiler
  ? spawnSync(process.execPath, [compiler, '--project', 'jsconfig.json'], { stdio: 'inherit' })
  : spawnSync('tsc', ['--project', 'jsconfig.json'], { stdio: 'inherit' });
if (result.error) {
  console.error('TypeScript is an optional checker. Install it outside the project and set WHEELY_TSC to its lib/tsc.js. See README.');
  process.exit(1);
}
process.exit(result.status ?? 1);
