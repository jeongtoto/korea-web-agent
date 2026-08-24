# Shopping Intelligence v0.5.1 Design

## Goal

Extend the shopping decision engine without storing a persistent user profile. Each request may provide temporary payment methods, memberships, budget, and preferences. The result must distinguish cash payment, conditional card/payment discounts, member and non-member rewards, and effective prices.

## Request behavior

- Exact-product research requires a model, product ID, or URL when identity cannot otherwise be established.
- Category recommendation may proceed without another question when the requested category, size, or use case is sufficient. Missing budget or secondary preferences become explicit assumptions.
- Payment methods include cards and wallet/payment services such as Toss Pay and Kakao Pay. They are request-scoped and must not be persisted as a user profile.

## Price and event semantics

- Every observation records `observedAt` and the source URL.
- Event periods expose exact start and end dates when available and report upcoming, active, expired, or unknown status.
- Membership calculations always show two scenarios: not joined and joined. Membership fees are included in the joined effective price.
- Six-month analysis reports minimum, maximum, average, sample count, and a position label. A repeated SKU observation reports up/down/unchanged with absolute and percentage change.
- Price history keys use normalized SKU identity, not raw title text.

## SKU identity

SKU normalization applies Unicode normalization, uppercase conversion, whitespace and dash removal, and version normalization (`v 3`, `v.3`, `(V3)`). Conflicting explicit versions are never treated as the same SKU. Bundle completeness and condition remain separate checks.

## Retry policy

Failures are classified before retrying:

- timeout/network/rate limit: exponential backoff, up to three attempts
- server error/parse error: limited linear retry
- authentication/CAPTCHA: stop and request user action
- invalid SKU/not found: do not repeat the same request
- unknown: one conservative retry

Retries must preserve the original request and append attempt metadata rather than overwriting the first failure.

## Standard response order

1. Cash payment total
2. Card or payment-service price and exact condition
3. Effective price without membership
4. Effective price with membership, including membership fee
5. Alternative-condition prices
6. Event period and observation timestamp
7. Six-month price position and change since the previous observation
8. Risks, manual checks, and recommendation

## Privacy

Application logs redact authorization values, tokens, secrets, cookies, card names, payment methods, memberships, budgets, email addresses, and phone numbers. Raw request bodies must not be logged. Only aggregate operational metadata may be retained.

## Test coverage

Unit tests cover SKU normalization and version conflicts, membership scenarios, repeated price comparisons, six-month position classification, failure-specific retry plans, nested log redaction, clarification policy, event windows, and stable response row ordering.
