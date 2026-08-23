// Node built-ins are available at runtime; this project intentionally keeps zero npm runtime dependencies.
// @ts-expect-error Local @types/node is intentionally not required.
import http from 'node:http';
// @ts-expect-error Local @types/node is intentionally not required.
import fs from 'node:fs/promises';
// @ts-expect-error Local @types/node is intentionally not required.
import path from 'node:path';
// @ts-expect-error Local @types/node is intentionally not required.
import { fileURLToPath } from 'node:url';
import { createDefaultResearchDependencies, runResearch, type ResearchDependencies } from './orchestrator/research.ts';
import { RelayBroker } from './relay/broker.ts';
import type { ResearchJob, ResearchRequest } from './core/types.ts';

declare const process: { env: Record<string, string | undefined>; cwd(): string; argv: string[] };

export interface ServerOptions {
  researchRunner?: (request: ResearchRequest) => Promise<ResearchJob>;
  researchDependencies?: Partial<ResearchDependencies>;
  relayBroker?: RelayBroker;
  publicDir?: URL | string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res: any, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(new TextEncoder().encode(body).byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readJsonBody(req: any, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error('Request body is too large');
    chunks.push(bytes);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function validateResearchRequest(value: unknown): ResearchRequest {
  if (!value || typeof value !== 'object') throw new Error('JSON object is required');
  const object = value as Record<string, unknown>;
  if (typeof object.question !== 'string' || !object.question.trim()) throw new Error('question is required');
  if (object.question.length > 2_000) throw new Error('question is too long');
  if (object.url !== undefined && (typeof object.url !== 'string' || object.url.length > 4_000)) throw new Error('url is invalid');
  if (object.includeLocalRelay !== undefined && typeof object.includeLocalRelay !== 'boolean') throw new Error('includeLocalRelay must be boolean');

  const request: ResearchRequest = { question: object.question.trim() };
  if (typeof object.url === 'string' && object.url.trim()) request.url = object.url.trim();
  if (typeof object.includeLocalRelay === 'boolean') request.includeLocalRelay = object.includeLocalRelay;
  if (object.category === 'product' || object.category === 'place' || object.category === 'service' || object.category === 'auto') request.category = object.category;
  return request;
}

function resolvePublicDir(value?: URL | string): string {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value === 'string') return path.resolve(value);
  return path.resolve(process.cwd(), 'public');
}

async function serveStatic(res: any, publicDir: string, pathname: string): Promise<boolean> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(requested);
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return false;
  const relative = decoded.replace(/^\/+/, '');
  const full = path.resolve(publicDir, relative);
  const prefix = `${path.resolve(publicDir)}${path.sep}`;
  if (full !== path.resolve(publicDir, 'index.html') && !full.startsWith(prefix)) return false;

  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) return false;
    const body = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'",
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function createKoreaWebAgentServer(options: ServerOptions = {}): any {
  const broker = options.relayBroker;
  const researchRunner = options.researchRunner ?? ((request: ResearchRequest) => runResearch(
    request,
    createDefaultResearchDependencies({
      ...options.researchDependencies,
      relayClient: broker ?? options.researchDependencies?.relayClient ?? null,
    }),
  ));
  const publicDir = resolvePublicDir(options.publicDir);
  const jobs = new Map<string, ResearchJob>();

  return http.createServer(async (req: any, res: any) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true, service: 'korea-web-agent', version: '0.5.0' });
        return;
      }

      if (url.pathname === '/api/relay/status' && req.method === 'GET') {
        sendJson(res, 200, {
          enabled: Boolean(broker),
          online: broker ? await broker.isAvailable() : false,
          lastSeenAt: broker?.lastSeenAt() ?? null,
        });
        return;
      }

      if (url.pathname === '/api/relay/poll' && req.method === 'POST') {
        if (!broker) { sendJson(res, 404, { error: 'relay broker not configured' }); return; }
        if (!broker.authorizeBearer(req.headers?.authorization)) { sendJson(res, 401, { error: 'unauthorized' }); return; }
        const job = await broker.poll();
        if (!job) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
        sendJson(res, 200, job);
        return;
      }

      if (url.pathname === '/api/relay/result' && req.method === 'POST') {
        if (!broker) { sendJson(res, 404, { error: 'relay broker not configured' }); return; }
        if (!broker.authorizeBearer(req.headers?.authorization)) { sendJson(res, 401, { error: 'unauthorized' }); return; }
        let payload: unknown;
        try { payload = await readJsonBody(req, 32 * 1024); }
        catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }); return; }
        if (!payload || typeof payload !== 'object') { sendJson(res, 400, { error: 'invalid relay result' }); return; }
        const object = payload as Record<string, unknown>;
        if (typeof object.jobId !== 'string' || !object.jobId) { sendJson(res, 400, { error: 'jobId is required' }); return; }
        try {
          const accepted = typeof object.error === 'string'
            ? broker.submitError(object.jobId, object.error)
            : broker.submitResult(object.jobId, object.result);
          if (!accepted) { sendJson(res, 404, { error: 'pending relay job not found' }); return; }
          res.writeHead(204, { 'cache-control': 'no-store' });
          res.end();
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/research') {
        let request: ResearchRequest;
        try {
          request = validateResearchRequest(await readJsonBody(req));
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        try {
          const job = await researchRunner(request);
          jobs.set(job.id, job);
          sendJson(res, 201, job);
        } catch (error) {
          sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      const jobMatch = req.method === 'GET' ? url.pathname.match(/^\/api\/jobs\/([^/]+)$/) : null;
      if (jobMatch?.[1]) {
        const job = jobs.get(decodeURIComponent(jobMatch[1]));
        if (!job) sendJson(res, 404, { error: 'job not found' });
        else sendJson(res, 200, job);
        return;
      }

      if (req.method === 'GET' && await serveStatic(res, publicDir, url.pathname)) return;
      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? '8787');
  const host = process.env.HOST ?? '127.0.0.1';
  const relaySecret = process.env.KWA_RELAY_SECRET;
  const relayBroker = relaySecret ? new RelayBroker({ secret: relaySecret }) : undefined;
  const server = createKoreaWebAgentServer({ ...(relayBroker ? { relayBroker } : {}) });
  server.listen(port, host, () => {
    console.log(`Korea Web Agent listening on http://${host}:${port}`);
  });
}
