# Naver Shopping Live Direct Deal Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a user-supplied Naver Shopping Live URL produce normalized live-discount, cash-payment, points, and effective-price data through the existing read-only PC relay.

**Architecture:** Extend Naver URL parsing so `/lives/{id}` is a first-class product research target. Add live-deal fields to the shared price model and relay contract, then parse deterministic Korean checkout labels from page body text locally in the Playwright adapter. Merge only normalized numbers/metadata into `PriceSnapshot` and expose them through the Action schema; do not send raw page text to cloud.

**Tech Stack:** TypeScript, Node test runner, Playwright-core local connector, Netlify Functions, OpenAPI 3.1.

**Spec:** `docs/superpowers/specs/2026-08-23-naver-live-deal-support.md`

## Global Constraints

- Read-only only; no purchase/payment/coupon-claim/account mutations.
- Relay domain allowlist remains Naver/Coupang only.
- Raw cookies, tokens, localStorage, profile data, and page body text never leave the PC.
- Keep backward-compatible `salePrice` and `estimatedPoints` mappings.
- Do not infer `liveStatus=live` from URL shape alone.

---

### Task 1: Parse Naver Shopping Live view URLs

**Files:**
- Modify: `tests/naver-product.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/adapters/naver-product.ts`

**Interfaces:**
- Consumes: `parseNaverProductUrl(input: string): NormalizedTarget | null`
- Produces: `NormalizedTarget.liveId?: string` and canonical `https://view.shoppinglive.naver.com/lives/{id}` targets.

- [ ] **Step 1: Write the failing test**

Add a test using live ID `1985890` that expects `kind=product`, `sourceHost=view.shoppinglive.naver.com`, `liveId=1985890`, no fabricated brand/productId, and a tracking-free canonical URL.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: parser returns `null` or omits `liveId` because the host/path is unsupported.

- [ ] **Step 3: Implement minimal parser/type support**

Add optional `liveId` to `NormalizedTarget`; recognize only numeric `/lives/{id}` paths on `view.shoppinglive.naver.com` and canonicalize by dropping query parameters.

- [ ] **Step 4: Run tests and verify GREEN**

Expected: parser test passes; existing Brand Store/SmartStore/product Shopping Live tests remain green.

---

### Task 2: Normalize live checkout economics locally

**Files:**
- Modify: `tests/playwright-adapter.test.ts`
- Modify: `tests/relay-protocol.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/relay/protocol.ts`
- Modify: `src/relay/playwright-adapter.ts`

**Interfaces:**
- Consumes: `extractAuthenticatedFields(job, driver)` and `RELAY_READ_ONLY_FIELDS`
- Produces normalized fields: `listPrice`, `sellerInstantDiscount`, `couponDiscount`, `cardInstantDiscount`, `cashPaymentPrice`, `totalExpectedPoints`, `effectivePrice`, `dealType`, `liveId`, plus compatibility `salePrice`/`estimatedPoints`.

- [ ] **Step 1: Write failing tests**

Create a fake `view.shoppinglive.naver.com/lives/1985890` driver whose `body` text contains the screenshot labels and amounts. Assert the normalized result exactly matches 720000 / 221000 / 59880 / 21960 / 417160 / 64200 / 352960 and free shipping. Add a protocol test showing the new `liveDeal` read-only request field is accepted while mutation-like fields remain rejected.

- [ ] **Step 2: Run CI and verify RED**

Expected failures: `liveDeal` is unsupported and live-specific fields are not extracted.

- [ ] **Step 3: Implement minimal local parser**

Add `liveDeal` to the read-only field list. On Naver live-view URLs only, read `body` text locally and parse Korean labels with bounded deterministic regexes. Return only normalized fields; never return body text. Derive cash/effective price and compatibility fields.

- [ ] **Step 4: Run tests and verify GREEN**

Expected: new extraction/protocol tests pass; existing selector-based Naver/Coupang extraction remains unchanged.

---

### Task 3: Merge and expose live-deal fields

**Files:**
- Modify: `tests/relay-merge.test.ts`
- Modify: `tests/action-auth.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/relay/merge.ts`
- Modify: `openapi/korea-web-agent-action.yaml`

**Interfaces:**
- Consumes: normalized relay object from Task 2.
- Produces: `report.personalizedPrice` containing live-deal fields and Action schema properties for the same fields.

- [ ] **Step 1: Write failing merge/schema tests**

Assert `applyPersonalizedRelayResult` preserves the ground-truth live fields and compatibility aliases. Assert the Action schema contains `cashPaymentPrice`, `effectivePrice`, `sellerInstantDiscount`, `couponDiscount`, `cardInstantDiscount`, `totalExpectedPoints`, `dealType`, and `liveId` while all operation descriptions stay <=300 characters.

- [ ] **Step 2: Run CI and verify RED**

Expected failures: merge drops unknown fields and schema lacks properties.

- [ ] **Step 3: Implement minimal merge/schema support**

Extend `PriceSnapshot`, copy the normalized live fields in `priceFromObject`, include them in useful-commerce detection/evidence text, and expose optional OpenAPI fields.

- [ ] **Step 4: Run full verification**

Run locked install, production dependency audit, all tests, typecheck, and build. Expected: all pass with zero high-severity production dependency vulnerabilities.

- [ ] **Step 5: PR, merge, and production deploy verification**

Create PR, verify fresh GitHub Actions success, squash merge, then confirm Netlify production is `ready` on the exact merge commit.
