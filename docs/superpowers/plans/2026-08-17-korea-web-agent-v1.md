# Korea Web Agent v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable, mobile-first Korea Web Agent v1 that accepts a URL/question, performs source-attributed public research, produces an evidence-backed product report, and supports a secure read-only local browser relay protocol without exposing browser secrets.

**Architecture:** A zero-dependency TypeScript/Node core provides the orchestrator, evidence model, policy checks, research providers, and HTTP API. A static PWA consumes that API. A separate local relay process validates signed read-only jobs and can use a dedicated Chromium profile through an optional Playwright adapter; public-only operation remains functional when the relay is offline.

**Tech Stack:** Node.js 22+, TypeScript 5.8+, built-in `node:test`, Web Crypto / Node crypto, Fetch API, HTML/JSON-LD extraction without external runtime dependencies, static PWA (HTML/CSS/JS), optional `playwright-core` for the local relay.

## Global Constraints

- Passwords, raw cookies, tokens, localStorage, and browser profile files must never leave the local machine.
- The local browser relay is read-only in v1.
- Page text is untrusted data and must never become an instruction source.
- CAPTCHA and step-up authentication are not bypassed.
- The system remains functional in public-only mode when the local relay is unavailable.
- Every material claim carries source provenance and an evidence class.
- Scientific evidence about a general mechanism must never be represented as direct proof of a specific commercial product.
- The PWA is the primary mobile interface; ChatGPT integration remains optional.

---

## File Structure

- `package.json` — scripts and runtime metadata.
- `tsconfig.json` — strict TypeScript compilation.
- `src/core/types.ts` — shared domain types.
- `src/core/evidence.ts` — evidence normalization, independence, confidence weighting.
- `src/core/policy.ts` — URL/domain safety and local-relay read-only policy.
- `src/adapters/naver-product.ts` — Naver Brand/SmartStore URL parsing.
- `src/providers/direct-page.ts` — public URL retrieval and metadata/JSON-LD extraction.
- `src/providers/duckduckgo.ts` — keyless public web search fallback.
- `src/providers/index.ts` — provider registry and common search contract.
- `src/report/product-report.ts` — evidence-to-report synthesis heuristics.
- `src/orchestrator/research.ts` — source planning, acquisition, merge, status tracking.
- `src/relay/protocol.ts` — signed relay job/result envelopes and secret-leak rejection.
- `src/relay/playwright-adapter.ts` — optional dedicated-profile read-only Chromium extraction.
- `src/relay/server.ts` — local relay HTTP service skeleton.
- `src/server.ts` — cloud/PWA HTTP API and static file server.
- `public/index.html` — mobile-first research dashboard.
- `public/app.js` — submission, progress, report rendering.
- `public/styles.css` — responsive UI.
- `public/manifest.webmanifest` — PWA metadata.
- `public/sw.js` — shell cache/offline support.
- `tests/*.test.ts` — core, adapters, orchestrator, relay, and API tests.
- `.env.example` — optional configuration with no secrets checked in.
- `README.md` — local run, relay setup, security boundaries, deployment notes.

---

### Task 1: Project foundation and domain contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/core/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Produces: `EvidenceItem`, `ResearchRequest`, `ResearchJob`, `ProductReport`, `ResearchSourceResult`, `RelayStatus`.

- [ ] **Step 1: Write a failing runtime contract test** verifying required enum-like evidence classes and report decision values.
- [ ] **Step 2: Run `npm test` and verify the test fails because the domain module does not exist.**
- [ ] **Step 3: Implement strict shared TypeScript types and exported constants.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`; verify both pass.**
- [ ] **Step 5: Commit `feat: add Korea Web Agent domain contracts`.**

### Task 2: Evidence normalization and confidence engine

**Files:**
- Create: `src/core/evidence.ts`
- Test: `tests/evidence.test.ts`

**Interfaces:**
- Consumes: `EvidenceItem` from `src/core/types.ts`.
- Produces: `normalizeEvidence(items)`, `scoreEvidence(item)`, `dedupeEvidence(items)`, `aggregateConfidence(items)`.

- [ ] **Step 1: Write failing tests** for class weighting, duplicate `independence_key` suppression, sponsored/manufacturer down-weighting, and confidence clamping to 0–1.
- [ ] **Step 2: Run the focused evidence tests and verify failure.**
- [ ] **Step 3: Implement minimal scoring/deduplication logic with deterministic weights.**
- [ ] **Step 4: Run focused tests and full typecheck.**
- [ ] **Step 5: Commit `feat: add evidence confidence engine`.**

### Task 3: URL safety policy and Naver product parsing

**Files:**
- Create: `src/core/policy.ts`, `src/adapters/naver-product.ts`
- Test: `tests/policy.test.ts`, `tests/naver-product.test.ts`

**Interfaces:**
- Produces: `assertPublicUrl(url)`, `isRelayDomainAllowed(hostname)`, `parseNaverProductUrl(url)`.

- [ ] **Step 1: Write failing tests** rejecting localhost/private-network/file/javascript URLs and accepting HTTPS public URLs.
- [ ] **Step 2: Write failing Naver parser tests** for `brand.naver.com/<brand>/products/<id>` and SmartStore-style product URLs.
- [ ] **Step 3: Run focused tests and verify failure.**
- [ ] **Step 4: Implement SSRF-safe URL validation and normalized Naver entity hints.**
- [ ] **Step 5: Run tests/typecheck and commit `feat: add safe URL and Naver parsing`.**

### Task 4: Public acquisition providers

**Files:**
- Create: `src/providers/index.ts`, `src/providers/direct-page.ts`, `src/providers/duckduckgo.ts`
- Test: `tests/direct-page.test.ts`, `tests/duckduckgo.test.ts`

**Interfaces:**
- Produces: `ResearchProvider`, `fetchDirectPage(url, fetchImpl?)`, `searchDuckDuckGo(query, fetchImpl?)`.

- [ ] **Step 1: Write failing fixture-driven tests** for OpenGraph, title/meta description, JSON-LD Product/Offer extraction, and DuckDuckGo result parsing.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement bounded-size HTML fetch, charset-safe text extraction, JSON-LD parsing, and search result parsing.**
- [ ] **Step 4: Run tests/typecheck and commit `feat: add public research providers`.**

### Task 5: Relay protocol security

**Files:**
- Create: `src/relay/protocol.ts`
- Test: `tests/relay-protocol.test.ts`

**Interfaces:**
- Produces: `signRelayJob`, `verifyRelayJob`, `validateRelayRequest`, `sanitizeRelayResult`.

- [ ] **Step 1: Write failing tests** for HMAC signature verification, expiry, nonce presence, domain allowlist, read-only field allowlist, and recursive rejection of keys such as cookie/token/password/localStorage/session.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement canonical payload signing and recursive secret-key stripping/rejection.**
- [ ] **Step 4: Run tests/typecheck and commit `feat: secure local relay protocol`.**

### Task 6: Product report synthesis

**Files:**
- Create: `src/report/product-report.ts`
- Test: `tests/product-report.test.ts`

**Interfaces:**
- Consumes: normalized evidence plus optional personalized relay evidence.
- Produces: `buildProductReport(input): ProductReport`.

- [ ] **Step 1: Write failing tests** for BUY/WAIT/SKIP thresholds, insufficient-evidence behavior, source counts, unknown claims, and separation of research/general evidence from exact-product proof.
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement deterministic first-pass report synthesis with explicit reasons and confidence.**
- [ ] **Step 4: Run tests/typecheck and commit `feat: synthesize evidence-backed product reports`.**

### Task 7: Research orchestrator

**Files:**
- Create: `src/orchestrator/research.ts`
- Test: `tests/orchestrator.test.ts`

**Interfaces:**
- Produces: `runResearch(request, deps): Promise<ResearchJob>`.
- Consumes: provider registry, Naver parser, evidence engine, product report builder, optional relay client.

- [ ] **Step 1: Write failing dependency-injected tests** for direct URL evidence, related public search, provider failure degradation, relay-offline fallback, and evidence merge.
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement category-aware source planning and graceful partial completion.**
- [ ] **Step 4: Run tests/typecheck and commit `feat: orchestrate multi-source research jobs`.**

### Task 8: HTTP API and PWA

**Files:**
- Create: `src/server.ts`, `public/index.html`, `public/app.js`, `public/styles.css`, `public/manifest.webmanifest`, `public/sw.js`
- Test: `tests/server.test.ts`

**Interfaces:**
- Produces: `POST /api/research`, `GET /api/jobs/:id`, `GET /api/health`, static PWA.

- [ ] **Step 1: Write failing API tests** for validation, job response shape, health endpoint, and static shell delivery.
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement Node HTTP server with bounded JSON body parsing and in-memory job storage.**
- [ ] **Step 4: Implement responsive PWA showing status, decision, confidence, evidence, missing information, and relay status.**
- [ ] **Step 5: Run tests/typecheck and commit `feat: add Korea Web Agent PWA and API`.**

### Task 9: Read-only local Chromium relay

**Files:**
- Create: `src/relay/playwright-adapter.ts`, `src/relay/server.ts`
- Test: `tests/playwright-adapter.test.ts`, `tests/relay-server.test.ts`

**Interfaces:**
- Produces: `extractAuthenticatedFields(job, browserDriver)` and local `POST /relay/extract`.
- Optional runtime dependency: `playwright-core`; system Chromium executable may be configured by `CHROMIUM_PATH`.

- [ ] **Step 1: Write failing mock-driver tests** proving navigation/DOM reads are allowed while purchase/payment/account mutations cannot be requested.
- [ ] **Step 2: Write failing relay-server tests** for signed request verification and sanitized output.
- [ ] **Step 3: Implement browser-driver abstraction and Playwright-backed dedicated persistent profile adapter.**
- [ ] **Step 4: Implement local relay server bound to loopback by default.**
- [ ] **Step 5: Run tests/typecheck and commit `feat: add read-only local Chromium relay`.**

### Task 11: Documentation, security verification, and deployment readiness

**Files:**
- Create: `.env.example`, `README.md`
- Modify: `package.json`
- Test: `tests/security-regression.test.ts`

**Interfaces:**
- Produces: documented run/deploy workflow and security regression checks.

- [ ] **Step 1: Write security regression tests** scanning serialized cloud payloads/loggable objects for secret-key patterns and SSRF bypass cases.
- [ ] **Step 2: Run all tests and verify expected failures before fixes if any.**
- [ ] **Step 3: Add configuration/docs for `PORT`, relay secret, allowed domains, profile directory, Chromium path, and public-only operation.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`, start the app, and smoke-test `/api/health` and PWA shell.**
- [ ] **Step 5: Commit `docs: finalize Korea Web Agent v1`.**


### Task 10: Outbound relay broker for phone-to-PC use

**Files:**
- Create: `src/relay/broker.ts`, `src/relay/connector.ts`
- Modify: `src/server.ts`, `src/orchestrator/research.ts`, `package.json`
- Test: `tests/relay-broker.test.ts`, `tests/relay-connector.test.ts`

**Interfaces:**
- Produces: an in-memory signed job broker, authenticated cloud polling/result endpoints, and a PC connector that only makes outbound HTTPS requests.

- [ ] **Step 1: Write failing broker tests** for offline/online status, signed job polling, result resolution, timeout, and secret-bearing result rejection.
- [ ] **Step 2: Write failing connector tests** proving a signed job is verified locally, extracted through the read-only browser driver, sanitized, and returned without cookies/tokens.
- [ ] **Step 3: Implement broker + connector and wire the broker into the cloud server as an optional `RelayClient`.**
- [ ] **Step 4: Run focused tests, full tests, and typecheck.**
- [ ] **Step 5: Commit `feat: add outbound mobile-to-PC relay broker`.**

## Verification Gate

Before declaring v1 complete:

1. `npm test` passes with zero failures.
2. `npm run typecheck` passes.
3. `npm run build` passes.
4. The production server starts and serves `/api/health` plus the PWA shell.
5. A fixture Naver URL request produces a structured report with provenance.
6. Relay protocol rejects expired/unsigned/mutating/secret-bearing payloads.
7. Grep of tracked source and generated logs contains no real credentials/cookies/tokens.
