import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('Windows installer registers a hidden per-user logon task with restart-on-failure and no literal relay secret argument', () => {
  for (const path of [
    'scripts/install-local-agent.ps1',
    'scripts/run-local-agent.ps1',
    'scripts/uninstall-local-agent.ps1',
  ]) assert.equal(existsSync(path), true, `${path} must exist`);

  const install = readFileSync('scripts/install-local-agent.ps1', 'utf8');
  assert.match(install, /KoreaWebAgent/);
  assert.match(install, /New-ScheduledTaskTrigger[\s\S]*-AtLogOn/i);
  assert.match(install, /WindowStyle\s+Hidden/i);
  assert.match(install, /RestartCount|RestartInterval/i);
  assert.match(install, /ConvertFrom-SecureString/i);
  assert.match(install, /LOCALAPPDATA/i);
  assert.doesNotMatch(install, /-RelaySecret\s+\$plain/i);

  const runner = readFileSync('scripts/run-local-agent.ps1', 'utf8');
  assert.match(runner, /ConvertTo-SecureString/i);
  assert.match(runner, /KWA_RELAY_SECRET/);
  assert.match(runner, /npm\s+run\s+local-agent/i);

  const uninstall = readFileSync('scripts/uninstall-local-agent.ps1', 'utf8');
  assert.match(uninstall, /Unregister-ScheduledTask/i);
  assert.match(uninstall, /RemoveConfig/i);
});

test('package exposes local-agent command for normal hidden startup', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(typeof pkg.scripts?.['local-agent'], 'string');
  assert.match(pkg.scripts['local-agent'], /local-agent/);
});
