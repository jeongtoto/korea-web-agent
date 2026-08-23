# Naver Live Safe Product Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely open the one Naver Shopping Live product card matching the cloud-resolved product identity and extract only evidenced product-detail commerce fields.

**Architecture:** Carry a validated non-secret `targetHint` inside the signed relay job, use a pure matcher to select one non-conflicting visible Live card, and let Playwright click only that allowlisted product link. Parse the resulting page locally, preserve cash-versus-points semantics, and fail explicitly on ambiguity or manual verification.

**Tech Stack:** TypeScript 5.8, Node 22+ test runner, Playwright-core local connector, Netlify Functions, HMAC-signed relay jobs.

**Spec:** `docs/superpowers/specs/2026-08-23-naver-live-safe-product-navigation-design.md`

## Global Constraints

- Read-only browser behavior only; never click purchase, cart, coupon claim, payment, review, message, address, or order controls.
- Never send raw HTML/body, cookies, tokens, storage, authorization data, or Chrome profile data to cloud.
- `targetHint` contains only allowlisted normalized product identity strings and is covered by the existing HMAC signature.
- A Live product card must be a unique, non-conflicting identity match; ambiguity returns no attached price.
- CAPTCHA/MFA is never bypassed and is reported as `manual_verification_required`.
- Points are not cash discounts; compute `effectivePrice` only from evidenced `cashPaymentPrice` and `totalExpectedPoints`.
- Existing non-Live extraction, spec-only behavior, OpenAPI contract, and legacy jobs without `targetHint` remain compatible.

---

### Task 1: Signed Relay Product Hint

**Files:**
- Modify: `tests/relay-protocol.test.ts`
- Modify: `tests/cloud-relay-state.test.ts`
- Modify: `tests/cloud-research.test.ts`
- Modify: `tests/relay-broker.test.ts`
- Modify: `src/relay/protocol.ts`
- Modify: `src/cloud/relay-state.ts`
- Modify: `src/cloud/research-service.ts`
- Modify: `src/relay/broker.ts`
- Modify: `src/orchestrator/research.ts`

**Interfaces:**
- Produces: `RelayProductHint`, `toRelayProductHint(target)`, and `UnsignedRelayJob.targetHint?`.
- Updates: `RelayClient.extract(url, targetHint?)` and persistent relay queue creation.

- [ ] **Step 1: Write protocol RED tests**

Assert a valid hint containing `name`, `model`, `variant`, and `liveId` validates and its signature fails after any hint mutation. Assert unknown keys, non-string values, empty objects, and over-limit values are rejected.

- [ ] **Step 2: Verify protocol RED**

Run `node --experimental-strip-types --test tests/relay-protocol.test.ts`. Expected: TypeScript/runtime assertions fail because `targetHint` validation does not exist.

- [ ] **Step 3: Implement the minimal hint type, normalization, and validation**

Add the six allowlisted optional string fields, trim values, cap `name` at 500 characters and other fields at 200, require at least one field, and reject extra keys. Keep the hint inside canonical HMAC signing.

- [ ] **Step 4: Verify protocol GREEN**

Run the protocol test and expect all cases to pass.

- [ ] **Step 5: Write queue propagation RED tests**

Assert `queuePersistentRelay` stores the supplied hint and `runCloudResearch` supplies the public job's resolved target. Assert the in-memory broker signs an optional hint when used outside Netlify.

- [ ] **Step 6: Verify queue RED**

Run the three queue/broker test files. Expected: polled jobs omit `targetHint`.

- [ ] **Step 7: Implement minimal propagation**

Convert `waiting.researchContext?.resolvedTarget ?? waiting.target` to a relay hint, pass it into persistent queue creation, and let `RelayClient.extract`/`RelayBroker.extract` accept the same optional hint.

- [ ] **Step 8: Verify queue GREEN and commit**

Run the focused tests, then commit `feat: sign relay product identity hints`.

---

### Task 2: Pure Naver Live Card Matching

**Files:**
- Create: `src/relay/naver-live.ts`
- Create: `tests/naver-live.test.ts`

**Interfaces:**
- Consumes: `RelayProductHint` and `NaverLiveProductCard[]`.
- Produces: `selectNaverLiveProductCard(cards, hint): NaverLiveProductCard | null`, `parseNaverLiveDeal(...)`, and `hasManualVerificationChallenge(text)`.

- [ ] **Step 1: Write matcher RED tests**

Use literal cards for 32-inch V3, 40-inch V3, 43-inch V3 UHD 4K, 32-inch V3-Air, and 43-inch V1. Assert only the 43-inch V3 card is selected for the resolved target. Add ambiguity, missing-hint, V1/V3-Air conflict, size conflict, and weak-model-only cases that must return `null`.

- [ ] **Step 2: Verify matcher RED**

Run `node --experimental-strip-types --test tests/naver-live.test.ts`. Expected: module/function missing.

- [ ] **Step 3: Implement minimal deterministic matcher**

Normalize Korean/ASCII text; extract size, generation, and resolution discriminators; reject explicit conflicts; score shared identity tokens; require sufficient strong agreement and one unique best candidate with a margin.

- [ ] **Step 4: Write parser/challenge RED tests**

Assert a product-card/detail fixture produces `listPrice=720000`, `salePrice=499000`, `totalExpectedPoints=106650`, `shippingFee=0`, `dealType`, `liveId`, and `sourceUrl`, while leaving `cashPaymentPrice` and `effectivePrice` absent. Assert the original explicit checkout fixture still produces `417160` cash and `352960` effective price. Assert Korean CAPTCHA/manual-verification text is detected.

- [ ] **Step 5: Verify parser RED, implement, and verify GREEN**

Implement only the evidenced parsing patterns and challenge detector. Run the focused tests and commit `feat: match and parse Naver Live product cards`.

---

### Task 3: Read-Only Product Card Navigation

**Files:**
- Modify: `tests/playwright-adapter.test.ts`
- Modify: `src/relay/playwright-adapter.ts`

**Interfaces:**
- Extends optional `BrowserDriver` capabilities: `readNaverLiveProductCards()`, `openNaverLiveProductCard(card)`, `readPageText()`, and `currentUrl()`.
- Consumes the pure matcher/parser from Task 2.

- [ ] **Step 1: Write adapter RED regression test**

Create a stateful fake driver whose live body lacks checkout markers, returns all five card variants, switches to a detail fixture only after the selected 43-inch V3 card is opened, and records the opened card. Assert normalized output, original `liveId`, detail `sourceUrl`, and exactly one safe card open.

- [ ] **Step 2: Verify adapter RED**

Run the adapter test. Expected: no card is opened and the result is empty.

- [ ] **Step 3: Implement minimal extraction state machine**

Read the live body, try deterministic cards only when a valid hint and optional driver capabilities are present, open only the unique match, read the active page/frames, detect challenges, and parse the combined selected-card plus detail text. Preserve the existing immediate and delayed checkout-label paths.

- [ ] **Step 4: Implement Playwright capabilities without browser-side arbitrary JavaScript**

Use deterministic locators and attributes only. Enumerate visible `product.shoppinglive.naver.com/bridge/v4/product/shopping` anchors, obtain bounded ancestor text, validate destination host/path, click the exact revalidated anchor, adopt a new page when opened, and concatenate readable frame body text locally.

- [ ] **Step 5: Write and pass CAPTCHA/ambiguity tests**

Assert challenge text throws `manual_verification_required`; assert ambiguous candidates are not clicked and return only safe Live identity metadata with no other product price.

- [ ] **Step 6: Verify adapter GREEN and commit**

Run Naver Live and adapter tests, then commit `fix: follow exact Naver Live product cards`.

---

### Task 4: Full Verification, Review, and Delivery

**Files:**
- Review all changed files.
- Modify documentation only if actual behavior differs from the approved spec.

**Interfaces:**
- Produces a reviewable PR with unchanged OpenAPI and read-only security boundaries.

- [ ] **Step 1: Run locked install with writable cache**

Run `npm_config_cache=/tmp/kwa-npm-cache npm ci`.

- [ ] **Step 2: Run complete CI locally**

Run `npm audit --omit=dev --audit-level=high`, `npm test`, `npm run typecheck`, and `npm run build`. All must pass.

- [ ] **Step 3: Perform diff/security self-review**

Confirm no raw page content is serialized, no mutation controls exist, destination validation is exact, target hints contain no question/session material, price semantics are conservative, and unrelated files are unchanged.

- [ ] **Step 4: Push branch and create PR**

Push `fix/naver-live-product-detail`, create a PR against `main`, and include production evidence, RED/GREEN coverage, security constraints, and Windows verification steps.

- [ ] **Step 5: Verify GitHub Actions and merge**

Wait for fresh CI success, review changed files and checks, merge using the repository-supported method, and record the exact merge SHA.

- [ ] **Step 6: Verify Netlify production**

Confirm production is `ready` and references the exact merged `main` commit. OpenAPI re-import is not required unless the diff unexpectedly changes the schema.

- [ ] **Step 7: Hand off the only required Windows actions**

Provide exact PowerShell commands for `git pull`, Connector restart with the existing local secret entry flow, and one Custom GPT direct-Live E2E. Instruct the user to handle CAPTCHA/MFA manually if it appears.
