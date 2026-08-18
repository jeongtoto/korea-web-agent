# Korea Web Agent v0.3 ChatGPT Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Korea Web Agent usable from a dedicated Custom GPT with natural-language product queries, accurate product resolution/evidence matching, conditional PC relay use for purchase-oriented questions, and conservative BUY/WAIT/SKIP/INSUFFICIENT decisions.

**Architecture:** Keep Netlify as the backend and the current outbound PC relay as the authenticated read-only browser bridge. Add deterministic intent classification and product resolution before the broad research plan, match every search result against the resolved product before scoring it, replace count-compounding confidence with dimension coverage, and expose a ChatGPT-oriented start/status API plus an OpenAPI Action schema.

**Tech Stack:** TypeScript, Node.js 22+, Netlify Functions, Netlify Blobs, Playwright Core local connector, Node built-in test runner, OpenAPI 3.1.

**Spec:** `docs/superpowers/specs/2026-08-18-korea-web-agent-v0.3-chatgpt-action-design.md`

## Global Constraints

- Node.js version floor remains `>=22`.
- PC relay remains read-only and may return only allowlisted normalized fields.
- Passwords, cookies, access/session tokens, localStorage/sessionStorage, browser-profile files, and relay secrets never leave the PC or appear in Action responses/logs.
- No purchase, payment, cancellation, account mutation, review/comment/message creation, CAPTCHA bypass, or MFA bypass.
- `KWA_RELAY_SECRET` must never be reused as a ChatGPT Action credential.
- Existing `/api/research` remains backward compatible for the PWA.
- Query-only product research must not fabricate a product identity when discovery is ambiguous.
- BUY/WAIT must not be emitted for a price-sensitive purchase-timing question without a usable current price.
- General safety pages and general scientific literature never count as direct proof of an exact commercial product.

---

## File Structure

New focused units:

- `src/core/intent.ts` — deterministic question intent classification and relay policy hints.
- `src/core/product-match.ts` — product token normalization, candidate scoring, and evidence match classification.
- `src/orchestrator/product-resolver.ts` — bounded discovery search that resolves a normalized target from text or URL metadata.
- `src/agent/research.ts` — ChatGPT-facing orchestration wrapper that resolves intent/product, selects relay policy, calls cloud research, and shapes the response.
- `netlify/functions/agent-research.mjs` — starts ChatGPT-oriented research.
- `netlify/functions/agent-job.mjs` — returns compact status/final result for Action polling.
- `openapi/korea-web-agent-action.yaml` — Custom GPT Action schema.

Existing files modified:

- `src/core/types.ts` — new intent, identity, match-level, confidence-dimension, and agent-response types.
- `src/adapters/naver-product.ts` — Shopping Live URL support.
- `src/providers/source-plan.ts` — product-identity-first source planning; academics only when relevant.
- `src/orchestrator/research.ts` — evidence matching before normalization; no generic exact-product labeling.
- `src/core/evidence.ts` — scoring supports probable/category/general specificity and no count-based aggregate confidence for product decisions.
- `src/report/product-report.ts` — dimension coverage, price gates, conservative decisions.
- `src/cloud/research-service.ts` — automatic relay flag accepted from agent layer; async job flow preserved.
- `src/relay/protocol.ts` — title/price fields remain allowlisted; no security weakening.
- `src/relay/merge.ts` — relay title may strengthen identity; empty personalized price does not count as successful price evidence.
- `src/relay/playwright-adapter.ts` — site-aware deterministic selectors for Naver/Shopping Live/Coupang while retaining generic fallbacks.
- `netlify.toml` — redirects for `/api/agent/research` and `/api/agent/jobs/*`.
- `README.md` — v0.3 usage and Custom GPT setup.
- `.github/workflows/production-smoke.yml` — validate new public Action routes without requiring the PC to be online.

---

### Task 1: Intent classification and Shopping Live URL support

**Files:**
- Create: `src/core/intent.ts`
- Modify: `src/core/types.ts`
- Modify: `src/adapters/naver-product.ts`
- Test: `tests/intent.test.ts`
- Test: `tests/naver-product.test.ts`

**Interfaces:**
- Produces: `classifyResearchIntent(question: string): ResearchIntent`
- Produces: `ResearchIntent` with `productResearch`, `purchaseDecision`, `priceSensitive`, `personalizedPriceUseful`, `specOnly`.
- Produces: `parseNaverProductUrl(input: string): NormalizedTarget | null` with Shopping Live support.

- [ ] **Step 1: Write failing intent tests**

```ts
assert.deepEqual(classifyResearchIntent('와이드뷰 43인치 4K V3 스탠드 어때?'), {
  productResearch: true,
  purchaseDecision: true,
  priceSensitive: true,
  personalizedPriceUseful: true,
  specOnly: false,
});

assert.equal(classifyResearchIntent('와이드뷰 V3 43인치 패널 스펙 알려줘').specOnly, true);
assert.equal(classifyResearchIntent('와이드뷰 V3 43인치 패널 스펙 알려줘').personalizedPriceUseful, false);
```

- [ ] **Step 2: Add Shopping Live parser test**

```ts
const target = parseNaverProductUrl('https://product.shoppinglive.naver.com/products/11458011168?prdFrom=x&NaPm=y');
assert.equal(target?.kind, 'product');
assert.equal(target?.productId, '11458011168');
assert.equal(target?.sourceHost, 'product.shoppinglive.naver.com');
assert.equal(target?.brand, undefined);
assert.equal(target?.canonicalUrl, 'https://product.shoppinglive.naver.com/products/11458011168');
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- --test-name-pattern='intent|Shopping Live'
```

Expected: missing intent module and Shopping Live parser assertions fail.

- [ ] **Step 4: Implement deterministic intent classifier**

Use normalized Korean text and explicit trigger groups. `specOnly` wins when specification-only phrases are present without price/purchase triggers. `어때`, `살만`, `지금 사`, `가성비`, `가격`, `최저가`, `쿠폰`, `멤버십`, `적립`, `배송`, `특가`, `기다` mark purchase/price sensitivity as appropriate.

- [ ] **Step 5: Extend Naver parser**

For `product.shoppinglive.naver.com/products/<id>`, extract only the numeric product ID and canonical URL; do not infer a brand/store slug.

- [ ] **Step 6: Run focused tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='intent|Shopping Live'
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/intent.ts src/core/types.ts src/adapters/naver-product.ts tests/intent.test.ts tests/naver-product.test.ts
git commit -m 'feat: classify purchase intent and support Naver Shopping Live URLs'
```

---

### Task 2: Product identity matching and query-only resolver

**Files:**
- Create: `src/core/product-match.ts`
- Create: `src/orchestrator/product-resolver.ts`
- Modify: `src/core/types.ts`
- Test: `tests/product-match.test.ts`
- Test: `tests/product-resolver.test.ts`

**Interfaces:**
- Produces: `ProductMatchLevel = 'exact_product' | 'probable_product' | 'category' | 'general_mechanism' | 'unrelated'`.
- Produces: `matchEvidenceToProduct(target, hit): ProductMatchResult`.
- Produces: `resolveProduct(request, deps): Promise<ProductResolution>`.
- `ProductResolution` contains `target`, `confidence`, `ambiguous`, `candidates`, `identityEvidence`.

- [ ] **Step 1: Write evidence-match RED tests**

```ts
const target = { kind: 'product', brand: '와이드뷰', name: '43인치 4K V3 스탠드', model: 'V3' } as const;
assert.equal(matchEvidenceToProduct(target, {
  title: '와이드뷰 43인치 4K V3 이동식 스마트TV',
  url: 'https://example.com/v3',
  snippet: '와이드뷰 V3 43인치',
}).level, 'exact_product');

assert.equal(matchEvidenceToProduct(target, {
  title: 'KCL 안전인증 KC 생활용품',
  url: 'https://kcl.re.kr/kc',
  snippet: '제품 안전성 시험검사',
}).level, 'unrelated');
```

- [ ] **Step 2: Write resolver RED tests**

Use a fake discovery search where multiple independent hits agree on the same brand/model/size and assert the resolver chooses that product. Add a competing candidate with similar words and assert `ambiguous: true` when the score gap is below the configured margin.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
npm test -- --test-name-pattern='product match|resolver'
```

- [ ] **Step 4: Implement token normalization and candidate scoring**

Normalize case, spacing, punctuation, inch notation, model tokens, and meaningful Hangul/Latin tokens. Strong weights: exact model code, product ID, matching numeric variant/size, brand. Weak weights: generic category words such as `TV`, `모니터`, `침대`, `제품`.

- [ ] **Step 5: Implement bounded resolver discovery**

For query-only requests, call a small number of discovery queries such as the raw product phrase and targeted retailer/official searches. Group candidate URLs/titles by normalized identity. Resolve only above an identity threshold and margin over runner-up; otherwise preserve candidates and mark ambiguity.

- [ ] **Step 6: Run focused tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='product match|resolver'
```

- [ ] **Step 7: Commit**

```bash
git add src/core/product-match.ts src/orchestrator/product-resolver.ts src/core/types.ts tests/product-match.test.ts tests/product-resolver.test.ts
git commit -m 'feat: resolve product identity before research'
```

---

### Task 3: Evidence pipeline and source-plan cleanup

**Files:**
- Modify: `src/providers/source-plan.ts`
- Modify: `src/orchestrator/research.ts`
- Modify: `src/core/evidence.ts`
- Test: `tests/source-plan.test.ts`
- Test: `tests/orchestrator.test.ts`
- Test: `tests/evidence.test.ts`

**Interfaces:**
- Consumes: resolved `NormalizedTarget` and `matchEvidenceToProduct`.
- Produces: search evidence whose specificity is derived from actual identity match, not from the source-plan intention.

- [ ] **Step 1: Add RED test preventing generic exact-product evidence**

A search result titled `KCL 안전인증 KC 생활용품` returned from the `official` query must not have `specificity: 'exact_product'` for a WideView V3 target and must not contribute as exact-product evidence.

- [ ] **Step 2: Add RED test for academic gating**

For `와이드뷰 43인치 4K V3 스탠드 어때?`, `buildSourcePlan` must not emit an academic query. For `눈 피로 관련 연구까지 봐줘`, academic search may be emitted with `general_mechanism` specificity.

- [ ] **Step 3: Add confidence anti-inflation RED test**

Create 20 unrelated/search-metadata items and assert aggregate report confidence cannot approach 0.97 and cannot create a purchase decision.

- [ ] **Step 4: Implement evidence matching in the orchestrator**

Before converting a `SearchHit` into `EvidenceItem`, call `matchEvidenceToProduct`. Drop `unrelated`; map `probable_product` to weaker category/probable specificity and reduced confidence. Exact product requires actual identity support.

- [ ] **Step 5: Remove mandatory generic safety/academic queries**

The default source plan keeps commerce, reviews, community, video, news/recall where relevant. Academic search is conditional on health/ergonomics/material-safety/performance-mechanism intent or explicit user request.

- [ ] **Step 6: Change aggregate confidence behavior**

Keep per-item `scoreEvidence`, but ensure product decision confidence is no longer a compounding probability over arbitrary item count. The product report in Task 4 becomes the authoritative confidence source.

- [ ] **Step 7: Run tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='source plan|orchestrator|confidence'
```

- [ ] **Step 8: Commit**

```bash
git add src/providers/source-plan.ts src/orchestrator/research.ts src/core/evidence.ts tests/source-plan.test.ts tests/orchestrator.test.ts tests/evidence.test.ts
git commit -m 'fix: match evidence to resolved product identity'
```

---

### Task 4: Coverage-based confidence and conservative decision gates

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/report/product-report.ts`
- Test: `tests/product-report.test.ts`

**Interfaces:**
- Produces: `ProductConfidenceDimensions` with at least `identity`, `price`, `officialSpecs`, `reviews`, `negativeSignals`, `personalizedPrice`.
- `ProductReport` exposes the dimension object and an overall confidence derived from required coverage.

- [ ] **Step 1: Add purchase-price RED tests**

```ts
const report = buildProductReport({
  target,
  evidence: strongExactProductReviewsWithoutAnyPrice,
  intent: { purchaseDecision: true, priceSensitive: true, personalizedPriceUseful: true, productResearch: true, specOnly: false },
  identityConfidence: 0.95,
});
assert.equal(report.decision, 'INSUFFICIENT');
assert.ok(report.missingInformation.some((x) => /가격/.test(x)));
```

Add a WAIT test that includes a usable current price and a negative `priceSignal`. Add a BUY test with resolved identity, price, and strong product evidence.

- [ ] **Step 2: Add unresolved identity RED test**

Identity confidence below threshold must force `INSUFFICIENT` regardless of evidence count.

- [ ] **Step 3: Implement price derivation and effective-price metadata**

Recognize public structured offers and personalized `salePrice`, `couponPrice`, `membershipPrice`, `shippingFee`. Do not silently subtract points as cash; surface points separately.

- [ ] **Step 4: Implement dimension confidence**

Use capped, interpretable dimensions. Example weighting for a purchase decision: identity 30%, price 25%, exact product quality/reviews 25%, official/spec 10%, negative-signal coverage 10%. Required dimensions cap overall confidence when absent. Repeated weak snippets cannot fill a missing dimension.

- [ ] **Step 5: Implement decision gates**

`WAIT` requires usable price plus a supported unattractive timing/price signal. `BUY` requires usable price when price is material. `SKIP` requires repeated credible negatives or poor value. Uncertainty uses `INSUFFICIENT`, never WAIT by default.

- [ ] **Step 6: Run product report tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='product report|BUY|WAIT|SKIP|INSUFFICIENT'
```

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/report/product-report.ts tests/product-report.test.ts
git commit -m 'fix: gate purchase decisions on identity and price coverage'
```

---

### Task 5: Relay auto-policy and stronger authenticated extraction

**Files:**
- Modify: `src/cloud/research-service.ts`
- Modify: `src/relay/playwright-adapter.ts`
- Modify: `src/relay/merge.ts`
- Test: `tests/cloud-research.test.ts`
- Test: `tests/playwright-adapter.test.ts`
- Test: `tests/relay-merge.test.ts`

**Interfaces:**
- Consumes: agent-layer decision `includeLocalRelay` derived from intent.
- Produces: normalized relay fields and optional relay title that can strengthen product identity.

- [ ] **Step 1: Add relay-policy RED tests**

An online connector plus a resolved relay-eligible URL and purchase-sensitive intent must queue a relay job. A spec-only query must not queue a relay job even when the connector is online.

- [ ] **Step 2: Add Shopping Live extraction RED test**

Fake driver returns title, sale price, coupon/membership price, points, shipping and availability from Shopping Live-specific selector groups. Assert all supported normalized fields are returned.

- [ ] **Step 3: Add empty-result RED test**

A relay result containing only `currency: 'KRW'` must not create a false personalized-price success dimension.

- [ ] **Step 4: Implement site-aware deterministic selector sets**

Choose selectors by hostname (`brand.naver.com`, `smartstore.naver.com`, `product.shoppinglive.naver.com`, `coupang.com`) and retain generic fallbacks. Continue navigation/read-only behavior only.

- [ ] **Step 5: Strengthen relay merge semantics**

Use returned title as identity support when consistent with the resolved target. Only mark personalized price coverage when at least one useful price/shipping/availability field is present.

- [ ] **Step 6: Run relay tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='relay|Shopping Live|authenticated extraction'
```

- [ ] **Step 7: Commit**

```bash
git add src/cloud/research-service.ts src/relay/playwright-adapter.ts src/relay/merge.ts tests/cloud-research.test.ts tests/playwright-adapter.test.ts tests/relay-merge.test.ts
git commit -m 'feat: auto-use authenticated relay for purchase questions'
```

---

### Task 6: ChatGPT agent service and Netlify endpoints

**Files:**
- Create: `src/agent/research.ts`
- Create: `netlify/functions/agent-research.mjs`
- Create: `netlify/functions/agent-job.mjs`
- Modify: `netlify.toml`
- Test: `tests/agent-research.test.ts`
- Test: `tests/netlify-agent-functions.test.ts`

**Interfaces:**
- `POST /api/agent/research` request: `{ query: string, url?: string }`.
- Initial response: compact agent job result. If relay is pending, include `jobId`, `status: 'running'`, `pollUrl`.
- `GET /api/agent/jobs/:id` returns the same compact schema and final decision when available.

- [ ] **Step 1: Write query-only endpoint RED test**

```ts
const result = await runAgentResearch({ query: '와이드뷰 43인치 4K V3 스탠드 어때?' }, deps);
assert.equal(result.intent.purchaseDecision, true);
assert.ok(result.product);
assert.ok(['running', 'completed', 'partial'].includes(result.status));
```

- [ ] **Step 2: Write structured response RED test**

Assert the API response contains only stable user-facing fields: product identity, identity confidence/ambiguity, decision/confidence, prices, relay status, reasons, strengths, weaknesses, missing information, evidence summaries/source URLs, source coverage, job status. Assert no relay secret or secret-bearing field names appear.

- [ ] **Step 3: Implement agent orchestration wrapper**

Flow: classify intent → resolve product → if ambiguous return `INSUFFICIENT` without broad exact-product research → construct internal `ResearchRequest` using resolved URL/target → auto-set `includeLocalRelay` only when useful → call `runCloudResearch` → shape compact response.

- [ ] **Step 4: Implement Netlify functions**

`agent-research.mjs` validates request size and query. `agent-job.mjs` loads stored job and returns the compact representation. Keep relay bearer secret server-side only.

- [ ] **Step 5: Add Netlify redirects**

```toml
[[redirects]]
  from = "/api/agent/research"
  to = "/.netlify/functions/agent-research"
  status = 200
  force = true

[[redirects]]
  from = "/api/agent/jobs/*"
  to = "/.netlify/functions/agent-job?id=:splat"
  status = 200
  force = true
```

- [ ] **Step 6: Run agent/function tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='agent research|agent function'
```

- [ ] **Step 7: Commit**

```bash
git add src/agent/research.ts netlify/functions/agent-research.mjs netlify/functions/agent-job.mjs netlify.toml tests/agent-research.test.ts tests/netlify-agent-functions.test.ts
git commit -m 'feat: add ChatGPT-oriented research API'
```

---

### Task 7: Custom GPT OpenAPI schema and optional Action authentication

**Files:**
- Create: `openapi/korea-web-agent-action.yaml`
- Modify: `netlify/functions/agent-research.mjs`
- Modify: `netlify/functions/agent-job.mjs`
- Test: `tests/action-auth.test.ts`

**Interfaces:**
- Optional `KWA_ACTION_API_KEY` is a separate server secret.
- When configured, agent routes require `Authorization: Bearer <action-key>`; relay routes continue using `KWA_RELAY_SECRET` and are unchanged.

- [ ] **Step 1: Add auth RED tests**

With `KWA_ACTION_API_KEY` configured, missing/wrong bearer key returns 401. Correct key succeeds. Assert `KWA_RELAY_SECRET` is never accepted as a substitute in test fixtures.

- [ ] **Step 2: Implement Action auth helper**

Keep Action auth scoped only to `/api/agent/*`. Avoid exposing either key in responses or logs.

- [ ] **Step 3: Write OpenAPI 3.1 schema**

Define operations such as `startProductResearch` and `getProductResearchResult`, concise descriptions, request/response schemas, and bearer auth. Base server URL: `https://korea-web-agent.netlify.app`.

- [ ] **Step 4: Validate schema structurally in test**

Parse YAML only if a YAML parser dependency is intentionally added; otherwise keep the schema dependency-free and test required strings/paths plus JSON-schema fragments using a minimal fixture. Do not add a production dependency solely for schema validation.

- [ ] **Step 5: Run auth/schema tests and confirm GREEN**

```bash
npm test -- --test-name-pattern='action auth|OpenAPI'
```

- [ ] **Step 6: Commit**

```bash
git add openapi/korea-web-agent-action.yaml netlify/functions/agent-research.mjs netlify/functions/agent-job.mjs tests/action-auth.test.ts
git commit -m 'feat: publish Custom GPT Action contract'
```

---

### Task 8: End-to-end fixtures, CI, production smoke, and documentation

**Files:**
- Create or modify: `tests/agent-e2e.test.ts`
- Modify: `.github/workflows/production-smoke.yml`
- Modify: `README.md`
- Modify: `package.json` version to `0.3.0`

**Interfaces:**
- Acceptance query 1: `와이드뷰 43인치 4K V3 스탠드 어때?`
- Acceptance query 2: `와이드뷰 V3 43인치 패널 스펙 알려줘`

- [ ] **Step 1: Add deterministic end-to-end fixture test**

Use fake discovery/search/relay dependencies to prove the full flow resolves the WideView product, rejects unrelated KC/safety hits, queues relay only for the purchase question, and produces a price-gated decision.

- [ ] **Step 2: Add production smoke checks**

Check `/api/agent/research` validation and `/api/agent/jobs/nonexistent` not-found behavior. Do not make production smoke depend on `online:true`, because the user's PC may legitimately be off.

- [ ] **Step 3: Update README**

Document that the PWA is diagnostic, the intended UX is a dedicated Custom GPT Action, how the PC connector participates only for purchase/price questions, and how to configure `KWA_ACTION_API_KEY` separately from `KWA_RELAY_SECRET`.

- [ ] **Step 4: Run full local/CI acceptance commands**

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/agent-e2e.test.ts .github/workflows/production-smoke.yml README.md package.json package-lock.json
git commit -m 'chore: verify Korea Web Agent v0.3 end to end'
```

- [ ] **Step 6: Verify GitHub CI**

Confirm the CI workflow, production dependency audit if triggered, and production smoke workflow all pass on the v0.3 commit.

- [ ] **Step 7: Verify Netlify deployment**

Confirm `/api/health`, `/api/agent/research`, `/api/agent/jobs/*`, `/api/relay/status`, and legacy `/api/research` respond with the expected schemas after deployment.

- [ ] **Step 8: Real PC relay acceptance**

With the existing PC connector running after `git pull`, submit a purchase-oriented product request and verify the job transitions from `running` to final with `relay.used = true` when the target URL is relay-eligible. Then submit the spec-only acceptance query and verify no relay job/browser launch occurs.

- [ ] **Step 9: Custom GPT connection handoff**

Import `openapi/korea-web-agent-action.yaml` into the GPT Action editor, configure the separate Action API key if enabled, and set GPT instructions to call the Action for concrete product research/purchase questions while avoiding unrelated casual questions.

---

## Plan Self-Review

- Spec coverage: product resolver, Shopping Live support, intent/relay policy, evidence matching, confidence redesign, decision gates, ChatGPT start/status API, OpenAPI Action contract, security separation, error degradation, PWA backward compatibility, and real acceptance tests are each mapped to a task.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `ResearchIntent`, `ProductResolution`, `ProductMatchLevel`, `ProductConfidenceDimensions`, agent start/status request/response, and relay semantics are introduced before downstream use.
- Scope: v0.3 remains product-research focused; places/services and cosmetic PWA changes are deliberately excluded from the implementation milestone.
