# Korea Web Agent v0.3 — ChatGPT Action Architecture

## 1. Goal

Move Korea Web Agent from a dashboard-first prototype to a ChatGPT-first product-research backend while preserving the existing PWA as a diagnostic surface.

The primary user experience is a dedicated Custom GPT named `Korea Web Agent`. The user should be able to ask a natural-language question such as:

> 와이드뷰 43인치 4K V3 스탠드 어때?

without manually opening the Netlify dashboard, pasting a URL, or toggling a relay checkbox. The GPT Action sends the natural-language query to the Korea Web Agent backend, which resolves the product, gathers evidence, conditionally uses the authenticated PC relay for purchase-oriented questions, and returns a structured result that ChatGPT can explain naturally.

Netlify remains the cloud backend. The PWA remains available for diagnostics and manual testing, but is no longer the primary product surface.

## 2. Scope

v0.3 focuses on product research. Place/service research remains compatible with existing interfaces but is not expanded in this milestone.

v0.3 must add:

- natural-language product resolution when no URL is supplied
- Naver Shopping Live product URL support
- explicit purchase-intent detection
- conditional local relay activation for price/purchase questions
- product-identity matching for search evidence
- confidence redesign based on coverage/quality rather than evidence count alone
- decision gating so BUY/WAIT are not emitted without price evidence when price is material
- a ChatGPT-oriented API endpoint
- an OpenAPI Action schema for a Custom GPT
- end-to-end verification using `와이드뷰 43인치 4K V3 스탠드 어때?`

v0.3 does not add purchasing, checkout, account mutation, messaging, review posting, or arbitrary browser automation.

## 3. Primary User Experience

### 3.1 Product question without URL

Input:

```text
와이드뷰 43인치 4K V3 스탠드 어때?
```

Expected flow:

1. Detect that this is a product/purchase-evaluation question.
2. Resolve the most likely exact product identity from public search results.
3. Require adequate identity confidence before exact-product research proceeds.
4. Gather current price, official specifications, retailer listings, real-user reviews, long-term complaints, A/S/warranty information, and meaningful alternatives.
5. Because the question asks whether the product is “어때?”, treat price/purchase value as material and request personalized fields from the PC relay when an eligible product URL is available and the connector is online.
6. Return a structured BUY / WAIT / SKIP / INSUFFICIENT decision with evidence coverage and unresolved gaps.
7. ChatGPT presents the result conversationally.

### 3.2 Specification-only question

Input:

```text
와이드뷰 V3 43인치 패널 스펙 알려줘
```

Expected flow:

- public product resolution and research only
- no PC relay
- no browser window should open merely for a specification lookup

### 3.3 Price-oriented question

Input:

```text
와이드뷰 V3 지금 사도 돼? 쿠폰까지 보면 얼마야?
```

Expected flow:

- public research
- local authenticated relay when available
- personalized price/coupon/membership/points/shipping fields merged into the final report

## 4. Intent Model

Introduce an explicit intent classifier with at least these dimensions:

- `product_research`: whether the question is about a product
- `purchase_decision`: whether BUY/WAIT/SKIP is expected
- `price_sensitive`: whether current price materially affects the answer
- `personalized_price_useful`: whether account-specific price/coupon/shipping information would improve the answer
- `spec_only`: whether the question can be answered without commerce/personalized data

The first implementation should be deterministic and testable. Korean lexical triggers should cover phrases such as:

- 어때
- 살만해 / 살만한지
- 지금 사 / 사도 돼
- 최저가
- 가격 괜찮아
- 가성비
- 쿠폰
- 멤버십
- 적립
- 배송
- 특가
- 기다려

A specification-only question must suppress relay use even if a product is successfully resolved.

The API may accept an explicit override later, but v0.3 defaults to automatic intent detection.

## 5. Product Resolver

### 5.1 Responsibilities

The Product Resolver converts either a URL or a natural-language product phrase into a normalized product target.

It must produce:

- brand
- product name
- model when available
- variant/size when available
- product ID when available
- canonical URL when available
- source host
- identity confidence
- identity evidence
- ambiguity status and alternate candidates when needed

### 5.2 Resolution order

For URL input:

1. Parse supported commerce URL patterns.
2. Attempt direct metadata/structured-data extraction.
3. Use relay title extraction when the URL is relay-eligible and public extraction cannot establish identity.
4. Use targeted public search as fallback.

For query-only input:

1. Extract candidate brand/model/size tokens from the question.
2. Run a small bounded discovery search before the broader source plan.
3. Rank candidates by exact model/token overlap, brand overlap, size/variant consistency, domain authority, and repeated agreement across independent results.
4. Resolve automatically only if one candidate clears the configured identity threshold and sufficiently exceeds the runner-up.
5. Otherwise return ambiguity and do not pretend that generic evidence belongs to an exact product.

### 5.3 Naver URL coverage

The Naver adapter must support at least:

- `brand.naver.com/<store>/products/<id>`
- `smartstore.naver.com/<store>/products/<id>`
- `m.smartstore.naver.com/<store>/products/<id>`
- `product.shoppinglive.naver.com/products/<id>`

For Shopping Live URLs there is no store slug in the path, so `productId` must be extracted without fabricating a brand/store name. Tracking parameters are removed from the canonical identity URL.

## 6. Evidence Matching

Search metadata must no longer be labeled `exact_product` merely because it came from a query intended for the product.

Each candidate evidence item receives an identity match level:

- `exact_product`
- `probable_product`
- `category`
- `general_mechanism`
- `unrelated`

`probable_product` may contribute to discovery but must be weaker than exact evidence. `unrelated` evidence is excluded from report scoring.

Exact-product matching should consider, when available:

- exact model code
- product ID
- brand
- meaningful product-name tokens
- size/capacity/generation/variant
- canonical retailer/manufacturer URL

A generic page about KC certification, product safety, TVs, beds, or consumer shopping must never become exact-product evidence solely because the search query contained the product name.

## 7. Source Plan Redesign

Source planning begins only after a useful product identity exists.

The default product plan should prioritize:

1. official manufacturer/distributor product page
2. exact retailer listings and current prices
3. price-comparison sources such as Danawa when discoverable
4. Naver/major retailer listings
5. verified or retailer-hosted reviews
6. Naver Blog/Cafe and other community reports
7. YouTube reviews
8. warranty/A/S and official safety/recall information
9. relevant alternatives
10. academic/general mechanism evidence only when the question actually benefits from it

Academic evidence is not a mandatory query for ordinary purchase questions. It should be invoked for questions involving ergonomics, health, material safety, performance mechanisms, or when the user explicitly requests scientific evidence.

The previous behavior that always queried generic safety and academic sources for every product must be removed.

## 8. Price Model

Extend price evidence so the report can distinguish:

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

The report should identify an `effectivePrice` using deterministic precedence appropriate to the available fields. Points must not silently be subtracted as cash unless explicitly represented as a separate effective-value calculation.

For purchase decisions, current price is a required decision dimension unless the question is explicitly about product quality regardless of price.

If current usable price cannot be established, the system must not emit BUY or WAIT based on price value. It should either:

- issue a non-price quality assessment while marking purchase timing `INSUFFICIENT`, or
- return overall `INSUFFICIENT` when the user explicitly asks whether to buy now.

## 9. Local Relay Policy

The local relay remains read-only and preserves the existing security boundary.

Relay should be requested automatically only when all are true:

1. the intent classifier marks `personalized_price_useful = true`
2. a relay-eligible canonical product URL is known
3. a relay secret is configured
4. the PC connector is online

The backend, not the PWA checkbox, decides this for the ChatGPT endpoint.

If the relay is unavailable, the request must continue with public data and clearly state that personalized price/coupon/delivery could not be checked.

The connector may return only normalized read-only fields already allowed by the protocol, including title, price, coupon/membership price, points, shipping, selected option, and availability. No password, cookie, token, localStorage, session identifier, or browser profile data may leave the PC.

CAPTCHA or step-up authentication stops that extraction path; no bypass is attempted.

## 10. Confidence Redesign

The current aggregate confidence formula compounds many independent-looking items toward 97%. That is unsuitable when search metadata is noisy.

v0.3 confidence is coverage-based, not count-based.

Use explicit dimensions such as:

- identity confidence
- current-price confidence
- official/spec confidence
- review evidence confidence
- negative-signal confidence
- warranty/safety confidence when relevant
- personalized-price confidence when requested

Each dimension is capped independently. Adding ten weak search snippets must not substitute for missing product identity or missing price.

The final report confidence is derived from required-dimension coverage plus evidence quality. It should be impossible for unrelated generic sources to push an unresolved product to 97%.

Exact thresholds belong in implementation tests, but the design requires these invariants:

- unresolved identity => low overall confidence and no BUY/WAIT/SKIP
- purchase-timing question with no usable price => no BUY/WAIT
- general-mechanism papers cannot establish exact-product confidence
- duplicate/syndicated sources count once
- confidence does not rise materially from repeated low-quality metadata from the same factual origin

## 11. Decision Rules

Output remains:

- `BUY`
- `WAIT`
- `SKIP`
- `INSUFFICIENT`

Decision gates:

### BUY
Requires:

- resolved exact product
- adequate exact-product quality/review evidence
- usable current price when purchase value is material
- no dominant repeated negative signal
- adequate decision confidence

### WAIT
Requires:

- resolved exact product
- acceptable product evidence
- usable current price
- evidence that timing/price is unattractive or a near-term better buying condition is supported

WAIT must not be a fallback for uncertainty.

### SKIP
Requires:

- resolved exact product or sufficiently specific variant/category when the reason clearly applies
- repeated credible negative evidence, poor value relative to alternatives, or a material product risk

### INSUFFICIENT
Used when:

- product identity is ambiguous
- current price is required but unavailable
- evidence is too generic/noisy
- source conflicts cannot be resolved
- personalized information was specifically required but unavailable and public information is insufficient

## 12. ChatGPT API

Add a ChatGPT-oriented endpoint:

```text
POST /api/agent/research
```

Primary request:

```json
{
  "query": "와이드뷰 43인치 4K V3 스탠드 어때?"
}
```

Optional URL may be supported:

```json
{
  "query": "이 제품 지금 사도 돼?",
  "url": "https://product.shoppinglive.naver.com/products/11458011168"
}
```

The endpoint automatically handles:

- category/intent classification
- product resolution
- relay policy
- public research
- report synthesis

The response must be compact and ChatGPT-friendly. It should expose structured fields rather than HTML, including:

- resolved product identity
- identity confidence/ambiguity
- decision
- decision confidence
- current public price
- personalized price if used
- relay status
- key reasons
- strengths
- weaknesses
- missing information
- relevant alternatives when available
- evidence summaries with source URLs
- source coverage

The existing `/api/research` endpoint remains for backward compatibility and PWA debugging.

## 13. Long-Running Action Behavior

PC relay completion can be asynchronous. The ChatGPT integration therefore needs a bounded action flow that does not depend on the PWA polling loop.

v0.3 should expose either:

- a synchronous agent endpoint that waits within a safe serverless budget and returns the final result when possible, plus a job/status response if still running; or
- a `start research` + `get research result` Action pair.

Preferred design: keep one conceptual `research_product` operation in the GPT instructions, while the OpenAPI schema may expose a start/status pair if required by execution limits.

The final implementation must not leave ChatGPT with a permanent `running` response and no retrievable result.

## 14. Custom GPT Action

Provide an OpenAPI schema suitable for a dedicated `Korea Web Agent` Custom GPT.

The GPT instructions should tell the model to call the research Action when the user asks about a concrete product, especially purchase value, current price, comparison, review synthesis, or whether to buy/wait/skip.

The GPT should not call the Action for unrelated casual questions.

The Action should be read-only from the user's perspective. The backend must not expose relay bearer secrets to the GPT.

If an Action-specific API key is introduced, it must be a separate cloud credential from `KWA_RELAY_SECRET`. The PC relay secret must never be reused as a client-facing GPT Action credential.

## 15. PWA Role in v0.3

The PWA remains available as an internal/manual diagnostic tool.

It should eventually display:

- resolved product identity
- whether relay was requested automatically
- whether relay was actually used
- per-dimension confidence
- decision-gate failures

However, cosmetic PWA work is secondary to the ChatGPT Action backend and can be deferred if it does not block testing.

## 16. Security

Existing security requirements remain mandatory:

- relay domains remain allowlisted
- relay jobs remain signed, expiring, and nonce-bearing
- no arbitrary remote JavaScript execution
- no credential-bearing URL support
- no private/local network URLs
- no purchase/payment/account mutation
- no CAPTCHA/MFA bypass
- relay result sanitization rejects secret-bearing keys

New ChatGPT endpoint requirements:

- strict request-size limits
- server-side URL validation
- rate limiting or abuse controls where practical
- no relay secret in Action schema, responses, logs, or client JavaScript
- if Action authentication is added, use a distinct credential

## 17. Error Handling

The system must degrade explicitly:

- resolver ambiguous -> return candidate ambiguity and `INSUFFICIENT`
- direct Naver fetch 429 -> continue through discovery/search and/or relay
- source blocked -> mark failed source, continue
- relay offline -> public-only research with clear personalized-data gap
- relay extraction returns no useful price -> do not claim personalized price was obtained
- product page changes DOM -> return missing fields rather than a guessed number
- conflicting model variants -> do not merge them as one exact product
- conflicting prices -> retain source/timestamp/option context

## 18. Testing Strategy

Use test-driven development for every behavior change.

Required new/changed tests:

1. Shopping Live URL parsing and tracking removal.
2. Intent classifier: purchase question enables relay policy; spec-only question suppresses it.
3. Query-only product resolution with a deterministic fake discovery provider.
4. Resolver ambiguity refuses exact-product classification.
5. Evidence matcher rejects generic KC/product-safety pages as exact-product evidence.
6. General research cannot drive exact-product confidence high.
7. Many unrelated snippets cannot create 97% confidence.
8. Purchase-timing question without price yields `INSUFFICIENT`, not WAIT.
9. WAIT requires a usable price signal.
10. Relay is queued automatically for price-sensitive questions when a canonical eligible URL is available and connector is online.
11. Relay is not queued for spec-only questions.
12. Relay title/price merge improves product identity and price dimensions without exposing unsupported fields.
13. ChatGPT endpoint accepts a query without URL.
14. ChatGPT endpoint returns a stable structured response schema.
15. Existing security/policy/relay tests continue to pass.

CI acceptance remains:

```text
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

## 19. Production Acceptance Test

The primary end-to-end acceptance query is:

```text
와이드뷰 43인치 4K V3 스탠드 어때?
```

A production pass requires:

1. The system identifies a concrete WideView 43-inch 4K V3 product or explicitly reports ambiguity.
2. Generic KCL/KTC/product-safety pages do not appear as top exact-product reasons unless they directly refer to the resolved product.
3. Irrelevant decades-old general product-safety papers are not automatically queried or used.
4. The system obtains a usable current public price or marks price unavailable.
5. For this purchase-evaluation wording, the relay is automatically attempted when an eligible product URL is resolved and the PC connector is online.
6. If personalized fields are returned, the final report clearly distinguishes them from public price data.
7. The final decision obeys the price and identity gates.
8. The final confidence is supported by dimension coverage, not evidence count.
9. ChatGPT can consume the response without the user visiting the PWA.

A second acceptance query verifies relay suppression:

```text
와이드뷰 V3 43인치 패널 스펙 알려줘
```

No local relay job should be created for that spec-only request.

## 20. Implementation Boundaries

Expected code areas include:

- `src/core/types.ts` — intent, identity confidence, match level, report coverage
- `src/adapters/naver-product.ts` — Shopping Live support
- new `src/orchestrator/intent.ts` — deterministic intent classification
- new `src/orchestrator/product-resolver.ts` — discovery/ranking/ambiguity
- new or revised evidence matching module — identity relevance
- `src/providers/source-plan.ts` — identity-aware conditional source planning
- `src/orchestrator/research.ts` — resolution-first orchestration
- `src/core/evidence.ts` — confidence model support
- `src/report/product-report.ts` — decision gates and dimension confidence
- `src/cloud/research-service.ts` — automatic relay policy using resolved URL/intent
- `src/relay/playwright-adapter.ts` — site-specific read-only extraction improvements as needed
- `src/relay/merge.ts` — merge title/price identity safely
- new `netlify/functions/agent-research.mjs` — ChatGPT-oriented endpoint
- `netlify.toml` — route for `/api/agent/research`
- `openapi/korea-web-agent-action.yaml` — Custom GPT Action schema
- tests for every invariant above

The exact file split may change during implementation if testing reveals a cleaner boundary, but the responsibilities and security constraints above must remain.

## 21. Non-Goals

Not part of v0.3:

- purchase or checkout automation
- automatic coupon claiming if it mutates account state
- writing reviews/comments/messages
- scraping or bypassing CAPTCHA
- exposing a local inbound port
- uploading browser profiles/cookies
- building a native mobile app
- implementing a full first-party adapter for every Korean commerce/community site
- replacing ChatGPT's natural-language presentation layer with a custom UI

## 22. Completion Criteria

v0.3 is complete only when:

1. All new and existing tests pass.
2. Typecheck/build/security audit pass.
3. Netlify production deploy succeeds.
4. `/api/agent/research` works without a URL for a concrete product phrase.
5. The production WideView acceptance query demonstrates correct identity handling, relevant evidence, correct price gating, and automatic relay behavior when available.
6. The spec-only acceptance query does not trigger relay.
7. The Custom GPT Action schema validates and can invoke the production backend.
8. The user can use the Korea Web Agent GPT without manually visiting the Netlify dashboard for normal product questions.
