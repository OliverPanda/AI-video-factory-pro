# Professional Script Default Input Mode Design

## Goal

Make `professional-script` the default input behavior for the CLI and production pipeline.

The pipeline should treat authored short-drama scripts as execution instructions, not raw material for rewrite. A professional script that already contains episode headings, scene blocks, picture beats, dialogue, sound effects, system voice, black screens, or subtitles must be structurally extracted and preserved.

`raw-novel` remains available as an explicit adaptation mode for unstructured prose, outlines, and wild source text.

## Decision

Default CLI behavior changes to:

```bash
node scripts/run.js samples/双生囚笼.txt
# equivalent to:
node scripts/run.js samples/双生囚笼.txt --input-format=professional-script
```

Raw novel adaptation becomes opt-in:

```bash
node scripts/run.js samples/source.txt --input-format=raw-novel
```

Optional auto detection can exist later, but it should not replace the default product mental model. The default assumption is that the user gave us a production-ready script.

## Current Problem

The current `parseScript(...)` path always performs two LLM-driven passes:

1. `decomposeScriptToEpisodes(...)`
2. `parseEpisodeToShots(...)`

That behavior is reasonable for raw prose, but harmful for professional scripts. For example, `双生囚笼` episode 1 contains 10 authored `【画面N】` beats, but the current run compressed it into 6 shots. That loses authorial timing, picture ordering, SFX, black-screen instructions, subtitle beats, and other production signals.

## Input Modes

### `professional-script`

Default mode.

Used for scripts with explicit production structure, such as:

- `第1集《链接》`
- `【场景】 游戏登录空间·虚空蓝光`
- `【画面1】`
- `SFX：低频电流嗡鸣`
- `系统音：身份确认。设计师权限。角色载入中。`
- `陆衍（低头看手，自嘲）：辅助？奶妈。`
- `黑屏。`
- `字幕浮现：第1集·链接 完。`

Rules:

- Episode headings define episode boundaries.
- `【场景】` defines the default scene for following picture beats until changed.
- Each `【画面N】` maps to exactly one shot.
- Picture beats must not be merged, removed, reordered, or rewritten.
- Dialogue, speaker names, parenthetical performance notes, SFX, system voice, narration, subtitles, and black-screen instructions should be preserved as structured fields.
- LLM assistance may fill missing metadata, but must not alter shot count or shot order.

### `raw-novel`

Explicit mode.

Used for unstructured source text:

- Web novel chapters
- Plot summaries
- Prose scenes
- Rough outlines
- User-described story ideas

Rules:

- LLM may adapt prose into episodes.
- LLM may create shot structure.
- LLM may estimate duration, camera type, action, and dialogue.
- This mode keeps the existing creative parsing behavior.

### `auto`

Optional future convenience mode.

Detection should be transparent and overrideable. If implemented, obvious professional markers such as `【画面\d+】` should select `professional-script`. But the CLI default should still be `professional-script`.

## CLI Contract

Add:

```bash
--input-format=professional-script|raw-novel|auto
```

Default:

```text
professional-script
```

Invalid values should fail fast with a clear usage error.

The selected input format should be persisted in parser artifacts:

```json
{
  "inputFormat": "professional-script",
  "parserMode": "deterministic-professional-script",
  "fallbackUsed": false
}
```

## Parser Architecture

Introduce a small mode router in the script parser layer:

```text
parseScript(scriptText, deps)
  -> resolveInputFormat(deps.inputFormat || default)
  -> professional-script: parseProfessionalScript(scriptText, deps)
  -> raw-novel: parseRawNovelScript(scriptText, deps)
  -> auto: detectInputFormat(scriptText), then route
```

`parseRawNovelScript(...)` can wrap the current `decomposeScriptToEpisodes(...) + parseEpisodeToShots(...)` behavior.

`parseProfessionalScript(...)` should be deterministic first:

- Parse episode blocks.
- Parse scene markers.
- Parse picture markers.
- Extract speaker/dialogue/SFX/system/subtitle/black-screen lines.
- Normalize to the existing `{ title, totalDuration, characters, shots }` compatibility output.

LLM use in professional mode should be limited to clearly bounded enrichment:

- Character metadata extraction when absent.
- Duration estimation if deterministic duration is unavailable.
- Optional camera type normalization from authored text.

It must not change the number or order of authored picture beats.

## Shot Shape

The existing downstream contract can remain compatible:

```json
{
  "id": "shot_001",
  "scene": "游戏登录空间·虚空蓝光",
  "characters": ["陆衍"],
  "speaker": "系统音",
  "action": "特写。一双紧闭的眼睛猛然睁开——陆衍的瞳孔里倒映着飞速滚动的代码。",
  "dialogue": "身份确认。设计师权限。角色载入中。",
  "emotion": "冰冷、悬疑、系统载入",
  "camera_type": "特写",
  "duration": 3,
  "source": {
    "inputFormat": "professional-script",
    "episodeNo": 1,
    "episodeTitle": "链接",
    "pictureNo": 2,
    "rawBlock": "【画面2】..."
  },
  "audioCues": [
    { "type": "system_voice", "speaker": "系统音", "text": "身份确认。设计师权限。角色载入中。" }
  ],
  "sfx": [],
  "subtitle": null,
  "blackScreen": false
}
```

Downstream agents may ignore new fields initially. The important compatibility fields remain `id`, `scene`, `characters`, `speaker`, `action`, `dialogue`, `emotion`, `camera_type`, and `duration`.

## Data Flow

Professional script path:

```text
CLI
  -> parseCliArgs(inputFormat default professional-script)
  -> director.runPipeline(..., { inputFormat })
  -> scriptParser.parseScript(..., { inputFormat })
  -> parseProfessionalScript
  -> runEpisodePipeline
  -> character registry / prompts / images / QA / video routing
```

Raw novel path:

```text
CLI --input-format=raw-novel
  -> scriptParser.parseScript(..., { inputFormat: "raw-novel" })
  -> current LLM decomposition and storyboard flow
```

Project mode should also accept `options.inputFormat` when project data needs to be created from source text. Existing persisted `episode.shots` should not be reparsed during a normal episode run.

## Error Handling

Professional parser should fail loudly when a document looks professional but cannot produce shots:

- No episode headings and no picture blocks: suggest `--input-format=raw-novel`.
- Episode found but no `【画面N】`: either parse scene body as one shot or block with a clear diagnostic. Prefer blocking for the first implementation to avoid silent rewrites.
- Duplicate picture numbers: preserve order, normalize shot IDs, and record duplicate numbers in parser metrics.
- Missing scene: use episode title as scene fallback and warn in parser metrics.
- Malformed dialogue line: keep it in `action` or `audioCues` rather than dropping it.

Raw novel parser keeps current LLM validation errors.

## Artifacts And Metrics

Add or extend parser artifacts:

- `0-inputs/parser-config.json`
  - `inputFormat`
  - `parserMode`
  - `detectedFormat` when `auto`
  - `fallbackUsed`
- `1-outputs/shots.flat.json`
- `1-outputs/shots.table.md`
- `1-outputs/professional-script-structure.json`
- `2-metrics/parser-metrics.json`
  - `input_format`
  - `episode_count`
  - `picture_block_count`
  - `shot_count`
  - `preserved_picture_count`
  - `sfx_count`
  - `system_voice_count`
  - `subtitle_count`
  - `black_screen_count`
  - `llm_rewrite_used: false` for professional mode

For `双生囚笼` episode 1, acceptance should show:

- `picture_block_count = 10`
- `shot_count = 10`
- `preserved_picture_count = 10`
- `llm_rewrite_used = false`

## Testing

Add focused tests before implementation changes:

- CLI defaults `inputFormat` to `professional-script`.
- CLI accepts `--input-format=raw-novel`.
- CLI rejects invalid input format.
- Professional parser maps each `【画面N】` to one shot.
- Professional parser preserves SFX, system voice, subtitle, and black-screen cues.
- Professional parser handles multiple episodes.
- Raw novel mode still calls the existing LLM decomposition/storyboard flow.
- `双生囚笼` episode 1 fixture yields 10 shots.

Regression guard:

- A professional script must never produce fewer shots than authored `【画面N】` blocks unless the parser fails explicitly.

## Rollout

1. Add input-format CLI parsing and option propagation.
2. Add deterministic professional parser with tests.
3. Wrap current LLM parser as `raw-novel`.
4. Update artifacts and docs.
5. Re-run `双生囚笼` episode 1 to video-before boundary and confirm 10-shot output.

## Non-Goals

- Do not redesign prompt engineering in this change.
- Do not change video generation behavior.
- Do not require professional scripts to include character bios.
- Do not make `auto` mandatory for the first implementation.
- Do not upload reference images differently as part of this change.

## Open Questions

- Should professional mode split one `【画面N】` containing multiple dialogue turns into sub-shots, or preserve one authored picture beat as one shot? Current decision: preserve one picture beat as one shot.
- Should `【tag】` and worldbuilding blocks feed character/prompt context? Current decision: preserve them in script/episode context but do not turn them into shots.
- Should full 30-episode scripts be split and only the requested episode run by default? Current decision: professional parser should create episode records from all episodes, but a run should target a selected episode when project mode is used.
