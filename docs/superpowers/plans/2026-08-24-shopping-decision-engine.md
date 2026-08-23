# Shopping Decision Engine Implementation Plan

> Execute with test-driven development and verify each task before continuing.

**Goal:** Deliver exact multi-market price comparison and category-aware Best 3+ recommendations through the existing ChatGPT Action and read-only local Relay.

**Architecture:** Add an offer normalization/ranking core fed by public search evidence and bounded authenticated Relay batches. Add a separate category recommendation core that consumes candidate evidence and normalized offers. Preserve the existing single-product report and single-target Relay contracts while extending the API.

**Tech stack:** TypeScript, Node.js test runner, Netlify Functions/Blobs, Playwright Core, OpenAPI 3.1.

---

## Task 1: Define production contracts and price semantics

**Files:** `src/core/types.ts`, `tests/types.test.ts`, `tests/offer-engine.test.ts`

- Add request purchase context, market offer, price basis, market coverage, ranked offer, recommendation, and manual-check types.
- Test that cash, card, points, shipping, condition, and bundle completeness remain separate serializable fields.

## Task 2: Implement offer parsing, eligibility, and ranking

**Files:** `src/core/offer-engine.ts`, `tests/offer-engine.test.ts`, `src/core/search-signals.ts`

- Parse explicit labeled KRW amounts from retailer search metadata.
- Detect market, seller, condition, bundle components, card/membership/coupon/points conditions, and price freshness.
- Exclude identity or bundle mismatches from primary winners.
- Rank cash total, owned-card total, effective total, and alternative-condition total independently.

## Task 3: Expand market discovery and coverage

**Files:** `src/providers/source-plan.ts`, `src/orchestrator/research.ts`, `tests/source-plan.test.ts`, `tests/orchestrator.test.ts`

- Add bounded queries for KREAM, Enuri, open markets, department/official/offline, overseas, used, and refurb sources.
- Record an explicit coverage row for every planned market query.
- Convert eligible retailer evidence to normalized offers and expose it on the report.

## Task 4: Implement category recommendation and Best 3+

**Files:** `src/core/recommendation-engine.ts`, `src/core/intent.ts`, `src/agent/research.ts`, `tests/recommendation-engine.test.ts`, `tests/agent-research.test.ts`

- Detect category recommendation requests and retain multiple candidates.
- Score functional fit, quality, review reliability, design fit, care burden, risk, and value.
- Add bedding-specific compatibility and care signals.
- Return at least three defensible recommendations, otherwise state the shortfall.

## Task 5: Add bounded multi-target Relay

**Files:** `src/relay/protocol.ts`, `src/relay/playwright-adapter.ts`, `src/relay/connector.ts`, `src/cloud/relay-state.ts`, `src/cloud/research-service.ts`, `src/relay/merge.ts`, related tests

- Extend signed jobs with up to eight allowlisted candidate targets while accepting legacy `url` jobs.
- Extract generic labeled commerce fields locally and return normalized per-market offers only.
- Merge verified offers without letting a mismatched title or incomplete bundle win.
- Retain CAPTCHA/manual verification behavior and secret-bearing-field rejection.

## Task 6: Extend Action output and documentation

**Files:** `src/agent/research.ts`, `openapi/korea-web-agent-action.yaml`, `README.md`, `docs/operations.md`, related tests

- Validate optional purchase context.
- Add offers, best offers, market coverage, recommendations, and manual checks to shaped results.
- Document price semantics and the exact Custom GPT invocation/poll flow.

## Task 7: Verify, review, release

- Run `npm ci`, `npm audit --omit=dev --audit-level=high`, `npm test`, `npm run typecheck`, and `npm run build`.
- Perform security and architecture review against the design.
- Push a GitHub branch, open a PR, wait for CI, inspect all jobs, and squash-merge.
- Verify Netlify deploy is ready at the exact merge SHA and check health/OpenAPI endpoints.
- Give the user only the final manual authenticated checks: connector online, login/CAPTCHA, owned cards/memberships, and one end-to-end prompt.
