# Relay Queue v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the single global relay slot so concurrent shopping jobs can queue independently while preserving connector heartbeat, signed jobs, claim leases, and public-only fallback.

**Architecture:** Replace `relay:pending` with per-job records plus a lightweight queue index. Poll claims one unexpired job at a time using a short lease; complete/fail mutates only that job. Public research remains terminal-capable if Relay never responds.

**Tech Stack:** TypeScript, Netlify Blobs, existing relay protocol signatures.

**Spec:** `docs/superpowers/specs/2026-08-24-shopping-intelligence-v051-design.md`

## Global Constraints
- Never expose relay secrets in stored job payloads or responses.
- Keep signed relay jobs and nonce/expiry validation unchanged.
- Expired/stale jobs must not block newer jobs.
- Relay failure cannot erase public research evidence.

---

### Task 1: Per-job queue storage
**Files:** Modify `src/cloud/relay-state.ts`, modify `tests/cloud-relay-state.test.ts`, modify `tests/cloud-research.test.ts`.
**Interfaces:** Keep public function names where practical; internally use `relay:queue:index` and `relay:pending:{relayJobId}`.
- [ ] Add failing tests that two research jobs can be queued, polled, completed independently, and an expired first job does not block the second.
- [ ] Verify red.
- [ ] Implement queue index cleanup, per-job claim timestamps, and deterministic oldest-issued-first polling.
- [ ] Verify targeted/full tests.

### Task 2: Terminal fallback and merge isolation
**Files:** Modify `src/cloud/research-service.ts`, `src/cloud/relay-state.ts`, `src/relay/merge.ts` tests as needed.
- [ ] Add failing tests that Relay busy/offline/failure leaves the public result usable and only the matching research job receives personalized data.
- [ ] Implement fallback without adding false `failed` status when public evidence succeeded.
- [ ] Run full verification.
