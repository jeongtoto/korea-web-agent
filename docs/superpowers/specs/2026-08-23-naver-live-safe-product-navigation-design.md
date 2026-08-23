# Naver Live Safe Product Navigation Design

## Problem

Production commit `c6f3a25` can navigate to a Naver Shopping Live page, but the live page body contains only summary product cards. Checkout economics are loaded after the user-visible product card is opened. The current extractor waits only for checkout labels in the live page body, returns `null`, and therefore omits even `dealType` and `liveId`.

The local connector cannot safely choose a card today because the signed relay job contains only the live URL and requested fields. It does not contain the already-resolved product identity. Selecting the first card or hard-coding a card position would violate exact-SKU association.

## Confirmed Evidence

- The live page body is non-empty and contains `무료배송`, but not checkout discount labels.
- The live page has one frame and no open Shadow DOM.
- The `혜택` tab does not reveal checkout economics.
- The product list contains multiple variants (24/32/40/43-inch, V1, V3, and V3-Air).
- The unique visible candidate for this request is the V3 QLED 109 cm (43-inch) UHD 4K package.
- Clicking that visible card navigates to `https://product.shoppinglive.naver.com/products/11458011168` and exposes current price and reward data.
- Navigating directly to the product URL can trigger a CAPTCHA. CAPTCHA/MFA must remain user-handled and must never be bypassed.

## Architecture

### Signed product identity hint

Add an optional `targetHint` to `UnsignedRelayJob`. It carries only normalized, non-secret product identity fields:

- `brand`
- `name`
- `model`
- `variant`
- `productId`
- `liveId`

The hint is produced from the cloud research job's resolved target, validated with an allowlist and length limits, and included in the existing HMAC canonical payload. No question text, cookie, token, browser state, or raw page content is added.

### Deterministic card selection

For `view.shoppinglive.naver.com/lives/{liveId}` jobs requesting `liveDeal`:

1. Read visible, user-facing product cards only.
2. Compare their normalized titles with `targetHint`.
3. Require agreement on strong variant discriminators present in the hint, including size, V1/V3/V3-Air, and resolution class (FHD versus UHD/4K).
4. Exclude explicit conflicts.
5. Require one unique best candidate above the threshold and with a safe margin.
6. If selection is missing or ambiguous, do not click and do not attach another product's price.

Model codes may be absent from live card text. A model-code absence is not itself a match; it may be tolerated only when the cloud-resolved commercial title and all visible strong variant discriminators agree. The cloud merge continues to validate the returned title against the resolved target as defense in depth.

### Read-only browser transition

The Playwright driver exposes a site-specific read-only operation that clicks only a matched anchor whose resolved destination host is `product.shoppinglive.naver.com`. It never clicks purchase, cart, order, review, address, or payment controls. It waits for the same-page navigation or newly opened page and then makes that page the active read target.

Direct `goto` to a discovered product-detail URL is not used because the production diagnostic showed that it can trigger a CAPTCHA while the visible click path succeeds.

### Extraction semantics

After the click, the extractor reads deterministic text from the active product page and readable frames. It returns only normalized commerce fields.

- `listPrice`: only from an explicit original/list-price label or struck-through price context.
- `salePrice`: current displayed retailer price.
- `cashPaymentPrice`: only from an explicit final-payment/maximum-discount label or a fully evidenced discount calculation.
- `totalExpectedPoints`: only from an explicit maximum-total-points label.
- `effectivePrice`: only when both `cashPaymentPrice` and `totalExpectedPoints` are known.
- `shippingFee`: `0` only when free delivery is explicit.
- `dealType`: `naver_shopping_live`.
- `liveId`: preserved from the original live URL.
- `sourceUrl`: the selected product-detail URL without credentials.

Points are never treated as a cash discount. Unknown coupon/card eligibility is never assumed.

### Challenge handling

If the live or product page contains known CAPTCHA/manual-verification signals, extraction throws `manual_verification_required`. The connector reports a relay failure through the existing error channel. The cloud returns public-only results with a clear error instead of an empty authenticated success.

## Compatibility

- `targetHint` is optional so existing signed jobs and non-Live extraction remain compatible.
- No Custom GPT OpenAPI schema change is required.
- Spec-only requests continue to skip Relay.
- The Relay result sanitizer and read-only field allowlist remain unchanged.
- No raw HTML, body text, cookies, tokens, storage, or authorization data leaves the PC.

## Test Strategy

1. Protocol tests prove allowed `targetHint` fields are signed and malformed/extra/oversized values are rejected.
2. Cloud queue tests prove the stored resolved target is copied into the signed relay job.
3. Pure matcher tests cover the unique 43-inch V3 match and reject 32/40-inch, V1, V3-Air, missing hints, and ambiguous duplicates.
4. Adapter regression test starts with a live body containing summary cards only, verifies the exact candidate is opened, then parses the product-detail fixture.
5. CAPTCHA regression test proves no commerce data is returned and `manual_verification_required` is raised.
6. Existing delayed-SPA, generic Naver/Coupang, mutation rejection, sanitizer, merge, spec-only, and connector tests remain green.
7. Final verification runs `npm audit --omit=dev --audit-level=high`, `npm test`, `npm run typecheck`, and `npm run build`.

## Success Criteria

- The target Live job no longer finishes with an empty `personalizedPrice` merely because checkout labels are absent from the live-page body.
- Only a unique, identity-consistent card is opened.
- The result preserves `dealType` and `liveId` and returns only evidenced price fields.
- Ambiguity and CAPTCHA fail safely.
- All CI checks pass with no security-boundary regression.
