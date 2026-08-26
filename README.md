# Korea Web Agent v0.6.2

Korea Web Agent is a read-only Korean product-research backend designed to be called from a dedicated Custom GPT. The primary experience is now natural-language product research inside ChatGPT; the existing PWA remains available as a diagnostic/manual testing surface.

Example:

```text
와이드뷰 43인치 4K V3 스탠드 어때?
```

The agent resolves an exact product or a recommendation category, gathers attributable public evidence, normalizes multi-market offers, and conditionally asks a locally authenticated PC browser to verify up to eight difficult commerce pages. It separates cash, owned-card, public conditional, account-personalized, points-adjusted, refurb/open-box, and used prices and returns a conservative `BUY / WAIT / SKIP / INSUFFICIENT` result plus Best 3 recommendations when appropriate.

## v0.6.2 Provider v2 coverage

- Provider v2 executes 13 required domestic commerce channels in a deterministic registry: Naver Shopping, Coupang, Danawa, Enuri, 11st, Gmarket, Auction, SSG, Lotte ON, Lotte Hi-Mart, official stores, Kakao TalkDeal, and Toss Shopping.
- Danawa and Enuri comparison-page prices are discovery signals only. Seller expansion follows the downstream seller and verifies exact identity, price, and shipping before an offer can become decisive.
- Exact SKU, variant, bundle, condition, availability, shipping, and verification tier are part of offer eligibility. Unknown or non-deterministic mandatory shipping/fees cannot win the cash ranking.
- `totalCashPrice`, owned-card `cardPrice`, public `publicConditional`, account/personalized values, and points-adjusted `effectivePrice` are ranked separately. A public coupon/payment condition does not masquerade as unconditional cash.
- Active unconditional public deals such as an eligible TalkDeal may qualify as cash; public conditional deals require their current promotion condition to be verified; account-only prices remain personalization.
- AliExpress and Temu are outside the 13 required Provider v2 execution set in v0.6.2. They may still appear through legacy/general discovery, but they do not satisfy required domestic provider coverage.
- Login-only/account-personalized values are optional Relay enrichment. They never replace public cash history or override a verified public cash winner.
- Request-scoped `paymentMethods` supports public conditions such as Toss Pay, Kakao Pay, Naver Pay, and PAYCO without requiring a persistent user profile.
- Exact normalized SKU public-cash observations are retained for 183 days to report previous-price movement and six-month position; deduped comparison/search evidence and personalized Relay values are excluded from that history.
- ChatGPT Action research is queued into a Netlify Background Function so long-running public research does not depend on the user's PC.
- Search metadata and comparison advertisements remain discovery-grade; decisive offers require the stronger identity/price/shipping gates defined by the provider pipeline.
- The signed read-only Relay can inspect a bounded batch of at most eight URLs in one browser session.
- Category questions such as bedding selection produce up to five scored candidates and a Best 3 based on fit, quality, reviews, design, care, risk, and value.
- `manualChecks` contains only login/CAPTCHA, card/membership ownership, offline quote, availability, or used-condition checks that require a person.

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
Netlify /api/agent/research
   |
   +--> queued job state in Netlify Blobs
   |
   +--> Netlify Background Function
           |
           +--> resolver -> multi-source public research -> offer/report engine
           |
           +--> 183-day exact-SKU price history
           |
           +--> optional persistent Relay queue
                    ^
                    | outbound HTTPS polling with KWA_RELAY_SECRET
                    |
             Windows Local Agent -> dedicated logged-in Chrome profile
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

After cloning/updating the repository, install dependencies once and register the per-user Local Agent:

```powershell
cd "$HOME\korea-web-agent"
npm ci
npm install --no-save playwright-core

$secret = Read-Host "Netlify Relay Secret" -AsSecureString
.\scripts\install-local-agent.ps1 -RelaySecret $secret
```

The installer encrypts the relay secret with Windows DPAPI, restricts the local configuration file ACL, and registers a hidden `KoreaWebAgent` Scheduled Task at user logon. The scheduled-task arguments never contain the relay secret. Normal daily use does not require opening PowerShell.

To remove automatic startup while preserving the encrypted local configuration:

```powershell
.\scripts\uninstall-local-agent.ps1
```

To remove both the task and local configuration:

```powershell
.\scripts\uninstall-local-agent.ps1 -RemoveConfig
```

The Local Agent repeatedly makes outbound HTTPS requests:

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

Recommendation request with actual purchase context:

```json
{
  "query": "에이스 하이테크 레드 침대에 어울리는 퀸 이불을 디자인, 품질, 리뷰, 관리, 가격까지 비교해 Best 3 추천해줘",
  "purchaseContext": {
    "paymentMethods": ["토스페이", "카카오페이"],
    "memberships": ["네이버플러스"],
    "budget": 300000,
    "region": "서울",
    "preferences": ["세탁기 가능", "사계절", "먼지 적음"]
  }
}
```

Optional URL request:

```json
{
  "query": "이 제품 지금 사도 돼?",
  "url": "https://product.shoppinglive.naver.com/products/11458011168"
}
```

`POST /api/agent/research` queues the cloud job and returns `status: "queued"`, a `jobId`, and `pollUrl`. Poll while the status is `queued` or `running`. A running result may mean the Background Function is still researching or that optional authenticated Relay enrichment is pending.

Status endpoint:

```text
GET /api/agent/job?jobId=<job-id>
Authorization: Bearer <KWA_ACTION_API_KEY>
```

The final compact response includes resolved identity, decision/confidence dimensions, public/personalized prices, normalized `offers`, independent `bestOffers`, `marketCoverage`, Best 3+ `recommendations`, `priceHistory`, member/non-member `membershipScenarios`, `eventWindow`, stable `standardPriceRows`, `manualChecks`, relay status, evidence summaries/source URLs, and safe errors.

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
- `getProductResearchResult` -> `GET /api/agent/job?jobId=<job-id>`
- HTTP bearer authentication

In the Custom GPT Action configuration, use the separate `KWA_ACTION_API_KEY` as the bearer/API key credential. Keep the GPT private (`Only me`) for a personal deployment.

Recommended GPT behavior:

- Call `startProductResearch` for a concrete product when the user asks whether it is good, worth buying, currently cheap, a good value, or asks for review/price synthesis.
- Also call it for exact product specification research when public evidence is needed.
- If the result is `queued` or `running`, call `getProductResearchResult` using `jobId` until a terminal state is returned within a bounded number of retries.
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

Provider v2 required domestic commerce coverage is the 13-channel registry listed above. The broader public research layer may also query, when relevant:

- manufacturer/distributor pages
- Naver Shopping / Brand Store / SmartStore
- Coupang
- Danawa and Enuri comparison discovery
- 11st, Gmarket, Auction, SSG, Lotte ON, and Lotte Hi-Mart
- official-store discovery
- Kakao TalkDeal and Toss Shopping
- AliExpress and Temu as non-required legacy/general discovery sources
- refurb, return, and display listings
- Karrot, Joonggonara, and Bunjang
- Naver Blog / Cafe
- YouTube
- Reddit/public communities
- news/recall sources
- official/certification sources
- peer-reviewed research when the question calls for it

Search/comparison metadata is discovery-grade. Provider v2 expands comparison results to attributable downstream seller pages where applicable; decisive purchase economics require exact identity plus usable page/checkout price and deterministic mandatory shipping. Direct sites may rate-limit server-side requests; the engine records blocked sources and degrades to other evidence instead of fabricating fields.

## Current limitations

- The resolver is deterministic and conservative. Ambiguous products may require a model code or URL.
- Search-result metadata remains weaker than directly retrieved product/review pages.
- Site DOMs change; Naver/Coupang authenticated selectors include site-aware deterministic groups plus fallbacks, but they may require maintenance.
- Exact-SKU public cash observations are retained for a rolling 183-day window. This supports six-month-relative analysis but does not prove an all-time historical low or fill periods before the SKU was first observed.
- Search engines and commerce sites can omit or stale-index conditional prices; `verification` and `retrievedAt` must be shown with the result.
- Local/offline and used listings remain region-, availability-, and condition-dependent and require the emitted manual check.
- Recommendation scoring is deterministic and evidence-aware, but visual fit is text-signal based unless the caller supplies explicit colors/materials/preferences.
- Multiple Relay jobs can remain queued without overwriting each other. A PC connector processes signed read-only jobs sequentially, with each batch bounded to eight pages.

## Development and verification

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Tests cover URL safety, Shopping Live parsing, intent classification, query-only product resolution, ambiguity, exact-product matching, generic-evidence rejection, source planning, conservative search signals, provider-registry coverage, downstream seller expansion, shipping and promotion gates, economic dedupe/cache behavior, public-history isolation, price-gated decisions, confidence anti-inflation, relay signatures/sanitization, site-aware authenticated extraction, async relay merge, Action API contract/authentication, and deterministic WideView v0.6.2 end-to-end acceptance.
