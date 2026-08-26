import { json } from './_lib/http.mjs';
export default async () => json({ ok: true, service: 'korea-web-agent', version: '0.6.2', runtime: 'netlify' });
