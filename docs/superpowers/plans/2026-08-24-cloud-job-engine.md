# Cloud Job Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public shopping research resilient and cloud-first, with failure-specific retry, payment-service conditions, and asynchronous job contracts that do not depend on the PC relay.

**Architecture:** Keep `runResearch` as the public research engine, add a focused retry executor around provider calls, extend offer parsing for card and wallet payment conditions, and expose an asynchronous job lifecycle that can be hosted by a Netlify Background Function. Relay remains optional and cannot make a public job fail.

**Tech Stack:** TypeScript 5.8, Node.js 22+, Node test runner, Netlify Functions/Background Functions, Netlify Blobs.

**Spec:** `docs/superpowers/specs/2026-08-24-shopping-intelligence-v051-design.md`

## Global Constraints

- Do not persist a user profile.
- Payment methods and memberships are request-scoped.
- Authentication/CAPTCHA failures are never blindly retried.
- Public research remains usable when Relay is offline or fails.
- Existing Action API authentication remains unchanged.

---

### Task 1: Provider retry executor

**Files:**
- Create: `src/core/retry.ts`
- Create: `tests/retry.test.ts`
- Modify: `src/orchestrator/research.ts`

**Interfaces:**
- Produces: `classifyFailure(error: unknown): RetryFailureType`
- Produces: `withRetry<T>(operation: () => Promise<T>, options?: { sleep?: (ms:number)=>Promise<void> }): Promise<{ value:T; attempts:number }>`

- [ ] **Step 1: Write the failing test** asserting timeout/network/rate-limit errors retry according to `retryPlanForFailure`, while authentication/CAPTCHA does not retry.
- [ ] **Step 2: Run `npm test -- tests/retry.test.ts` and verify failure because `src/core/retry.ts` does not exist.**
- [ ] **Step 3: Implement classification and bounded backoff using `retryPlanForFailure`; preserve the final error after the allowed attempts.**
- [ ] **Step 4: Wrap `directPage`, each `publicSearch`, and `academicSearch` call in `runResearch` with `withRetry`, recording attempt count in source errors/notes without changing successful evidence semantics.**
- [ ] **Step 5: Run the retry test and full `npm test`, then typecheck/build.**

### Task 2: Payment-condition normalization

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/offer-engine.ts`
- Modify: `src/agent/research.ts`
- Modify: `tests/offer-engine.test.ts`
- Modify: `tests/agent-research.test.ts`

**Interfaces:**
- Add: `PurchaseContext.paymentMethods?: string[]`
- Add: `MarketOffer.paymentMethod?: string`
- Add: `BestOffers.conditionalPayment?: RankedOffer`
- Add basis: `conditional_payment`

- [ ] **Step 1: Add failing tests for `토스페이`, `카카오페이`, `네이버페이`, and card conditions; conditional payment must rank even when the user did not pre-declare ownership.**
- [ ] **Step 2: Run targeted tests and verify the new basis/fields are missing.**
- [ ] **Step 3: Extend parsing to detect wallet/payment-service names near a conditional price and distinguish them from membership prices.**
- [ ] **Step 4: Extend request validation to accept `paymentMethods` as names only and reject number-like account/card data.**
- [ ] **Step 5: Run targeted tests and full verification.**

### Task 3: Asynchronous cloud job contract

**Files:**
- Create: `src/cloud/job-state.ts`
- Create: `tests/cloud-job-state.test.ts`
- Create: `netlify/functions/agent-research-background.mjs`
- Modify: `netlify/functions/agent-research.mjs`
- Modify: `netlify.toml`
- Modify: `tests/netlify-agent-functions.test.ts`

**Interfaces:**
- Produces: `createQueuedResearchJob(...)`, `saveQueuedResearchInput(...)`, `claimQueuedResearchInput(...)`
- HTTP start endpoint returns `{ status:'queued'|'running', jobId, pollUrl }` with 202 for deep research.
- Background function completes the stored job independently of the initiating HTTP request.

- [ ] **Step 1: Add failing tests that the start endpoint/redirect includes a background worker and the stored job can transition queued → running → terminal.**
- [ ] **Step 2: Verify targeted tests fail before implementation.**
- [ ] **Step 3: Implement Blob-backed queued input and state transitions without storing raw authentication headers.**
- [ ] **Step 4: Implement Netlify Background Function entrypoint that consumes the queued input and calls the existing agent/cloud research pipeline.**
- [ ] **Step 5: Keep the existing synchronous endpoint as a compatibility path until the Action schema is switched, then run full verification.**
