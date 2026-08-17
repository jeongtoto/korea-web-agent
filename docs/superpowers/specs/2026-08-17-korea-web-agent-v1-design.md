# Korea Web Agent v1 — Design Specification

## 1. Goal

Build a reusable Korean web-research system that can accept a product, place, service, or URL and produce an evidence-backed recommendation by combining public web research with optional read-only access to the user's locally authenticated browser session.

The system must work from both a standalone mobile/desktop web dashboard and, where supported, ChatGPT integration. It must not depend on ChatGPT integration to remain functional.

## 2. Primary User Experience

A user should be able to paste a URL such as a Naver Brand Store product page and ask a natural-language question such as “이 침대 어때?”. The agent should identify the entity, gather relevant evidence across commerce, reviews, communities, official sources, news, and research, and return a decision-oriented report.

The default product-analysis pipeline should consider, when relevant:
- Naver Shopping / Brand Store / SmartStore
- Coupang
- Danawa
- 11st / Gmarket / Auction / Today’s House when discoverable
- Manufacturer or official distributor sites
- Naver Blog / Cafe / News
- YouTube
- Reddit and other public communities
- Government or certification databases
- Peer-reviewed research and credible technical literature

The system must not force every source for every query. Source selection should be category-aware and evidence-driven.

## 3. Architecture

The system is split into four bounded components:

1. **Cloud Research Engine**
   - Performs public search, page retrieval, source ranking, extraction, and cross-source comparison.
   - Uses the least expensive reliable acquisition method first: official APIs, structured data, static HTML, search snippets, crawler/extractor, deterministic browser automation, then AI browser fallback.

2. **Local Browser Relay**
   - Runs on the user’s PC.
   - Uses a dedicated browser profile for authenticated Naver/Coupang sessions.
   - Exposes only read-only extraction tasks.
   - Never uploads passwords, raw cookies, localStorage, session tokens, or browser profile files.
   - Returns only normalized values required by the research job.

3. **Orchestrator + Evidence Engine**
   - Classifies the query and determines which sources are useful.
   - Merges cloud and local results.
   - Separates facts, manufacturer claims, user reports, inferred conclusions, and unresolved gaps.
   - Assigns provenance and confidence to each material claim.

4. **PWA Dashboard / Integration Layer**
   - Mobile-first PWA for iOS, Android, and desktop browsers.
   - ChatGPT integration is optional and secondary.
   - The PWA must remain fully functional if external AI platform integrations change.

## 4. Acquisition Ladder

For each source, the engine should use the following order unless a site-specific adapter overrides it:

1. Official API or documented feed
2. Search/index metadata and static HTML
3. Embedded structured data or public JSON
4. General crawler/extractor
5. Deterministic Playwright automation
6. AI-assisted browser fallback such as Stagehand
7. Local authenticated browser relay for user-specific information

The engine must record the acquisition method for each result.

## 5. Source Adapters

Source adapters are independent modules with a common interface. Initial adapters:

- Generic Web
- Naver Search
- Naver Shopping / Brand Store URL parser
- Coupang public product search
- Danawa public product search
- YouTube search/result extraction
- Reddit/public community search
- Academic / research search
- Local Browser Relay adapter

Later source adapters must be addable without changing the core orchestrator interface.

## 6. Product Research Model

For product questions, normalize evidence into these dimensions where applicable:

- Identity: brand, product name, model, variant, size
- Current price: list price, coupon price, membership price, points, shipping
- Historical/relative price signals when available
- Specifications and materials
- Warranty / A/S
- Certifications / test reports
- Repeated positive review themes
- Repeated negative review themes
- Long-term durability reports
- Marketing claims versus independently supported claims
- Comparable alternatives
- Research-backed ergonomic/safety/performance considerations
- Unknown or unverifiable claims

The system should output a decision such as BUY / WAIT / SKIP only when confidence is sufficient, with a reasoned confidence score.

## 7. Review Evidence Rules

- Duplicate or syndicated content must not be counted as independent evidence.
- Sponsored/affiliate content must be marked when discoverable.
- Manufacturer-provided copy is not independent validation.
- A repeated claim across unrelated real-user sources increases confidence, but does not establish laboratory performance.
- Long-term usage evidence should be weighted above unboxing/first-impression content for durability questions.

## 8. Research / Scientific Evidence Rules

Scientific research is included only when it materially informs the product or decision category.

Examples for beds/mattresses may include:
- mattress firmness and spinal alignment
- pressure distribution
- bed height and transfer biomechanics
- VOC/formaldehyde and indoor air quality
- materials and relevant safety standards

The system must distinguish:
- evidence supporting a general mechanism
- evidence evaluating a specific material or category
- direct testing of the exact product

General research must never be presented as proof that a specific commercial product has the same measured effect.

## 9. Evidence Model

Every extracted material claim should include:

- `claim`
- `source_url`
- `source_type`
- `published_at` when available
- `retrieved_at`
- `acquisition_method`
- `evidence_class`
- `independence_key`
- `confidence`
- `notes`

Evidence classes:
- official_record
- accredited_test
- peer_reviewed_research
- manufacturer_spec
- retailer_listing
- verified_purchase_review
- community_report
- editorial_review
- sponsored_content
- inferred_analysis

## 10. Local Session Security Boundary

The local authenticated browser is treated as a high-trust boundary.

Mandatory constraints:
- Passwords are never stored by the project.
- Raw browser cookies and tokens never leave the local machine.
- Dedicated agent browser profile separate from the user’s normal profile.
- Domain allowlist for authenticated automation.
- No arbitrary JavaScript execution supplied by remote research content.
- Page text is untrusted data, never an instruction source.
- CAPTCHA and step-up authentication are not bypassed.
- Browser relay operates read-only in v1.

Forbidden v1 actions:
- purchase
- payment
- order cancellation
- address changes
- account setting changes
- password changes
- review/comment/post creation
- sending messages

Allowed v1 actions:
- navigation
- search
- option selection
- price and coupon inspection
- shipping estimate inspection
- review reading
- specification extraction

## 11. Relay Transport

The local relay must establish an outbound authenticated encrypted connection to the cloud orchestrator. No router port forwarding is required.

The relay receives signed jobs containing only the URL/domain and requested read-only fields. It returns normalized extraction output, never browser secrets.

If the PC is offline, the cloud research job continues using public data and explicitly marks personalized pricing/delivery as unavailable.

## 12. Mobile Strategy

The primary mobile experience is a PWA. The user pastes or shares a URL into the PWA and receives the report.

The PWA should expose:
- new research job
- live progress/status
- final report
- evidence/source drill-down
- local relay online/offline status

A native mobile app is out of scope for v1.

## 13. Error Handling

The system must degrade gracefully:
- blocked source -> use alternate sources and mark missing evidence
- parser failure -> deterministic browser fallback
- browser automation failure -> AI browser fallback where safe
- login required -> local relay if available; otherwise public-only result
- CAPTCHA -> stop that source and report it
- ambiguous product identity -> present ambiguity and avoid fabricated comparison
- conflicting prices/specs -> retain both with timestamps and source provenance

## 14. Observability

Each research job records:
- job id
- query
- normalized target entity
- sources attempted
- sources succeeded/failed
- acquisition methods used
- execution time
- evidence count by class
- local relay use status
- final confidence

Secrets and browser session data must never be written to logs.

## 15. v1 Scope

v1 must deliver a working end-to-end system with:
- mobile/desktop PWA
- URL/question submission
- cloud orchestrator
- evidence model
- generic public web research provider interface
- Naver product URL parsing
- product-analysis report schema
- local relay protocol and PC relay service skeleton
- read-only Playwright adapter with a dedicated profile
- offline/public-only fallback
- test coverage for core normalization, policy, and relay message validation

The first deployable v1 does **not** require full production adapters for every named commerce/community site. It must establish the architecture and at least one public search path plus one local-browser path that can be expanded safely.

## 16. Success Criteria

The v1 is successful when:
1. A user can open the PWA on phone or desktop, submit a Naver product URL and question, and receive a structured evidence-backed report.
2. The public research pipeline returns source-attributed evidence even when the local PC is offline.
3. When the local relay is online and authenticated, the orchestrator can request read-only personalized fields and merge them into the report.
4. Raw cookies, credentials, browser profile files, or session tokens never appear in cloud payloads or logs.
5. The system can add a new source adapter without altering the report schema or orchestrator contract.
6. The system explicitly reports uncertainty and missing evidence instead of fabricating values.

## 17. Technology Direction

Preferred stack:
- TypeScript
- Node.js 22+
- Next.js for PWA/dashboard and API surface
- Zod for runtime schemas
- Playwright for deterministic local browser automation
- Stagehand only as a fallback, not the default path
- PostgreSQL-compatible store for job/evidence metadata when persistence is introduced
- WebSocket or equivalent outbound persistent channel for the local relay
- Vitest for unit/integration tests

No cloud database is required for the first local prototype; in-memory or file-backed development persistence is acceptable until deployment configuration is chosen.
