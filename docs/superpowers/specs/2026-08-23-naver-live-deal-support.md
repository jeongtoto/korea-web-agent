# Naver Shopping Live Direct Deal Support Spec

## Goal
Support user-supplied `view.shoppinglive.naver.com/lives/{liveId}` URLs as read-only authenticated commerce sources and normalize the live deal into explicit payment and effective-price fields.

## Ground-truth fixture
Use live ID `1985890` and the captured checkout text structure as the regression fixture. Expected normalized values from the supplied screenshot:

- listPrice: 720000
- sellerInstantDiscount: 221000
- couponDiscount: 59880
- cardInstantDiscount: 21960
- cashPaymentPrice: 417160
- totalExpectedPoints: 64200
- effectivePrice: 352960
- shippingFee: 0
- dealType: `naver_shopping_live`
- liveId: `1985890`

## Scope
1. Parse `view.shoppinglive.naver.com/lives/{id}` as a Naver commerce target and preserve the canonical live URL and live ID.
2. Extend the relay read-only contract and `PriceSnapshot` with live-deal discount, payment, points, and deal metadata fields.
3. For Naver Shopping Live view pages, read only page text from the authenticated local browser and parse deterministic Korean labels. Never upload page HTML, cookies, tokens, localStorage, session data, or credentials.
4. Derive `cashPaymentPrice` from the explicit maximum-discount price when present, otherwise from list price minus immediate discounts plus shipping. Derive `effectivePrice` as cash payment price minus total expected points.
5. Preserve existing `estimatedPoints` and `salePrice` compatibility by mapping total live points to `estimatedPoints` and live cash payment price to `salePrice` when the live-specific values are available.
6. Expose the new fields in the Custom GPT Action response schema.

## Non-goals for this PR
- Automatic discovery of currently running live broadcasts when the user did not supply a live URL.
- Purchase, payment, coupon claiming, option changes, account mutation, or any other write action.
- Treating gifts or non-cash benefits as cash discounts.
- Inferring a live broadcast is active solely from a `/lives/` URL.

## Security constraints
- Read-only browser navigation and deterministic text extraction only.
- Relay domain allowlist remains unchanged.
- CAPTCHA/MFA remain manual.
- Raw page body text is parsed locally and must not be returned to the cloud; only normalized fields may be returned.
