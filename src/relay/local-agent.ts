import { createPlaywrightBrowserDriver } from './playwright-adapter.ts';
import { runConnectorLoop } from './connector.ts';

declare const process: { env: Record<string, string | undefined>; cwd(): string; argv: string[] };

export interface LocalAgentEnvironment {
  KWA_CLOUD_URL?: string;
  KWA_RELAY_SECRET?: string;
  KWA_PROFILE_DIR?: string;
  CHROMIUM_PATH?: string;
}

export interface ConnectorLaunchConfig {
  cloudUrl: string;
  secret: string;
  profileDir: string;
  executablePath?: string;
  printable: {
    cloudUrl: string;
    profileDir: string;
    executablePath?: string;
  };
}

export function buildConnectorLaunchConfig(env: LocalAgentEnvironment, cwd: string): ConnectorLaunchConfig {
  const rawCloudUrl = env.KWA_CLOUD_URL?.trim();
  const secret = env.KWA_RELAY_SECRET?.trim();
  if (!rawCloudUrl || !secret) throw new Error('KWA_CLOUD_URL and KWA_RELAY_SECRET are required');

  let parsed: URL;
  try {
    parsed = new URL(rawCloudUrl);
  } catch {
    throw new Error('KWA_CLOUD_URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('KWA_CLOUD_URL must use HTTPS');
  if (secret.length < 32) throw new Error('KWA_RELAY_SECRET is too short');

  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname + '/';

  const profileDir = env.KWA_PROFILE_DIR?.trim() || cwd + '/.kwa-profile';
  const executablePath = env.CHROMIUM_PATH?.trim() || undefined;
  const printable: ConnectorLaunchConfig['printable'] = {
    cloudUrl: parsed.toString(),
    profileDir,
    ...(executablePath ? { executablePath } : {}),
  };

  return {
    cloudUrl: parsed.toString(),
    secret,
    profileDir,
    ...(executablePath ? { executablePath } : {}),
    printable,
  };
}

function isDirectRun(): boolean {
  const script = process.argv[1] ?? '';
  return /(?:^|[\\/])relay[\\/]local-agent\.(?:ts|js)$/.test(script);
}

if (isDirectRun()) {
  const config = buildConnectorLaunchConfig(process.env, process.cwd());
  await runConnectorLoop({
    cloudUrl: config.cloudUrl,
    secret: config.secret,
    driverFactory: () => createPlaywrightBrowserDriver({
      profileDir: config.profileDir,
      ...(config.executablePath ? { executablePath: config.executablePath } : {}),
      headless: false,
    }),
  });
}
