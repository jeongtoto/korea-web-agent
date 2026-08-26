import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const VERSION = '0.7.3';

async function text(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('all v0.7.3 release metadata agrees exactly', async () => {
  const packageJson = JSON.parse(await text('package.json')) as { version?: string };
  const packageLock = JSON.parse(await text('package-lock.json')) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  const openapi = await text('openapi/korea-web-agent-action.yaml');
  const health = await text('netlify/functions/health.mjs');
  const smoke = await text('.github/workflows/production-smoke.yml');

  assert.equal(packageJson.version, VERSION);
  assert.equal(packageLock.version, VERSION);
  assert.equal(packageLock.packages?.['']?.version, VERSION);
  assert.match(openapi, /^\s*version:\s*0\.7\.3\s*$/m);
  assert.match(health, /version:\s*['"]0\.7\.3['"]/);
  assert.match(smoke, /\.version\s*==\s*"0\.7\.3"/);
  assert.match(smoke, /v0\.7\.3 production deploy/);
  assert.doesNotMatch(smoke, /0\.3\.0|v0\.3\b/);
});
