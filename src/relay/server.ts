// @ts-expect-error Local @types/node is intentionally not required.
import http from 'node:http';
// @ts-expect-error Local @types/node is intentionally not required.
import path from 'node:path';
import { verifyRelayJob, sanitizeRelayResult, type SignedRelayJob } from './protocol.ts';
import { createPlaywrightBrowserDriver, extractAuthenticatedFields, type BrowserDriver } from './playwright-adapter.ts';

declare const process: { env: Record<string, string | undefined>; cwd(): string; argv: string[] };

export interface RelayServerOptions {
  secret: string;
  driverFactory: () => Promise<BrowserDriver>;
  now?: () => number;
}

async function readJson(req: any, maxBytes = 32 * 1024): Promise<unknown> {
  let text = '';
  let bytes = 0;
  for await (const chunk of req) {
    const piece = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    bytes += new TextEncoder().encode(piece).byteLength;
    if (bytes > maxBytes) throw new Error('Relay request is too large');
    text += piece;
  }
  return JSON.parse(text || '{}');
}

function json(res: any, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

export function createRelayServer(options: RelayServerOptions): any {
  if (options.secret.length < 16) throw new Error('Relay secret must be at least 16 characters');
  const now = options.now ?? (() => Date.now());

  return http.createServer(async (req: any, res: any) => {
    if (req.method === 'GET' && req.url === '/relay/health') {
      json(res, 200, { ok: true, service: 'korea-web-agent-local-relay', readOnly: true });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/relay/extract') {
      json(res, 404, { error: 'not found' });
      return;
    }

    let body: SignedRelayJob;
    try {
      body = await readJson(req) as SignedRelayJob;
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (!await verifyRelayJob(body, options.secret, now())) {
      json(res, 401, { error: 'invalid or expired relay signature' });
      return;
    }

    let driver: BrowserDriver | undefined;
    try {
      driver = await options.driverFactory();
      const extracted = await extractAuthenticatedFields(body, driver);
      json(res, 200, sanitizeRelayResult(extracted));
    } catch (error) {
      json(res, 422, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (driver) await driver.close().catch(() => {});
    }
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]?.endsWith('/relay/server.ts') || process.argv[1]?.endsWith('\\relay\\server.ts') || process.argv[1]?.endsWith('/relay/server.js') || process.argv[1]?.endsWith('\\relay\\server.js'));
}

if (isDirectRun()) {
  const secret = process.env.KWA_RELAY_SECRET;
  if (!secret) throw new Error('KWA_RELAY_SECRET is required');
  const profileDir = process.env.KWA_PROFILE_DIR ?? path.resolve(process.cwd(), '.kwa-profile');
  const executablePath = process.env.CHROMIUM_PATH;
  const server = createRelayServer({
    secret,
    driverFactory: () => createPlaywrightBrowserDriver({
      profileDir,
      ...(executablePath ? { executablePath } : {}),
      headless: false,
    }),
  });
  const port = Number(process.env.KWA_RELAY_PORT ?? '8790');
  server.listen(port, '127.0.0.1', () => {
    console.log(`Korea Web Agent local relay listening on http://127.0.0.1:${port}`);
  });
}
