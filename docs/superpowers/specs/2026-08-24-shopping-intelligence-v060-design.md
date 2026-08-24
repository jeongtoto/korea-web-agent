# Korea Web Agent v0.6.0 Shopping Intelligence Design

## Goal

Extend v0.5.1 into a privacy-preserving shopping intelligence system that can research broad product categories, enumerate currently advertised payment promotions without storing a user payment profile, compare member/non-member economics, track observed price history for 180 days, classify retries by failure type, normalize exact SKUs safely, and return a stable presentation contract.

## Baseline

- Base commit: `10645041817cae60ab01b64a01ef2262729835bf`
- Base version: `0.5.1`
- Preserve read-only Relay behavior and all existing security boundaries.
- Preserve existing `offers`, `bestOffers`, `recommendations`, `marketCoverage`, and `purchaseContextApplied` fields for backward compatibility.

## 1. No persistent user payment profile

`purchaseContext` remains optional request-scoped input. The server must not create or maintain a durable profile of cards, memberships, budget, region, or preferences.

The Custom GPT instructions must remove hard-coded private profile defaults. A request may include cards/memberships explicitly stated in the current conversation, but advertised promotions must be discovered independently of card ownership.

New output separates:

- `ownedCard`: a promotion that matches an explicitly supplied `purchaseContext.ownedCards` entry.
- `advertisedPayment`: the best advertised card/pay promotion even when the user has not said they own it.
- `paymentPromotions`: all sufficiently evidenced advertised payment options such as Samsung/Shinhan/KB cards, Toss Pay, Kakao Pay, Naver Pay, etc.

No card numbers are accepted or stored.

## 2. Membership economics

Each offer may expose member and non-member economics independently:

- member payment price
- non-member payment price
- member expected points
- non-member expected points
- member effective price
- non-member effective price
- membership name and any known fee/eligibility note

If a value is not evidenced, it remains absent; the system must not infer missing point rates.

`membershipScenarios` presents a normalized comparison so the UI/GPT can say, for example, “가입 시 체감가 X / 미가입 시 Y”.

## 3. Category recommendation without an exact SKU

Queries such as “43인치 이동형 TV 추천” are first-class `category_recommendation` requests.

The system must not fail merely because no exact model was supplied. It should:

1. resolve multiple candidates,
2. retain explicit assumptions,
3. return Best 3 or more when evidence supports them,
4. expose at most three `clarificationQuestions` only when an answer could materially change ranking.

`clarificationRequired=false` means the system proceeded using listed assumptions. `clarificationRequired=true` means the current result is preliminary, not that research failed.

## 4. Promotion/event validity

Price and promotion records may include:

- `observedAt`
- `startsAt`
- `endsAt`
- `timeZone` (default `Asia/Seoul` only for formatting when the source provides an unambiguous local date/time)
- `validityStatus`: `active`, `upcoming`, `expired`, `unknown`

Exact periods are shown only when evidenced. Unknown start/end dates are not invented.

## 5. 180-day observed price history

Netlify Blobs stores product-price observations, not user profile data.

Storage key uses a deterministic normalized SKU fingerprint plus market/offer identity. Each completed/partial research appends a compact snapshot for eligible exact-product offers.

Retention window: 180 days.

Response `priceHistory` includes:

- observation count and first/last observation timestamps
- current comparable price
- previous comparable price and delta
- 180-day minimum, maximum, mean, median
- percentile/rank when enough samples exist
- `position`: `new_low`, `near_low`, `below_average`, `around_average`, `above_average`, `new_high`, or `insufficient_history`
- `coverage`: `observed_only` unless external history evidence is explicitly available

The system must not claim a six-month low until observed history is sufficient. A new deployment starts with `insufficient_history` and accumulates evidence over time.

## 6. Failure taxonomy and retry policy

Create a reusable failure classifier and bounded retry utility.

Failure classes and default behavior:

- `transient_network`: retry up to 3 attempts with bounded exponential delay.
- `server_5xx`: retry up to 3 attempts.
- `rate_limit`: retry up to 2 attempts, honoring a bounded Retry-After hint when available.
- `spa_not_ready`: retry extraction up to 3 bounded waits.
- `parse_error`: retry once with the same safe read-only operation; otherwise mark partial.
- `relay_offline`: no repeated connector hammering; fall back to public research.
- `auth_required`: no blind retry; return manual check.
- `captcha`: never bypass or loop; return manual check.
- `sku_mismatch`: do not retry the same listing; try a different candidate.
- `bad_request` / `policy_block`: no retry.

Every retry path is bounded and read-only.

## 7. SKU normalization and exact identity

Create `src/core/sku-normalization.ts`.

Normalization rules:

- Unicode NFKC
- case-insensitive ASCII model codes
- remove insignificant spaces/separators around model-code components
- canonicalize version markers (`v3`, `V 3`, `(V3)` -> `V3`)
- normalize Korean size forms (`43형`, `43 inch`, `43인치` -> `43인치`)
- preserve materially different generation/version tokens; V2 and V3 must never compare equal
- preserve multiple bundle model codes in a stable sorted fingerprint

`product-match.ts` and offer bundle checks consume this utility instead of ad-hoc string normalization.

## 8. Stable presentation contract

Add a backend-generated `presentation` object with `schemaVersion: "1"` and a deterministic table order:

1. 현금 실결제가
2. 보유카드가 (only when request-scoped card ownership matches)
3. 광고 결제수단 최저가
4. 회원 체감가
5. 비회원 체감가
6. 리퍼/반품/중고
7. 180일 가격 위치

Each row uses stable fields: `label`, `amount`, `market`, `seller`, `paymentMethod`, `membership`, `expectedPoints`, `effectivePrice`, `eventPeriod`, `verification`, `retrievedAt`, `notes`.

Custom GPT instructions must render these rows in this order and must not silently substitute web-browsed prices for excluded Action offers.

## 9. Privacy/logging policy

No request body containing card names, memberships, budget, region, or preferences may be written to logs in plaintext by application logging.

Add a reusable redactor for structured diagnostic logging. Sensitive key families include:

- authorization, cookie, token, secret, api key
- ownedCards, memberships, budget, region, preferences, purchaseContext

Tests verify recursive redaction and that server/Netlify error responses do not echo request-scoped purchase context.

Price-history persistence explicitly excludes `purchaseContext`.

## 10. API additions

Backward-compatible additive fields:

- `researchMode`
- `assumptions`
- `clarificationRequired`
- `clarificationQuestions`
- `paymentPromotions`
- `membershipScenarios`
- `bestOffers.advertisedPayment`
- `priceHistory`
- `presentation`
- offer promotion/event validity fields

The OpenAPI schema version and package version become `0.6.0`.

## 11. Testing

Add regression tests for:

- V2/V3 and punctuation/spacing SKU normalization
- advertised payment promotion discovery without `purchaseContext`
- owned-card ranking remains request-scoped
- Toss/Kakao/Naver Pay recognition
- member/non-member comparison
- category recommendation proceeds without exact SKU
- promotion dates and validity classification
- 180-day history statistics and insufficient-history behavior
- history storage excludes purchase context
- retry class policy and bounded attempts
- recursive log redaction
- stable presentation row order
- OpenAPI exposes all additive fields and version `0.6.0`

Existing tests must remain green.
