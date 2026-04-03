# TTS Landing P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-value P0 gaps in the TTS landing plan by adding dialogue normalization, wiring normalized shots through the pipeline, and refactoring TTS provider routing without breaking the current xfyun-based flow.

**Architecture:** Keep the existing `director -> ttsAgent -> ttsQaAgent -> videoComposer` pipeline intact, but insert a lightweight `dialogueNormalizer` before TTS so downstream stages operate on stable dialogue text and duration budgets. Refactor `ttsApi` into a provider router with focused provider modules, preserving current xfyun behavior while creating clean extension points for additional providers.

**Tech Stack:** Node.js ESM, native `node:test`, existing JSON artifact pipeline, current xfyun WebSocket TTS integration.

---

### Task 1: Add Dialogue Normalizer

**Files:**
- Create: `src/agents/dialogueNormalizer.js`
- Test: `tests/dialogueNormalizer.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `node --test tests/dialogueNormalizer.test.js` and verify it fails**
- [ ] **Step 3: Implement `normalizeDialogueText`, `estimateDialogueDurationMs`, and `normalizeDialogueShots`**
- [ ] **Step 4: Run `node --test tests/dialogueNormalizer.test.js` and verify it passes**
- [ ] **Step 5: Commit**

### Task 2: Wire Normalized Shots Through Director

**Files:**
- Modify: `src/agents/director.js`
- Test: `tests/director.voicePreset.test.js`

- [ ] **Step 1: Extend the director harness test to assert normalized shots are passed into TTS and QA inputs**
- [ ] **Step 2: Run `node --test tests/director.voicePreset.test.js` and verify it fails**
- [ ] **Step 3: Insert `dialogueNormalizer` before TTS generation and pass normalized shots into TTS, QA, and video composition**
- [ ] **Step 4: Run `node --test tests/director.voicePreset.test.js` and verify it passes**
- [ ] **Step 5: Commit**

### Task 3: Refactor TTS API Into Provider Routing

**Files:**
- Create: `src/apis/providers/xfyunTtsApi.js`
- Create: `src/apis/providers/mockTtsApi.js`
- Create: `src/apis/providers/placeholderTtsApi.js`
- Modify: `src/apis/ttsApi.js`
- Test: `tests/ttsApi.test.js`

- [ ] **Step 1: Extend TTS API tests to cover router dispatch and placeholder providers**
- [ ] **Step 2: Run `node --test tests/ttsApi.test.js` and verify it fails**
- [ ] **Step 3: Move xfyun implementation into a dedicated provider module and add a provider registry in `ttsApi.js`**
- [ ] **Step 4: Run `node --test tests/ttsApi.test.js` and verify it passes**
- [ ] **Step 5: Commit**

### Task 4: Update Focused Test Suite and Docs

**Files:**
- Modify: `scripts/run-tts-tests.js`
- Modify: `docs/agents/tts-agent.md`

- [ ] **Step 1: Add the new normalization tests to the focused TTS suite**
- [ ] **Step 2: Update docs to describe normalized dialogue inputs and provider routing status**
- [ ] **Step 3: Run `pnpm run test:tts` and verify the focused TTS suite passes**
- [ ] **Step 4: Commit**

---

# P1 Progress Update

## Task 5: Add Optional Lip-sync Stage

**Files:**
- Create: `src/agents/lipsyncAgent.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `src/utils/runArtifacts.js`
- Test: `tests/lipsyncAgent.test.js`
- Test: `tests/videoComposer.test.js`
- Test: `tests/director.project-run.test.js`

- [x] **Step 1: Add a shot-level lip-sync agent with trigger rules, artifact outputs, and failure evidence**
- [x] **Step 2: Wire lip-sync after `tts_qa` and before `compose_video`, with cache-aware state persistence**
- [x] **Step 3: Make `videoComposer` prefer lip-sync clips over animation clips and static images**
- [x] **Step 4: Extend focused tests for orchestration order, compose input bridging, and lip-sync artifacts**
- [x] **Step 5: Run `pnpm run test:tts` and verify the focused TTS suite passes**

## Task 6: Add Lip-sync Provider Routing

**Files:**
- Create: `src/apis/lipsyncApi.js`
- Create: `src/apis/providers/mockLipsyncApi.js`
- Create: `src/apis/providers/placeholderLipsyncApi.js`
- Create: `src/apis/providers/funcineforgeLipsyncApi.js`
- Modify: `src/agents/lipsyncAgent.js`
- Modify: `scripts/run-tts-tests.js`
- Test: `tests/lipsyncApi.test.js`

- [x] **Step 1: Add a dedicated lip-sync provider router with mock and placeholder providers**
- [x] **Step 2: Add a Fun-CineForge request builder as the first formal real-provider adapter**
- [x] **Step 3: Make `lipsyncAgent` default to the router while preserving injectable test hooks**
- [x] **Step 4: Add focused router tests and include them in `pnpm run test:tts`**
- [x] **Step 5: Run `pnpm run test:tts` and verify the focused TTS suite passes**

## Task 7: Harden Fun-CineForge Provider Integration

**Files:**
- Modify: `src/apis/providers/funcineforgeLipsyncApi.js`
- Test: `tests/lipsyncApi.test.js`

- [x] **Step 1: Allow injected `fetchImpl` or global `fetch`, so the provider can run in real environments without extra adapter glue**
- [x] **Step 2: Add timeout control, retryable error classification, and bounded retry handling for timeout/network/5xx failures**
- [x] **Step 3: Extend focused tests to cover success, timeout, HTTP failure, and retry-then-success cases**
- [x] **Step 4: Run `node --test tests/lipsyncApi.test.js tests/lipsyncAgent.test.js` and verify they pass**
- [x] **Step 5: Run `pnpm run test:tts` and verify the focused TTS suite passes**

## Task 8: Add Manual Review Sampling Guidance

**Files:**
- Modify: `src/agents/ttsQaAgent.js`
- Modify: `src/agents/director.js`
- Test: `tests/ttsQaAgent.test.js`
- Test: `tests/director.project-run.test.js`

- [x] **Step 1: Generate a manual review sample plan in `ttsQaAgent`, covering protagonist, supporting, high-emotion, and close-up dialogue shots**
- [x] **Step 2: Write the sampling guidance into `tts-qa.json` and `manual-review-sample.md`**
- [x] **Step 3: Surface the suggested sample set in `delivery-summary.md` alongside lip-sync manual-review shots**
- [x] **Step 4: Run `node --test tests/ttsQaAgent.test.js tests/director.project-run.test.js` and verify they pass**
- [x] **Step 5: Run `pnpm run test:tts` and verify the focused TTS suite passes**

## Task 9: Add Lip-sync Fallback Summary Metrics

**Files:**
- Modify: `src/agents/lipsyncAgent.js`
- Test: `tests/lipsyncAgent.test.js`

- [x] **Step 1: Add aggregate `fallbackCount` / `fallbackShots` fields to `lipsync-report.json`**
- [x] **Step 2: Extend focused tests to verify fallback summary metrics both when unused and when hit**
- [x] **Step 3: Run `node --test tests/lipsyncAgent.test.js` and verify it passes**
- [x] **Step 4: Run `pnpm run test:tts` and verify the focused TTS suite passes**

## Task 10: Align Lip-sync Fallback Terminology and Policy

**Files:**
- Modify: `src/apis/lipsyncApi.js`
- Modify: `src/agents/director.js`
- Modify: `docs/agents/tts-agent.md`
- Test: `tests/lipsyncApi.test.js`
- Test: `tests/director.project-run.test.js`

- [x] **Step 1: Align summary/report terminology around `fallbackCount` / `fallbackShots` and keep shot-level fields as `fallbackApplied` / `fallbackFrom`**
- [x] **Step 2: Restrict provider fallback switching to retryable error classes (`timeout`, `network_error`, `provider_5xx`)**
- [x] **Step 3: Add focused tests to verify 5xx does fall back while 4xx does not**
- [x] **Step 4: Run `node --test tests/lipsyncApi.test.js tests/director.project-run.test.js` and verify they pass**
- [x] **Step 5: Run `pnpm run test:tts` and verify the focused TTS suite passes**

## Task 11: Surface Lip-sync Fallback Summary In Agent Manifest

**Files:**
- Modify: `src/agents/lipsyncAgent.js`
- Modify: `docs/agents/tts-agent.md`
- Test: `tests/lipsyncAgent.test.js`

- [x] **Step 1: Add `fallbackCount` / `fallbackShots` plus manual-review summary fields to `08b-lipsync-agent/manifest.json`**
- [x] **Step 2: Extend focused tests to verify manifest quick-look metrics both when fallback is unused and when it is hit**
- [x] **Step 3: Update docs so run-package readers know the manifest now carries lip-sync summary counters**
- [x] **Step 4: Run `node --test tests/lipsyncAgent.test.js` and verify it passes**

## Task 12: Align Runtime Docs With Lip-sync Agent Directory Layout

**Files:**
- Modify: `docs/runtime/temp-structure.md`
- Modify: `docs/runtime/output-structure.md`
- Modify: `docs/sop/runbook.md`

- [x] **Step 1: Update run-package examples from legacy `08-video-composer` references to the current `09-video-composer` path**
- [x] **Step 2: Add `08b-lipsync-agent` to troubleshooting guidance so lip-sync failures and fallback evidence have a clear lookup path**
- [x] **Step 3: Verify the updated docs no longer point primary FFmpeg troubleshooting to the old directory numbering**

## Task 13: Add Beginner-friendly QA Summaries Across Agents

**Files:**
- Create: `src/utils/qaSummary.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/scriptParser.js`
- Modify: `src/agents/characterRegistry.js`
- Modify: `src/agents/promptEngineer.js`
- Modify: `src/agents/imageGenerator.js`
- Modify: `src/agents/consistencyChecker.js`
- Modify: `src/agents/continuityChecker.js`
- Modify: `src/agents/ttsAgent.js`
- Modify: `src/agents/ttsQaAgent.js`
- Modify: `src/agents/lipsyncAgent.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `docs/agents/README.md`
- Modify: `docs/sop/qa-acceptance.md`
- Test: `tests/ttsAgent.artifacts.test.js`
- Test: `tests/pipeline.acceptance.test.js`

- [x] **Step 1: Add a shared QA summary writer so agents can emit a uniform `qa-summary.md/json` pair**
- [x] **Step 2: Teach major agents to write beginner-friendly QA headlines, pass items, risks, blockers, next steps, and evidence paths**
- [x] **Step 3: Make Director aggregate per-agent summaries into run-level `qa-overview.md/json`**
- [x] **Step 4: Update focused tests to verify agent-level summaries and run-level overview files are produced**
- [x] **Step 5: Update QA docs so the repository no longer claims a unified QA summary layer is missing**
- [x] **Step 6: Run `pnpm run test:tts` and verify the focused TTS suite passes**
