# QA Auditor Agent Design

## Goal

Add a project-level audit agent that reviews outputs across the full pipeline and decides whether the run should continue, continue with warnings, or stop because the result does not meet minimum standards.

This agent is intended to fill a gap in the current architecture:

- `director` orchestrates execution and retries
- `consistencyChecker` validates only visual consistency
- no existing agent owns end-to-end quality acceptance across all major artifacts

The new agent will be a `mixed-mode`, `graded` auditor:

- rules-first for deterministic checks
- optional LLM-assisted judgment only for subjective quality checks later
- three result levels: `pass`, `warn`, `block`

## Current Context

The current runtime flow is:

1. `scriptParser`
2. `characterRegistry`
3. `promptEngineer`
4. `imageGenerator`
5. `consistencyChecker`
6. `ttsAgent`
7. `videoComposer`

`director` coordinates the stages, persists `state.json`, and writes `RunJob` plus `AgentTaskRun` observability data.

The project already has:

- stage caching in `temp/<jobId>/state.json`
- run-level observability in `temp/projects/<projectId>/.../run-jobs/<runJobId>.json`
- a clear single orchestrator in `src/agents/director.js`

The design should preserve that single-orchestrator architecture.

## Design Summary

Introduce a new runtime agent:

- file: `src/agents/qaAuditor.js`
- role: validate outputs from all major pipeline stages
- integration point: invoked by `director` after key milestones

The auditor does not repair artifacts and does not orchestrate other agents.
It only evaluates results and returns a structured audit report that `director` consumes.

## Recommended Approach

Use a mixed-mode graded auditor.

### Why not a rules-only auditor

Rules-only is stable and testable, but it cannot later express subjective checks such as:

- whether a prompt appears too weak for a shot
- whether a generated image obviously misses the intended action
- whether a final result feels materially off-tone

### Why not an LLM-first auditor

LLM-first would make the whole acceptance layer more expensive, less deterministic, and harder to regression test.
That is a poor fit for an MVP pipeline that already depends on several external services.

### Why mixed-mode is the best fit

Mixed-mode keeps the first release reliable:

- structural and file-level acceptance uses deterministic code
- subjective review can be added later behind explicit hooks
- the project gets an end-to-end quality gate without destabilizing the pipeline

## Audit Model

Each audit stage returns a normalized result object:

```json
{
  "stage": "asset_audit",
  "status": "warn",
  "findings": [
    {
      "severity": "warn",
      "code": "LOW_CONSISTENCY_SCORE",
      "message": "Character consistency is borderline for shot_003",
      "shotId": "shot_003"
    }
  ],
  "summary": "Assets are usable but one shot needs review",
  "metrics": {
    "totalFindings": 1,
    "blockCount": 0,
    "warnCount": 1
  }
}
```

### Result Semantics

- `pass`: no blocking issues and no warnings
- `warn`: non-blocking quality issues; pipeline may continue
- `block`: pipeline must stop

### Finding Shape

Each finding should follow one consistent schema:

```json
{
  "severity": "warn",
  "code": "PROMPT_TOO_SHORT",
  "message": "shot_003 prompt is too short",
  "shotId": "shot_003"
}
```

Optional extra keys may be attached for context, such as `characterName`, `path`, or `details`.

## Audit Stages

The first release should include five audit stages.

### 1. `script_audit`

Purpose: verify that parsed script output is usable by downstream agents.

`block` conditions:

- missing `title`
- `shots` is not an array or is empty
- any shot is missing `id`
- all shots lack usable scene, action, and dialogue content

`warn` conditions:

- role names appear in shots but the top-level character list is empty
- one or more shot durations are missing or invalid
- one or more shots are too sparse and may lead to weak prompts

### 2. `character_audit`

Purpose: verify that the character registry can support image generation and voice generation.

`block` conditions:

- script has characters but `characterRegistry` is empty
- a registry entry is missing `name`
- a major shot character cannot be matched to a registry entry

`warn` conditions:

- missing `basePromptTokens`
- `visualDescription` is too short
- voice-relevant metadata is weak and TTS will likely fall back to defaults

### 3. `prompt_audit`

Purpose: verify that every shot has a usable visual prompt.

`block` conditions:

- prompt list is empty
- a shot has no matching prompt
- `image_prompt` is empty

`warn` conditions:

- prompt is too short
- a character-driven shot does not reflect character tokens
- prompt lacks style or camera cues that normally stabilize output

### 4. `asset_audit`

Purpose: verify images, consistency outcomes, and audio assets before final composition.

`block` conditions:

- a required image is missing or marked failed
- a dialogue shot has no audio file
- consistency review requests regeneration but the final required image is still unusable

`warn` conditions:

- consistency is borderline but not blocking
- a non-dialogue shot naturally has no audio and is recorded only for observability
- an audio result looks abnormal and may cause timing issues later

### 5. `final_audit`

Purpose: verify the final deliverable exists and is minimally publishable.

`block` conditions:

- `composeVideo` did not produce an output path
- output path does not exist

`warn` conditions:

- file size is suspiciously small
- the final video was produced from degraded intermediate assets and may need manual review

## Director Integration

`director` remains the only orchestrator.

The auditor should be invoked after these milestones:

1. after character registry is ready:
   - `script_audit`
   - `character_audit`
2. after prompts are ready:
   - `prompt_audit`
3. after images, consistency handling, and audio are ready:
   - `asset_audit`
4. after video composition:
   - `final_audit`

### Director Behavior

For every audit result:

- if any finding has severity `block`, `director` throws and stops the run
- if findings are only `warn`, `director` records them and continues
- if the audit passes, `director` continues normally

This preserves one control loop and avoids creating a second orchestrator inside the auditor.

## State and Observability

The auditor should integrate with existing persistence rather than invent a parallel store.

### `state.json`

Add a `qaAudits` field:

```json
{
  "qaAudits": {
    "script_audit": {},
    "character_audit": {},
    "prompt_audit": {},
    "asset_audit": {},
    "final_audit": {}
  }
}
```

This allows:

- resumable runs
- inspection of past audit outcomes
- deterministic stage reuse where appropriate

### `AgentTaskRun`

Add dedicated audit task runs, for example:

- `audit_script`
- `audit_character`
- `audit_prompt`
- `audit_assets`
- `audit_final`

These should record:

- `status`
- `detail`
- `startedAt`
- `finishedAt`
- summarized finding counts
- blocking error text when applicable

## Boundaries

To keep the first release focused:

- the auditor must not directly repair artifacts
- the auditor must not call generation agents itself
- the auditor must not become a second orchestrator
- LLM-backed subjective review should be optional and disabled by default

Repair and retry logic stays in `director`.

## Testing Strategy

The first implementation should be rules-first so it can be tested with stable unit tests.

Recommended test coverage:

1. `qaAuditor` unit tests
   - `pass`, `warn`, and `block` cases for each audit stage
2. `director` integration tests
   - warns do not stop the pipeline
   - blocks stop the pipeline
   - audit results are persisted into `state.json`
   - audit task runs are appended into run observability

LLM-assisted auditing should not be part of the first test surface.

## Risks

### Overblocking

If rules are too strict, the pipeline will stop on acceptable outputs.

Mitigation:

- keep first-release blocking criteria minimal and objective
- put softer heuristics into `warn`

### Duplicate logic

Some checks may overlap with existing agents.

Mitigation:

- let each worker agent keep generation logic
- let `qaAuditor` own acceptance logic only

### Audit drift

As pipeline contracts evolve, audit rules may become stale.

Mitigation:

- keep rule checks close to the actual output schemas
- update tests when agent contracts change

## Implementation Direction

The first implementation should prioritize:

1. create `src/agents/qaAuditor.js`
2. implement deterministic stage auditors
3. integrate the auditor into `director`
4. persist audit outputs to `state.json`
5. expose audit runs through `AgentTaskRun`
6. add unit and integration tests

LLM-assisted audit extensions can be added later behind explicit options or environment flags.
