# Korea Web Agent v1

Korea Web Agent is a mobile-first research system for Korean shopping and everyday web research. It accepts a URL plus a natural-language question, gathers attributable public evidence, and can optionally ask a locally authenticated PC browser for personalized price/delivery fields without uploading browser cookies or credentials.

## What v1 does

- PWA dashboard for phone and desktop.
- Naver Brand Store / SmartStore product URL identification.
- Direct page metadata + JSON-LD product/offer extraction.
- Bounded source plan that deliberately searches Naver Shopping/Blog/Cafe, Coupang, Danawa, YouTube, Reddit, news, official sources, and general web results.
- Keyless public web-search fallback through DuckDuckGo HTML results.
- Dedicated Crossref DOI metadata search for relevant peer-reviewed research.
- Evidence classes, duplicate independence keys, and confidence weighting.
- Product report schema with `BUY / WAIT / SKIP / INSUFFICIENT` decisions.
- Public-only fallback when the PC relay is unavailable.
- Read-only authenticated browser extraction for Naver/Coupang allowlisted domains.
- Signed HMAC relay jobs with expiry and nonce validation.
- Outbound PC connector: the PC polls the cloud, so there is no router port-forwarding or inbound PC port.
- PWA relay status indicator.

## Security boundary

The local browser profile is high trust. v1 intentionally does **not** support purchasing, payment, order cancellation, address/account changes, posting reviews/comments, or arbitrary JavaScript supplied by remote pages.

The following data must remain on the PC:

- passwords
- raw cookies
- access/session tokens
- localStorage/sessionStorage
- browser profile files

Cloud payloads contain only signed read-only jobs and normalized extracted values such as price, points, and delivery estimate. Relay outputs are recursively rejected when secret-bearing key names are detected.

CAPTCHA and step-up authentication are never bypassed.

## Requirements

- Node.js 22+
- TypeScript 5.8+ for builds
- Chromium/Chrome on the PC for authenticated browsing
- `playwright-core` installed on the PC when the authenticated connector is enabled

## Run public-only mode

```bash
npm install
npm test
npm run build
HOST=127.0.0.1 PORT=8787 npm start
```

Open `http://127.0.0.1:8787`.

Public-only mode is useful even without any browser login. If an individual site blocks server-side fetching, the job degrades to other public sources and records the failed source.

## Enable phone -> cloud -> logged-in PC research

### 1. Generate a relay secret

Use a password manager or cryptographically random generator. Use the same value on the cloud server and PC connector. Do not paste it into source code, GitHub, screenshots, or chat.

Cloud environment:

```bash
KWA_RELAY_SECRET=<long-random-secret>
HOST=0.0.0.0
PORT=8787
```

The server exposes authenticated relay polling/result endpoints. The PWA itself never receives the relay secret.

### 2. Prepare the PC connector

On the user's PC:

```bash
npm install
npm install playwright-core
```

Use a **dedicated** profile directory. Do not point the agent at the user's ordinary Chrome profile.

PowerShell example (preferred, secret is entered as a secure prompt):

```powershell
$secret = Read-Host "Relay secret" -AsSecureString
.\scripts\start-connector.ps1 -CloudUrl "https://your-agent.example" -RelaySecret $secret
```

Manual environment-variable mode is also supported when needed.

The first authenticated-browser run opens the dedicated profile. The user logs in to Naver/Coupang directly in that browser. The project never stores the account password itself.

The connector then repeatedly makes outbound HTTPS requests:

```text
PC connector -> POST /api/relay/poll
cloud broker -> signed read-only job
PC -> local browser extraction
PC connector -> POST /api/relay/result
```

No PC port needs to be exposed to the internet.

### 3. Use from the phone

Open the PWA, paste a Naver product URL, enter a question, and enable:

> 내 PC 로그인 세션의 개인화 가격/배송도 확인

When the connector is running, the header shows `PC RELAY ONLINE`. If the PC is off, the same request continues in public-only mode.

## Local-only relay server

For development or same-machine integration, a loopback relay is also available:

```bash
KWA_RELAY_SECRET=<secret> \
KWA_PROFILE_DIR=.kwa-profile \
CHROMIUM_PATH=/usr/bin/chromium \
npm run relay
```

It binds to `127.0.0.1` by default and should not be published to the internet.

## API

### Health

`GET /api/health`

### Research

`POST /api/research`

```json
{
  "url": "https://brand.naver.com/mildo/products/7322162980",
  "question": "이 침대 어때? 지금 가격이면 살만해?",
  "includeLocalRelay": true,
  "category": "auto"
}
```

### Relay status

`GET /api/relay/status`

The following endpoints are for the PC connector and require the relay bearer secret:

- `POST /api/relay/poll`
- `POST /api/relay/result`

## Deployment

### Netlify (recommended for the PWA)

The repository includes `netlify.toml` and Netlify Functions. Research jobs and outbound relay state use Netlify Blobs with strong consistency, so phone requests and PC polling do not depend on the same serverless instance.

Set one secret environment variable in Netlify:

```text
KWA_RELAY_SECRET=<cryptographically-random-secret>
```

After adding or changing `KWA_RELAY_SECRET`, trigger a fresh production deploy so the Netlify Functions receive the updated secret.

The same secret is entered locally on the PC connector. Raw cookies, passwords, localStorage and browser-profile files never enter Netlify.

Build command: `npm run build`  \
Publish directory: `public`  \
Functions directory: `netlify/functions`

### Stateful container alternative

The original Node server can also run as one persistent process behind HTTPS:

```bash
docker build -t korea-web-agent .
docker run --rm -p 8787:8787 \
  -e KWA_RELAY_SECRET='<secret>' \
  korea-web-agent
```

## Current v1 limitations

This is the safe foundation, not yet the final “search every Korean source perfectly” layer.

- Naver/Coupang authenticated extraction currently uses deterministic generic selectors. Site-specific adapters should be refined against real pages as their DOM changes.
- Naver Shopping/Blog/Cafe, Coupang, Danawa, YouTube, Reddit, news and official sites are deliberately queried through the source plan, but most still rely on search-result metadata rather than first-party APIs. Crossref is the first dedicated academic provider.
- Kakao Map, Naver Place, Instagram and richer YouTube/Naver APIs remain future adapters.
- Public search providers can be rate-limited or blocked; v2 should add official APIs and multiple search providers.
- Evidence sentiment/price signals are deterministic first-pass heuristics. A later reasoning layer can classify themes and compare alternatives while preserving the same provenance model.
- The direct HTTP fetch guard rejects literal private/local destinations and unsafe redirects, but production infrastructure should additionally enforce egress/network-level SSRF controls.

## Development

```bash
npm test
npm run typecheck
npm run build
```

The test suite covers URL safety, evidence deduplication/scoring, Naver URL parsing, public extraction, report synthesis, relay signatures, secret-output rejection, broker/connector flow, API endpoints, and offline fallback.
