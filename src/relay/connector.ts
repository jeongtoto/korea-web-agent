import { sanitizeRelayResult, verifyRelayJob, type SignedRelayJob } from './protocol.ts';
import { createPlaywrightBrowserDriver, extractAuthenticatedFields, type BrowserDriver } from './playwright-adapter.ts';

declare const process: { env: Record<string, string | undefined>; cwd(): string; argv: string[] };

export interface ConnectorIterationOptions {
  cloudUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  driverFactory: () => Promise<BrowserDriver>;
}

function endpoint(base: string, pathname: string): string {
  return new URL(pathname, base.endsWith('/') ? base : `${base}/`).toString();
}

export async function runConnectorIteration(options: ConnectorIterationOptions): Promise<'idle' | 'processed'> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = { authorization: `Bearer ${options.secret}` };
  const poll = await fetchImpl(endpoint(options.cloudUrl, '/api/relay/poll'), {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: '{}',
  });
  if (poll.status === 204) return 'idle';
  if (!poll.ok) throw new Error(`Relay poll failed with HTTP ${poll.status}`);

  const job = await poll.json() as SignedRelayJob;
  if (!await verifyRelayJob(job, options.secret)) throw new Error('Cloud relay job signature is invalid or expired');

  let driver: BrowserDriver | undefined;
  try {
    driver = await options.driverFactory();
    const result = sanitizeRelayResult(await extractAuthenticatedFields(job, driver));
    const response = await fetchImpl(endpoint(options.cloudUrl, '/api/relay/result'), {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, result }),
    });
    if (!response.ok) throw new Error(`Relay result upload failed with HTTP ${response.status}`);
    return 'processed';
  } catch (error) {
    await fetchImpl(endpoint(options.cloudUrl, '/api/relay/result'), {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, error: error instanceof Error ? error.message : String(error) }),
    }).catch(() => undefined);
    throw error;
  } finally {
    if (driver) await driver.close().catch(() => {});
  }
}

export async function runConnectorLoop(options: ConnectorIterationOptions & { pollIntervalMs?: number; signal?: AbortSignal }): Promise<void> {
  const interval = options.pollIntervalMs ?? 1_500;
  while (!options.signal?.aborted) {
    try {
      await runConnectorIteration(options);
    } catch (error) {
      console.error(`Relay connector iteration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]?.endsWith('/relay/connector.ts') || process.argv[1]?.endsWith('\\relay\\connector.ts') || process.argv[1]?.endsWith('/relay/connector.js') || process.argv[1]?.endsWith('\\relay\\connector.js'));
}

if (isDirectRun()) {
  const cloudUrl = process.env.KWA_CLOUD_URL;
  const secret = process.env.KWA_RELAY_SECRET;
  if (!cloudUrl || !secret) throw new Error('KWA_CLOUD_URL and KWA_RELAY_SECRET are required');
  const profileDir = process.env.KWA_PROFILE_DIR ?? `${process.cwd()}/.kwa-profile`;
  const executablePath = process.env.CHROMIUM_PATH;
  await runConnectorLoop({
    cloudUrl,
    secret,
    driverFactory: () => createPlaywrightBrowserDriver({
      profileDir,
      ...(executablePath ? { executablePath } : {}),
      headless: false,
    }),
  });
}
