import { json } from './_lib/http.mjs';
export default async () => json({ ok: true, service: 'korea-web-agent', version: '0.7.4', runtime: 'netlify' });
