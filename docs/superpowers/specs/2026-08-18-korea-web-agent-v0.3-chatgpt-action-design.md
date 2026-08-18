# Korea Web Agent v0.3 — ChatGPT Action Architecture

## 1. Goal

Move Korea Web Agent from a dashboard-first prototype to a ChatGPT-first product-research backend while preserving the existing PWA as a diagnostic surface.

The primary experience is a dedicated Custom GPT named `Korea Web Agent`. The user should be able to ask:

> 와이드뷰 43인치 4K V3 스탠드 어때?

without manually opening the Netlify dashboard, pasting a URL, or toggling a relay checkbox. The GPT Action sends the natural-language query to the Korea Web Agent backend, which resolves the product, gathers evidence, conditionally uses the authenticated PC relay for purchase-oriented questions, and returns a structured result that ChatGPT can explain naturally.

Netlify remains the cloud backend. The PWA remains available for diagnostics and manual testing, but is no longer the primary product surface.

## 2. Scope

v0.3 focuses on product research. Place/service research remains compatible with existing interfaces but is not expanded.

v0.3 adds:

- natural-language product resolution when no URL is supplied
- Naver Shopping Live product URL support
- deterministic purchase-intent detection
- conditional local relay activation for price/purchase questions
- product-identity matching for search evidence
- confidence based on coverage/quality rather than evidence count alone
- decision gates so BUY/WAIT are not emitted without required identity/price evidence
- a ChatGPT-oriented API
- a private Action API key separate from the PC relay secret
- an OpenAPI Action schema for a Custom GPT
- end-to-end verification using `와이드뷰 43인치 4K V3 스탠드 어때?`

v0.3 does not add purchasing, checkout, account mutation, messaging, review posting, CAPTCHA bypass, or arbitrary browser automation.

## 3. Primary User Experience

### 3.1 Purchase-evaluation question

Input:

```text
와이드뷰 43인치 4K V3 스탠드 어때?
```

Flow:

1. Detect product/purchase-evaluation intent.
2. Resolve the most likely exact product from public discovery results.
3. Require adequate identity confidence before exact-product research.
4. Gather current price, official specifications, retailer listings, real-user reviews, long-term complaints, A/S/warranty information, and meaningful alternatives.
5. Because `어때?` requests an overall purchase evaluation, treat price/value as material and request personalized fields from the PC relay when an eligible product URL is known and the connector is online.
6. Return BUY / WAIT / SKIP / INSUFFICIENT with dimension coverage and unresolved gaps.
7. ChatGPT presents the result conversationally.

### 3.2 Specification-only question

```text
와이드뷰 V3 43인치 패널 스펙 알려줘
```

Public product resolution/research only. No PC relay and no agent Chrome window merely for a specification lookup.

### 3.3 Explicit price question

```text
와이드뷰 V3 지금 사도 돼? 쿠폰까지 보면 얼마야?
```

Public research plus local authenticated relay when available. Personalized price/coupon/membership/points/shipping fields are merged into the report.

## 4. Intent Model

Introduce a deterministic, testable classifier with these fields:

- `productResearch`
- `purchaseDecision`
- `priceSensitive`
- `personalizedPriceUseful`
- `specOnly`

Korean triggers include phrases such as `어때`, `살만해`, `살만한지`, `지금 사`, `사도 돼`, `최저가`, `가격 괜찮아`, `가성비`, `쿠폰`, `멤버십`, `적립`, `배송`, `특가`, `기다려`.

`specOnly` suppresses relay even if a product is resolved. v0.3 uses automatic intent detection; no user-facing relay checkbox is required by the ChatGPT API.

## 5. Product Resolver

The Product Resolver converts either a URL or natural-language product phrase into a normalized target containing:

- brand
- product name
- model
- variant/size
- product ID
- canonical URL
- source host
- identity confidence
- identity evidence
- ambiguity status and alternate candidates

### URL resolution

1. Parse supported commerce patterns.
2. Attempt direct metadata/structured-data extraction.
3. For relay-eligible URLs, use authenticated title extraction when public extraction cannot establish identity and the request is already relay-eligible by intent.
4. Use targeted public discovery as fallback.

### Query-only resolution

1. Extract likely brand/model/size/generation tokens from the question.
2. Run a bounded discovery search before the broad source plan.
3. Rank candidates by exact model/token overlap, brand overlap, size/variant consistency, domain authority, and repeated agreement across independent results.
4. Resolve automatically only when the top candidate clears the identity threshold and sufficiently exceeds the runner-up.
5. Otherwise return ambiguity and `INSUFFICIENT`; never treat generic evidence as exact-product evidence.

### Naver URL coverage

Support at least:

- `brand.naver.com/<store>/products/<id>`
- `smartstore.naver.com/<store>/products/<id>`
- `m.smartstore.naver.com/<store>/products/<id>`
- `product.shoppinglive.naver.com/products/<id>`

Shopping Live has no store slug in the path, so its product ID is extracted without fabricating brand/store data. Tracking parameters are removed from canonical identity URLs.

## 6. Evidence Matching

Search results are not `exact_product` merely because the search query targeted a product.

Use identity match levels:

- `exact_product`
- `probable_product`
- `category`
- `general_mechanism`
- `unrelated`

`probable_product` may aid discovery but is weaker than exact evidence. `unrelated` evidence is excluded from report scoring.

Matching uses model code, product ID, brand, meaningful product-name tokens, size/capacity/generation/variant, and canonical manufacturer/retailer URL where available.

Generic pages about KC certification, product safety, TVs, beds, or shopping advice must never become exact-product evidence solely because the search query contained the product name.

## 7. Source Plan

Broad source research begins only after a useful product identity exists.

Priority:

1. official manufacturer/distributor product page
2. exact retailer listings/current prices
3. price-comparison sources such as Danawa when discoverable
4. Naver and other major retailer listings
5. verified or retailer-hosted reviews
6. Naver Blog/Cafe and other community reports
7. YouTube reviews
8. warranty/A/S and exact-product safety/recall information
9. relevant alternatives
10. academic/general mechanism evidence only when materially relevant

Academic evidence is not mandatory for ordinary shopping questions. It is requested for health, ergonomics, material safety, performance mechanisms, or explicit scientific-evidence requests.

The old behavior that automatically queried generic safety and academic sources for every product is removed.

## 8. Price Model

Price data distinguishes:

- public list price
- public sale price
- coupon price
- membership price
- estimated points/rewards
- shipping fee
- shipping ETA
- selected option/variant
- availability
- source URL
- retrieval time

`effectivePrice` uses deterministic precedence among actual payable prices. Points remain a separate value field and are not silently treated as cash.

For purchase decisions, current usable price is required unless the question explicitly asks about product quality irrespective of price.

If current usable price cannot be established:

- a quality-only assessment may still be produced, but purchase timing is `INSUFFICIENT`; and
- an explicit “지금 살까?” question returns overall `INSUFFICIENT`, not BUY or WAIT.

## 9. Local Relay Policy

Relay is automatically requested only when all are true:

1. `personalizedPriceUseful = true`
2. a relay-eligible canonical product URL is known
3. `KWA_RELAY_SECRET` is configured
4. the PC connector is online

The ChatGPT backend decides this; the PWA checkbox is irrelevant to the Action path.

If relay is unavailable, research continues with public data and explicitly reports that personalized price/coupon/delivery could not be checked.

Allowed relay output remains normalized read-only fields: title, price, coupon/membership price, points, shipping, selected option, and availability. Passwords, raw cookies, tokens, localStorage, session identifiers, and browser-profile data never leave the PC.

CAPTCHA/MFA stops that source; no bypass is attempted.

## 10. Confidence Model

Replace the current count-compounding confidence formula with dimension coverage.

Dimensions:

- identity confidence
- current-price confidence
- official/spec confidence
- review evidence confidence
- negative-signal confidence
- warranty/safety confidence when relevant
- personalized-price confidence when requested

Each dimension is independently capped. Ten weak snippets cannot substitute for missing identity or price.

Invariants:

- unresolved identity => low confidence and no BUY/WAIT/SKIP
- purchase-timing question with no usable price => no BUY/WAIT
- general-mechanism papers cannot establish exact-product confidence
- duplicate/syndicated factual origins count once
- repeated low-quality metadata cannot push overall confidence toward 97%

Implementation thresholds will be explicit constants covered by tests.

## 11. Decision Rules

Output remains `BUY`, `WAIT`, `SKIP`, or `INSUFFICIENT`.

### BUY

Requires resolved exact product, adequate exact-product quality/review evidence, usable current price when value is material, no dominant repeated negative signal, and adequate dimension coverage.

### WAIT

Requires resolved exact product, acceptable product evidence, usable current price, and actual evidence that current timing/value is unattractive or that a better buying condition is supported. WAIT is not a fallback for uncertainty.

### SKIP

Requires resolved exact product or sufficiently specific variant/category plus repeated credible negatives, materially poor value versus alternatives, or a material risk.

### INSUFFICIENT

Used for ambiguous identity, missing required price, generic/noisy evidence, unresolved variant conflicts, or insufficient data for the requested personalized comparison.

## 12. ChatGPT API

Add:

```text
POST /api/agent/research
GET  /api/agent/jobs/:id
```

`POST /api/agent/research` accepts:

```json
{
  "query": "와이드뷰 43인치 4K V3 스탠드 어때?"
}
```

or optionally:

```json
{
  "query": "이 제품 지금 사도 돼?",
  "url": "https://product.shoppinglive.naver.com/products/11458011168"
}
```

The endpoint performs intent classification, product resolution, relay policy, public research, and report synthesis.

### Action authentication

All `/api/agent/*` routes require a separate bearer secret stored as:

```text
KWA_ACTION_API_KEY
```

This credential is configured in the Custom GPT Action authentication settings and Netlify environment. It must be distinct from `KWA_RELAY_SECRET`. The relay secret is never exposed to ChatGPT.

### Response shape

Expose compact structured fields:

- resolved product identity and ambiguity
- identity confidence
- decision and decision confidence
- per-dimension confidence/coverage
- current public price
- personalized price if used
- relay status
- key reasons
- strengths
- weaknesses
- missing information
- alternatives when available
- evidence summaries/source URLs
- source coverage

The existing `/api/research` remains for PWA/backward compatibility.

## 13. Long-Running Action Behavior

This is resolved as a start/status contract rather than an unspecified synchronous wait.

`POST /api/agent/research` returns:

- HTTP 200 with a final result if the job completes during the initial request; or
- HTTP 202 with `jobId`, `status`, and `pollPath` when relay/public research is still running.

`GET /api/agent/jobs/:id` returns the current/final structured result.

The OpenAPI Action exposes two operations:

- `researchProduct`
- `getResearchResult`

GPT instructions tell the model to call `getResearchResult` when `researchProduct` returns `running`. Polling is bounded: at most 6 status calls per user request, with the backend returning a useful public-only partial/final state if relay does not complete in time. A request must not remain permanently `running` with no retrievable report.

## 14. Custom GPT Action

Provide `openapi/korea-web-agent-action.yaml` for the dedicated `Korea Web Agent` GPT.

The GPT instructions call the Action for concrete product research, purchase value, current price, comparison, review synthesis, or BUY/WAIT/SKIP questions. It does not call the Action for unrelated casual questions.

The Action is read-only. The only client-facing credential is `KWA_ACTION_API_KEY`; `KWA_RELAY_SECRET` remains PC/cloud-internal.

## 15. PWA Role

The PWA remains an internal/manual diagnostic tool. Cosmetic work is secondary.

Useful diagnostic additions may show resolved identity, automatic relay decision, actual relay use, dimension confidence, and decision-gate failures, but these are not prerequisites for the ChatGPT Action launch unless needed to debug production failures.

## 16. Security

Existing requirements remain mandatory:

- relay domains allowlisted
- signed/expiring/nonce-bearing relay jobs
- no arbitrary remote JavaScript execution
- no credential-bearing URLs
- no private/local network URLs
- no purchase/payment/account mutation
- no CAPTCHA/MFA bypass
- relay result secret-key rejection

ChatGPT API requirements:

- strict request-size limits
- server-side URL validation
- bearer authentication with `KWA_ACTION_API_KEY`
- no secrets in responses/logs/client JavaScript/OpenAPI examples
- basic per-key request throttling in-process/serverless-safe where feasible; hard external rate limiting is not required for v0.3 acceptance

## 17. Error Handling

- resolver ambiguous -> candidates + `INSUFFICIENT`
- direct Naver fetch 429 -> continue through discovery/search and/or relay
- source blocked -> record failure and continue
- relay offline -> public-only with explicit personalized-data gap
- relay returns no usable price -> do not claim personalized price obtained
- DOM changed -> missing field, never guessed value
- model/variant conflict -> do not merge as one exact product
- conflicting prices -> retain source/timestamp/option context
- Action auth failure -> HTTP 401 without revealing credential details

## 18. Testing Strategy

Use TDD for every behavior change.

Required tests:

1. Shopping Live URL parsing/tracking removal.
2. Purchase intent enables relay policy; spec-only suppresses it.
3. Query-only product resolution with deterministic fake discovery results.
4. Resolver ambiguity refuses exact-product classification.
5. Evidence matcher rejects generic KC/product-safety pages as exact-product evidence.
6. General research cannot drive exact-product confidence high.
7. Many unrelated snippets cannot produce 97% confidence.
8. Purchase-timing question without price yields `INSUFFICIENT`, not WAIT.
9. WAIT requires a usable price signal.
10. Relay auto-queues for price-sensitive questions when canonical eligible URL exists and connector is online.
11. Relay does not queue for spec-only questions.
12. Relay title/price merge improves identity/price dimensions without unsupported fields.
13. ChatGPT endpoint accepts query without URL.
14. ChatGPT start/status API returns stable schemas.
15. `/api/agent/*` rejects missing/wrong Action API key.
16. Existing security/policy/relay tests continue to pass.

Acceptance commands:

```text
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

## 19. Production Acceptance

Primary query:

```text
와이드뷰 43인치 4K V3 스탠드 어때?
```

Pass requires:

1. Resolve a concrete WideView 43-inch 4K V3 product or explicitly report ambiguity.
2. Generic KCL/KTC/product-safety pages are not top exact-product reasons unless they directly refer to the resolved product.
3. Irrelevant old general product-safety papers are not automatically queried/used.
4. Obtain a usable current public price or mark it unavailable.
5. Because this is a purchase-evaluation question, automatically attempt relay when an eligible URL is resolved and the PC connector is online.
6. Personalized fields are clearly separated from public price data.
7. Decision obeys identity/price gates.
8. Confidence reflects dimension coverage, not source count.
9. Custom GPT obtains the result without the user visiting the PWA.

Relay-suppression query:

```text
와이드뷰 V3 43인치 패널 스펙 알려줘
```

No local relay job is created.

## 20. Implementation Boundaries

Expected areas:

- `src/core/types.ts` — intent, match levels, confidence dimensions
- `src/adapters/naver-product.ts` — Shopping Live support
- new `src/orchestrator/intent.ts`
- new `src/orchestrator/product-resolver.ts`
- new/revised evidence matcher
- `src/providers/source-plan.ts` — conditional identity-aware planning
- `src/orchestrator/research.ts` — resolution-first orchestration
- `src/core/evidence.ts` — coverage scoring support
- `src/report/product-report.ts` — decision gates/dimension confidence
- `src/cloud/research-service.ts` — automatic relay policy using resolved URL/intent
- `src/relay/playwright-adapter.ts` — site-specific read-only extraction refinements
- `src/relay/merge.ts` — safe title/price merge
- new `netlify/functions/agent-research.mjs`
- new `netlify/functions/agent-job.mjs`
- `netlify.toml` — `/api/agent/research` and `/api/agent/jobs/*`
- `openapi/korea-web-agent-action.yaml`
- tests for all invariants

Exact file splits may change if tests reveal a cleaner boundary, but responsibilities/security constraints remain.

## 21. Non-Goals

- purchase/checkout automation
- account-mutating coupon claims
- writing reviews/comments/messages
- CAPTCHA bypass
- local inbound port exposure
- browser profile/cookie upload
- native mobile app
- first-party adapter for every Korean site
- replacing ChatGPT's natural-language presentation with a custom UI

## 22. Completion Criteria

v0.3 is complete only when:

1. New and existing tests pass.
2. Typecheck/build/security audit pass.
3. Netlify production deploy succeeds.
4. `/api/agent/research` works from a natural-language product phrase without URL.
5. Production WideView acceptance demonstrates correct identity handling, relevant evidence, correct price gating, and automatic relay when available.
6. Spec-only acceptance does not trigger relay.
7. The OpenAPI Action schema validates and invokes production with `KWA_ACTION_API_KEY`.
8. The user can use the Korea Web Agent GPT without manually visiting the Netlify dashboard for normal product questions.
