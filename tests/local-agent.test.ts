import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConnectorLaunchConfig } from '../src/relay/local-agent.ts';

test('local agent validates cloud URL and relay secret without exposing secret in printable config', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const config = buildConnectorLaunchConfig({
    KWA_CLOUD_URL: 'https://korea-web-agent.netlify.app',
    KWA_RELAY_SECRET: secret,
    KWA_PROFILE_DIR: 'C:\\Users\\User\\.kwa-profile',
    CHROMIUM_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }, 'C:\\repo');

  assert.equal(config.cloudUrl, 'https://korea-web-agent.netlify.app/');
  assert.equal(config.secret, secret);
  assert.equal(config.profileDir, 'C:\\Users\\User\\.kwa-profile');
  assert.equal(JSON.stringify(config.printable).includes(secret), false);
});

test('local agent rejects missing, short, or non-https cloud configuration', () => {
  assert.throws(() => buildConnectorLaunchConfig({}, 'C:\\repo'), /KWA_CLOUD_URL|KWA_RELAY_SECRET/);
  assert.throws(() => buildConnectorLaunchConfig({
    KWA_CLOUD_URL: 'http://korea-web-agent.netlify.app',
    KWA_RELAY_SECRET: '0123456789abcdef0123456789abcdef',
  }, 'C:\\repo'), /https/i);
  assert.throws(() => buildConnectorLaunchConfig({
    KWA_CLOUD_URL: 'https://korea-web-agent.netlify.app',
    KWA_RELAY_SECRET: 'short',
  }, 'C:\\repo'), /secret/i);
});
