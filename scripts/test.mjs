import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Expand test paths in Node instead of relying on shell globbing on Windows.
const files = readdirSync('test').filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit' });
if (result.error) process.stderr.write(`${result.error.message}\n`);
process.exitCode = result.status ?? 1;
