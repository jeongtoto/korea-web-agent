# Price Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist normalized-SKU price observations for 183 days and expose previous-price change, six-month position, event windows, membership scenarios, and stable price rows in ProductReport/Action results.

**Architecture:** Add a store-backed price-history service keyed by `normalizeSku(model + variant)`. Append only trustworthy positive current-price observations, prune older than 183 days, and compute analytics with the already-tested shopping-intelligence utilities. Report shaping remains deterministic.

**Tech Stack:** TypeScript, Netlify Blobs, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-24-shopping-intelligence-v051-design.md`

## Global Constraints
- Do not invent membership fees or event dates.
- Price history is SKU-keyed, not title-keyed.
- Current observation timestamp and source URL remain visible.
- Keep cash/card/effective rows in a stable order.

---

### Task 1: Price history store
**Files:** Create `src/cloud/price-history.ts`, create `tests/price-history.test.ts`, modify `src/core/types.ts`.
**Interfaces:** `appendPriceObservation(store, target, observation, nowMs?)`, `getPriceHistory(store, target, nowMs?)`, `PriceHistorySummary`.
- [ ] Add failing tests for normalized keys, 183-day pruning, duplicate-time replacement, previous-price comparison, six-month min/max/average.
- [ ] Verify failure before production code.
- [ ] Implement store operations using `JsonKeyValueStore`; if model/variant identity is insufficient, return no history rather than title-keying.
- [ ] Run targeted/full tests, typecheck, build.

### Task 2: Report integration
**Files:** Modify `src/core/types.ts`, `src/cloud/research-service.ts`, `src/agent/research.ts`, `src/report/shopping-response.ts`; create/modify report tests.
**Interfaces:** Add optional `priceHistory`, `membershipScenarios`, `eventWindow`, `standardPriceRows` to `ProductReport` and `AgentResearchResult`.
- [ ] Add failing tests for the four stable rows, membership joined/not-joined output, live event end mapping, and price-history exposure.
- [ ] Verify red.
- [ ] Integrate analytics after public research and again after personalized Relay merge when a stronger exact price is available.
- [ ] Never assume a membership fee; zero is allowed only when the source/request explicitly means no incremental fee, otherwise omit fee-dependent claims.
- [ ] Run full verification.

### Task 3: Action/OpenAPI exposure
**Files:** Modify OpenAPI Action schema file(s), `tests/action-auth.test.ts` or schema tests.
- [ ] Add failing schema assertions for new output fields and request-scoped `paymentMethods`.
- [ ] Update schemas without exposing secrets or raw cookies.
- [ ] Run full verification.
