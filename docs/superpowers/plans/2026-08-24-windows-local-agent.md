# Windows Local Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing connector start automatically when the user logs into Windows so no PowerShell window or manual `npm run connector` step is required for normal use.

**Architecture:** Keep the existing outbound connector and Playwright integration. Add a Windows bootstrap/launcher that uses Task Scheduler at user logon, starts the connector hidden, restarts on failure, and stores only local operational logs. Do not add a browser extension or cloud-hosted login session in this phase.

**Tech Stack:** Node.js 22+, Windows Task Scheduler, PowerShell only for one-time install/uninstall scripts, existing connector.

**Spec:** `docs/superpowers/specs/2026-08-24-shopping-intelligence-v051-design.md`

## Global Constraints
- No credentials/cookies are copied to Netlify.
- Normal daily use must not require opening PowerShell.
- The launcher must use outbound HTTPS polling only; no router port forwarding.
- Uninstall must remove the scheduled task cleanly.

---

### Task 1: Launcher contract
**Files:** Create `src/relay/local-agent.ts`, create `tests/local-agent.test.ts`, modify `package.json`.
**Interfaces:** `buildConnectorLaunchConfig(env, cwd)` validates required endpoint/secret and returns an argv/env configuration without logging secrets.
- [ ] Write failing validation/redaction tests.
- [ ] Verify red.
- [ ] Implement the small launcher and a `local-agent` npm script.
- [ ] Run targeted/full verification.

### Task 2: Windows autostart installer
**Files:** Create `scripts/install-local-agent.ps1`, create `scripts/uninstall-local-agent.ps1`, create `tests/windows-autostart.test.ts`, update README.
- [ ] Add failing static tests requiring a per-user scheduled task, `AtLogOn` trigger, hidden execution, restart-on-failure settings, and no literal relay secret in task arguments.
- [ ] Verify red.
- [ ] Implement installer that stores configuration in a user-local env file with restricted ACL and registers `KoreaWebAgent` task; installer is one-time only.
- [ ] Implement uninstall that deletes the task and optionally preserves configuration unless explicitly requested.
- [ ] Document one-time installation and normal PC-on/PC-off behavior.
- [ ] Run full verification.
