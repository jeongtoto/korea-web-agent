# Korea Web Agent v0.3

Korea Web Agent is a read-only Korean product-research backend designed to be called from a dedicated Custom GPT. The primary experience is now natural-language product research inside ChatGPT; the existing PWA remains available as a diagnostic/manual testing surface.

Example:

```text
와이드뷰 43인치 4K V3 스탠드 어때?
```

The agent resolves the product, gathers attributable public evidence, evaluates current price/reviews/specifications, and conditionally asks a locally authenticated PC browser for personalized Naver/Coupang price, coupon, points, shipping, and availability fields. It returns a conservative `BUY / WAIT / SKIP / INSUFFICIENT` result.

## v0.3 behavior

- Natural-language product resolution without requiring a URL.
- Naver Brand Store, SmartStore, mobile SmartStore, and Naver Shopping Live product URL parsing.
- Product identity matching before search evidence is allowed to count as exact-product evidence.
- Generic KC/safety pages and general papers cannot masquerade as proof of a specific product.
- Academic evidence is requested only when the question actually benefits from research on health, ergonomics, materials, safety, or mechanisms.
- Confidence is based on evidence coverage dimensions rather than accumulating arbitrary snippets toward 97%.
- Price-sensitive purchase questions require usable price evidence before `BUY` or `WAIT` is allowed.
- `WAIT` is a supported price/timing conclusion, not a fallback for uncertainty.
- Purchase-oriented phrases such as `어때?`, `살만해?`, `지금 사?`, `최저가?`, `쿠폰?`, `특가?` make authenticated pricing useful automatically.
- Specification-only questions such as `패널 스펙 알려줘` do not launch the PC browser.
- The authenticated relay remains read-only and outbound-only from the PC.
- ChatGPT Action routes use a separate API credential from the PC relay.

## Architecture

```text
Custom GPT
   |
   | Bearer KWA_ACTION_API_KEY
   v
Netlify /api/agent/*
   |
   +--> product resolver -> public research -> evidence matcher -> report
   |
   +--> when purchase/price intent requires it
           |
           v
       persistent relay queue
           ^
           | outbound HTTPS polling with KWA_RELAY_SECRET
           |
       user's PC connector -> dedicated logged-in Chrome profile
```

Netlify is a backend. Users do not need to open the Netlify dashboard/PWA for normal Custom GPT use.

## Security boundary

The local authenticated browser profile is high trust. The project intentionally does **not** support purchasing, payment, order cancellation, address/account changes, posting reviews/comments, sending messages, or arbitrary JavaScript supplied by remote pages.

The following must remain on the PC:

- passwords
- raw cookies
- access/session tokens
- localStorage/sessionStorage
- browser profile files

Cloud relay payloads contain only signed, expiring read-only jobs and normalized extracted values. Relay output recursively rejects secret-bearing key names. CAPTCHA and step-up/MFA authentication are never bypassed.

Two different secrets are used:

```text
KWA_RELAY_SECRET       PC connector <-> Netlify relay only
KWA_ACTION_API_KEY     Custom GPT Action <-> /api/agent/* only
```

Never reuse one secret as the other. Never commit either value to GitHub or paste them into chat/logs/screenshots.

## Requirements

- Node.js 22+
- TypeScript 5.8+ for builds
- Chromium/Chrome on the PC for authenticated browsing
- `playwright-core` installed locally when the PC connector is enabled

## PC connector

Use a dedicated browser profile such as `$HOME\.kwa-profile`, never the ordinary daily Chrome profile. Log in to Naver/Coupang directly in that dedicated browser.

After cloning/updating the repository:

```powershell
cd "$HOME\korea-web-agent"
npm ci
npm install --no-save playwright-core

$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$secret = Read-Host "Netlify Relay Secret" -AsSecureString

.\scripts\start-connector.ps1 `
    -CloudUrl "https://korea-web-agent.netlify.app" `
    -RelaySecret $secret `
    -ChromePath $Chrome
```

The connector repeatedly makes outbound HTTPS requests:

```text
PC -> POST /api/relay/poll
cloud -> signed read-only job
PC -> dedicated browser extraction
PC -> POST /api/relay/result
```

No inbound PC port or router port forwarding is required. When no relay job exists, the connector stays quiet and continues polling.

Relay status:

```text
GET /api/relay/status
```

`online:true` means the cloud has seen the connector recently.

## ChatGPT Action API

The primary ChatGPT endpoint is:

```text
POST /api/agent/research
Authorization: Bearer <KWA_ACTION_API_KEY>
Content-Type: application/json
```

Query-only request:

```json
{
  "query": "와이드뷰 43인치 4K V3 스탠드 어때?"
}
```

Optional URL request:

```json
{
  "query": "이 제품 지금 사도 돼?",
  "url": "https://product.shoppinglive.naver.com/products/11458011168"
}
```

If the authenticated PC result is still pending, the response uses `status: "running"`, returns a `jobId`, and supplies a `pollUrl`.

Status endpoint:

```text
GET /api/agent/jobs/<job-id>
Authorization: Bearer <KWA_ACTION_API_KEY>
```

The final compact response includes resolved product identity, identity confidence/ambiguity, decision/confidence dimensions, public and personalized prices, relay status, key reasons, strengths/weaknesses, missing information, evidence summaries/source URLs, source coverage, and safe errors.

The legacy endpoints remain for PWA/debug compatibility:

- `POST /api/research`
- `GET /api/jobs/*`

PC-only authenticated relay endpoints remain separate:

- `POST /api/relay/poll`
- `POST /api/relay/result`

## Custom GPT setup

Action schema:

```text
openapi/korea-web-agent-action.yaml
```

The schema defines:

- `startProductResearch` -> `POST /api/agent/research`
- `getProductResearchResult` -> `GET /api/agent/jobs/{id}`
- HTTP bearer authentication

In the Custom GPT Action configuration, use the separate `KWA_ACTION_API_KEY` as the bearer/API key credential. Keep the GPT private (`Only me`) for a personal deployment.

Recommended GPT behavior:

- Call `startProductResearch` for a concrete product when the user asks whether it is good, worth buying, currently cheap, a good value, or asks for review/price synthesis.
- Also call it for exact product specification research when public evidence is needed.
- If the result is `running`, call `getProductResearchResult` using `jobId` until a terminal state is returned within a bounded number of retries.
- Treat `INSUFFICIENT` as a valid outcome; do not invent a BUY/WAIT decision.
- Do not call the Action for unrelated casual questions.

## Netlify deployment

The repository contains `netlify.toml` and Netlify Functions. Research job and relay state use Netlify Blobs with strong consistency.

Production environment variables:

```text
KWA_RELAY_SECRET=<cryptographically-random relay secret>
KWA_ACTION_API_KEY=<different cryptographically-random Action API key>
```

After adding/changing either secret, trigger a fresh production deploy so Netlify Functions receive the updated environment.

Build configuration:

```text
Build command: npm run build
Publish directory: public
Functions directory: netlify/functions
```

The public PWA at the site root remains a diagnostic interface. Its manual relay checkbox is retained for backward-compatible testing; ChatGPT `/api/agent/*` determines relay use automatically from intent.

## Decision/confidence policy

The product report tracks independent confidence dimensions including:

- exact product identity
- usable current price
- official/spec evidence
- direct review evidence
- negative-signal coverage
- authenticated personalized-price coverage

Important invariants:

- unresolved/ambiguous identity -> `INSUFFICIENT`
- purchase-timing question without usable price -> not `BUY`/`WAIT`
- `WAIT` requires a usable price plus supported unattractive price/timing evidence
- general scientific evidence cannot establish exact-product confidence
- unrelated search results are excluded
- duplicate/syndicated evidence is not counted repeatedly
- many weak snippets cannot replace a missing required evidence dimension

## Source acquisition

The public research layer can query, when relevant:

- manufacturer/distributor pages
- Naver Shopping / Brand Store / SmartStore
- Coupang
- Danawa
- Naver Blog / Cafe
- YouTube
- Reddit/public communities
- news/recall sources
- official/certification sources
- peer-reviewed research when the question calls for it

Most Korean source families currently use public search metadata unless a direct page/structured-data or dedicated provider path succeeds. Direct sites may rate-limit server-side requests; the engine records blocked sources and degrades to other evidence instead of fabricating fields.

## Current v0.3 limitations

- The resolver is deterministic and conservative. Ambiguous products may require a model code or URL.
- Search-result metadata remains weaker than directly retrieved product/review pages.
- Site DOMs change; Naver/Coupang authenticated selectors include site-aware deterministic groups plus fallbacks, but they may require maintenance.
- Historical price tracking is not yet a durable price database. The engine can use discoverable price/discount signals but does not promise complete all-time-low history.
- Alternatives are not yet a dedicated recommendation subsystem; source evidence may expose them, but v0.3 prioritizes exact-product correctness first.
- One persistent relay job is active at a time in the current serverless relay design.

## Development and verification

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Tests cover URL safety, Shopping Live parsing, intent classification, query-only product resolution, ambiguity, exact-product matching, generic-evidence rejection, source planning, conservative search signals, price-gated decisions, confidence anti-inflation, relay signatures/sanitization, site-aware authenticated extraction, async relay merge, Action API contract/authentication, and deterministic WideView end-to-end acceptance.
