# Shopping Decision Engine Design

**Date:** 2026-08-24  
**Status:** Approved for implementation by the user  
**Scope:** Multi-market offer comparison and category-aware Best 3+ recommendations

## 1. Goal

Turn one natural-language buying question into a conservative, evidence-backed decision that:

1. identifies the exact product, variant, bundle, and condition;
2. discovers offers across Korean and overseas commerce channels;
3. separates checkout cash, owned-card, membership/coupon, and points-adjusted prices;
4. verifies a bounded set of difficult authenticated pages through the read-only PC Relay;
5. returns at least three ranked choices when the question asks what to buy;
6. states what was attempted, what was verified, and what remains uncertain.

The system must never claim that it searched “everywhere.” It reports explicit market coverage and freshness instead.

## 2. Safety and trust boundaries

- Relay activity remains read-only. It may navigate, select a matching product card, and read rendered commerce fields.
- It must never add to cart, claim coupons, start checkout, purchase, message a seller, or expose cookies/session data.
- Only public HTTPS URLs on an explicit commerce allowlist may enter the Relay.
- A Relay batch contains at most eight targets and is signed as one canonical payload.
- Login, CAPTCHA, age/identity checks, and confirmation of an actually owned card remain manual.
- Search snippets are discovery evidence, not checkout verification.
- Stale, unavailable, identity-mismatched, or incomplete-bundle offers cannot win a primary ranking.

## 3. Architecture

### 3.1 Public discovery

The source plan covers these market families where relevant:

- Naver Shopping/Shopping Live
- Coupang
- KREAM
- Danawa and Enuri
- 11st, Gmarket, Auction
- SSG, Lotte ON
- official brand stores and offline-dealer discovery
- AliExpress and Temu
- refurb/open-box/return/display listings
- Karrot, Joonggonara, and Bunjang
- independent reviews, communities, video, news, official specifications, and academic sources

Search results are normalized into offers only when the target identity is exact or probable. Market, price labels, condition, bundle signals, and conditional requirements are parsed locally.

### 3.2 Offer normalization

Each `MarketOffer` records:

- market, seller, title, URL, retrieval time;
- condition: new, refurbished, open-box, display, used, or unknown;
- bundle completeness and detected bundle items;
- list, sale, coupon, membership, owned-card, shipping, installation, points, total-cash, and effective prices;
- named card or membership requirements and other conditions;
- verification tier: checkout-verified, page-verified, search metadata, or unverified;
- identity score, freshness, availability, warranty/return notes;
- eligibility and explicit exclusion reasons.

Ranking never substitutes points-adjusted value for cash paid. It exposes four independent winners:

1. verified cash total;
2. owned-card total;
3. points-adjusted effective total;
4. alternative-condition total (refurb/open-box/display/used).

### 3.3 Authenticated Relay verification

Public discovery proposes up to eight high-value candidates, prioritizing:

- the current exact product page;
- the apparent lowest cash offer;
- the apparent lowest card/coupon offer;
- Naver and Coupang authenticated offers;
- offers whose rank could change after verification.

The cloud signs the entire target list. The connector opens each target sequentially in one persistent authenticated browser, extracts deterministic labels and nearby prices, rejects CAPTCHA/manual-verification pages, and returns only normalized fields. Legacy single-target jobs remain valid.

### 3.4 Category recommendation

Recommendation questions are allowed to remain category-level rather than being rejected as ambiguous. Candidate products are grouped from search evidence and scored using a category rubric.

The default dimensions are:

- functional fit to the request;
- quality/durability evidence;
- review confidence and repeated negative signals;
- design/space/color fit;
- maintenance and care burden;
- warranty/returns/seller risk;
- price/value using eligible normalized offers.

For bedding, the rubric additionally checks mattress size compatibility, topper/mattress depth, material/season, warmth, washability, dust/allergy signals, pilling/noise, color coordination, and whether the listing is a complete set or one component.

At least three recommendations are returned only when three defensible candidates exist. Each recommendation includes the use case it wins, trade-offs, score components, and best eligible offer. A candidate with weak identity or only promotional evidence is labeled preliminary rather than silently promoted.

## 4. API contract

The request accepts optional purchase context:

- `ownedCards`: card names the user actually holds;
- `memberships`: active memberships;
- `budget`: maximum cash budget;
- `region`: delivery/offline relevance;
- `preferences`: free-text design, material, care, size, and risk preferences.

The response adds:

- `offers`: normalized comparable offers;
- `bestOffers`: winners by price basis;
- `marketCoverage`: attempted/found/verified status per market;
- `recommendations`: ranked Best 3+ candidates with score dimensions;
- `manualChecks`: only checks that require the user.

Existing `price` and `personalizedPrice` remain for backward compatibility.

## 5. Failure handling

- CAPTCHA: finish with public results and add one manual check.
- Offline/busy Relay: return public results with verification tiers intact.
- Incomplete bundle: exclude from primary ranking and show as an alternative.
- Card not listed in `ownedCards`: keep the offer visible but exclude it from owned-card winner.
- Points without an expiry/use assumption: show them, but do not call them cash savings.
- Used/local listing without live availability: mark freshness and availability unverified.
- Overseas offer: include shipping, duties/VAT uncertainty, Korean warranty, voltage/plug, and returns as risk flags.

## 6. Verification strategy

Tests use production-shaped fixtures for:

- KREAM card price beating a public cash price;
- Naver points-adjusted value remaining separate from cash paid;
- TV-only, bundle, new, refurb, return, and used mismatches;
- a non-owned card not winning `owned_card`;
- three bedding candidates ranked by fit, quality, design, reviews, care, and value;
- Relay batch signature tampering, allowlist, eight-target bound, and secret-key rejection;
- legacy single-target Relay and existing API compatibility.

Release gates are dependency install, production audit, full tests, typecheck, build, GitHub CI, merged-main SHA, Netlify ready state, and one user-run authenticated end-to-end check.
