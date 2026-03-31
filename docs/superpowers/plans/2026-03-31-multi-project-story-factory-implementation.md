# Multi-Project Story Factory Implementation Plan

> Status sync on `2026-03-31`: Tasks `1-10` are implemented on this branch. This document now acts as a compact execution ledger rather than a future-only checklist.

## Completed Tasks

- [x] Task 1: Define Content DTOs for Project / Script / Episode / ShotPlan
- [x] Task 2: Define Character DTOs and ShotCharacter Relationship
- [x] Task 3: Define Asset DTOs for Keyframes, Animation Clips, Voice, Subtitle, Episode Cut
- [x] Task 4: Add Local Project Store for Multi-Project JSON Persistence
- [x] Task 5: Upgrade Script Parsing to Support Script -> Episodes -> ShotPlans
- [x] Task 6: Upgrade Director to Run at Episode Granularity
- [x] Task 7: Upgrade Characters and Prompt/TTS Inputs to Use EpisodeCharacter and ShotCharacter
- [x] Task 8: Introduce KeyframeAsset and AnimationClip as First-Class Runtime Objects
- [x] Task 9: Add Project-Oriented CLI Entry and Example Project Structure
- [x] Task 10: Add RunJob and AgentTaskRun as Observability Layer

## Verification Notes

Focused regression coverage added during implementation:

- `tests/projectModel.test.js`
- `tests/characterModel.test.js`
- `tests/projectStore.test.js`
- `tests/scriptParser.test.js`
- `tests/director.project-run.test.js`
- `tests/ttsAgent.test.js`
- `tests/videoComposer.test.js`
- `tests/runCli.test.js`
- `tests/jobStore.test.js`

Observed command results on this branch:

- `node --test tests/jobStore.test.js tests/director.project-run.test.js`
  Result: PASS (`10` tests, `0` failures)
- `node --test --test-isolation=none tests/projectModel.test.js tests/characterModel.test.js tests/projectStore.test.js tests/scriptParser.test.js tests/director.project-run.test.js tests/ttsAgent.test.js tests/videoComposer.test.js tests/runCli.test.js tests/jobStore.test.js`
  Result: PASS (`57` tests, `0` failures)
- `pnpm test`
  Result: FAIL in local/offline environments because it runs the real CLI pipeline against external LLM APIs and currently returns `401` without valid credentials

## Final Status

- [x] Task 11: Final Review and Documentation Sync

Task 11 completed with three outcomes:

1. Reconcile README with the actual episode-level runtime model.
2. Keep the design doc honest about what is implemented vs. still deferred.
3. Preserve the distinction between focused unit tests and the API-backed `pnpm test` smoke run.
