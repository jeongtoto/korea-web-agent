# Korea Web Agent v0.6.0 Shopping Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-profile payment promotion discovery, category-first recommendations, exact event windows, 180-day observed price history, failure-aware retries, stronger SKU normalization, stable response presentation, and privacy-safe logging.

**Architecture:** Keep the existing research pipeline and add focused core utilities rather than replacing it. Normalize identity before matching, normalize commercial scenarios after offer extraction, append price observations through an injected history store, and shape a deterministic presentation contract at the Agent boundary. Netlify persists only product/offer price observations, never purchase context.

**Tech Stack:** Node.js 22+, TypeScript 5.8, Node test runner, Netlify Functions, `@netlify/blobs` 10.7.13.

**Spec:** `docs/superpowers/specs/2026-08-24-shopping-intelligence-v060-design.md`

## Global Constraints

- Preserve all v0.5.1 fields and read-only Relay behavior.
- No durable user card/membership/budget/region/preferences profile.
- No card numbers.
- CAPTCHA/MFA are never bypassed.
- Six-month low claims require sufficient observed history; otherwise return `insufficient_history`.
- Package/API/health version becomes `0.6.0`.

---

### Task 1: SKU normalization

**Files:**
- Create: `src/core/sku-normalization.ts`
- Modify: `src/core/product-match.ts`
- Test: `tests/sku-normalization.test.ts`
- Test: `tests/product-match.test.ts`

**Interfaces:**
- Produces: `normalizeModelCode(value?: string): string`, `normalizeVariant(value?: string): string`, `extractVersionTokens(value?: string): string[]`, `skuFingerprint(target: NormalizedTarget): string`, `sameNormalizedSku(a, b): boolean`.

- [ ] Write failing tests for punctuation/spacing equivalence and V2/V3 inequality.
- [ ] Verify RED in CI.
- [ ] Implement normalization utility and integrate product matching.
- [ ] Verify tests pass.

### Task 2: Payment promotions and membership scenarios

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/offer-engine.ts`
- Test: `tests/offer-engine.test.ts`

**Interfaces:**
- Produces: `PaymentPromotion`, `MembershipScenario`, `BestOffers.advertisedPayment`.
- `rankMarketOffers()` returns `paymentPromotions` and `membershipScenarios` in addition to existing rankings.

- [ ] Write failing tests proving advertised card/pay promotions are returned without `purchaseContext` and owned-card winner requires request-scoped ownership.
- [ ] Add tests for Toss Pay, Kakao Pay, Naver Pay labels and member/non-member economics.
- [ ] Verify RED.
- [ ] Implement commercial extraction/ranking without inventing missing values.
- [ ] Verify GREEN.

### Task 3: Category-first research and stable presentation

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/agent/research.ts`
- Create: `src/core/presentation.ts`
- Test: `tests/agent-research.test.ts`
- Test: `tests/presentation.test.ts`

**Interfaces:**
- Produces Agent fields: `researchMode`, `assumptions`, `clarificationRequired`, `clarificationQuestions`, `presentation`.

- [ ] Write failing tests that broad recommendation queries proceed with candidates instead of exact-SKU failure.
- [ ] Write row-order test for presentation schema version 1.
- [ ] Verify RED.
- [ ] Implement mode/assumption shaping and deterministic presentation rows.
- [ ] Verify GREEN.

### Task 4: Failure taxonomy and bounded retries

**Files:**
- Create: `src/core/retry-policy.ts`
- Modify: `src/agent/research.ts`
- Modify: `src/orchestrator/research.ts`
- Test: `tests/retry-policy.test.ts`
- Test: `tests/agent-research.test.ts`

**Interfaces:**
- Produces: `classifyFailure(error): FailureClass`, `retryPolicyFor(class): RetryPolicy`, `withRetry(operation, options)`.

- [ ] Write failing tests for transient, rate-limit, CAPTCHA, auth, SKU mismatch, and bad-request policies.
- [ ] Verify RED.
- [ ] Implement bounded retry utility and apply it to safe public-search/direct-read calls.
- [ ] Verify GREEN and no CAPTCHA retry.

### Task 5: Event validity and 180-day history analytics

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/price-history.ts`
- Modify: `src/orchestrator/research.ts`
- Modify: `src/report/product-report.ts`
- Test: `tests/price-history.test.ts`

**Interfaces:**
- Produces: `PriceObservation`, `PriceHistorySummary`, `summarizePriceHistory(observations, current, now)`.
- Offer promotion validity uses `startsAt`, `endsAt`, `validityStatus`.

- [ ] Write failing statistics/position tests including `insufficient_history` and prior-price delta.
- [ ] Verify RED.
- [ ] Implement analytics and event validity parsing only from explicit dates.
- [ ] Verify GREEN.

### Task 6: Netlify history persistence and privacy redaction

**Files:**
- Create: `netlify/functions/_lib/price-history.mjs`
- Create: `netlify/functions/_lib/redact.mjs`
- Modify: `netlify/functions/agent-research.mjs`
- Modify: `netlify/functions/agent-job.mjs`
- Test: `tests/privacy-redaction.test.ts`
- Test: `tests/netlify-agent-functions.test.ts`

**Interfaces:**
- `appendPriceObservations(store, result)` persists only normalized product/offer price data.
- `redactForLog(value)` recursively masks sensitive fields.

- [ ] Write failing redaction tests and source-contract tests ensuring no durable purchaseContext persistence.
- [ ] Verify RED.
- [ ] Implement redaction and history persistence helper.
- [ ] Verify GREEN.

### Task 7: OpenAPI, GPT instructions, versioning

**Files:**
- Modify: `openapi/korea-web-agent-action.yaml`
- Modify: `docs/custom-gpt-config.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `netlify/functions/health.mjs`
- Modify: `src/server.ts`
- Test: existing Action/schema tests

- [ ] Write/update schema assertions first to require v0.6.0 additive fields and no hard-coded private card/membership profile in GPT config.
- [ ] Verify RED.
- [ ] Update schema/docs/version strings.
- [ ] Verify GREEN.

### Task 8: Full verification and integration

- [ ] Run all tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm audit --omit=dev --audit-level=high`.
- [ ] Open PR from `feat/shopping-intelligence-v060` to `main`.
- [ ] Review diff and CI.
- [ ] Merge only after all checks pass.
- [ ] Verify production health reports `0.6.0` after deployment.
