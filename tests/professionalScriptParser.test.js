import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProfessionalScript } from '../src/agents/professionalScriptParser.js';

const GENERIC_SCRIPT = `
《霜刃契约》短剧剧本
【tag】
古风、悬疑、双强

【世界观前置说明】
雪都被结界封锁，城中所有契约都会留下银色烙印。

第1集《雪门》
【场景】 雪都城门·夜

【画面1】
远景。暴雪压城，城门上悬着银色契约印。
SFX：风雪呼啸。

【画面2】
特写。沈砚抬手，掌心烙印亮起。
系统音：契约者身份确认。
沈砚（低声）：门开了。

【画面3】
黑屏。
字幕浮现：第1集·雪门 完。

第2集《入城》
【场景】 雪都长街·夜

【画面1】
中景。洛迟从灯影里走出，挡住沈砚。
洛迟：你不该来。
`;

test('parseProfessionalScript maps every picture block to one shot', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);

  assert.equal(result.title, '霜刃契约');
  assert.equal(result.episodes.length, 2);
  assert.equal(result.shots.length, 4);
  assert.deepEqual(result.shots.map((shot) => shot.source.pictureNo), [1, 2, 3, 1]);
  assert.deepEqual(result.shots.map((shot) => shot.source.episodeNo), [1, 1, 1, 2]);
});

test('parseProfessionalScript preserves scene and authored order', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);

  assert.equal(result.shots[0].scene, '雪都城门·夜');
  assert.equal(result.shots[2].blackScreen, true);
  assert.equal(result.shots[3].scene, '雪都长街·夜');
  assert.equal(result.shots[3].speaker, '洛迟');
  assert.equal(result.shots[3].dialogue, '你不该来。');
});

test('parseProfessionalScript preserves audio cues, sfx, subtitles, and raw block', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);
  const shot = result.shots[1];

  assert.deepEqual(shot.audioCues, [
    { type: 'system_voice', speaker: '系统音', text: '契约者身份确认。' },
    { type: 'dialogue', speaker: '沈砚', performance: '低声', text: '门开了。' },
  ]);
  assert.equal(result.shots[0].sfx[0].text, '风雪呼啸。');
  assert.equal(result.shots[2].subtitle, '第1集·雪门 完。');
  assert.match(shot.source.rawBlock, /【画面2】/);
});

test('parseProfessionalScript extracts generic character names from dialogue and action', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);

  assert.deepEqual(
    result.characters.map((character) => character.name),
    ['沈砚', '洛迟']
  );
  assert.deepEqual(result.shots[1].characters, ['沈砚']);
  assert.deepEqual(result.shots[3].characters, ['洛迟', '沈砚']);
});

test('parseProfessionalScript blocks professional input with no picture blocks', () => {
  assert.throws(
    () => parseProfessionalScript('第1集《空镜》\n【场景】 空房间'),
    /professional-script 模式未找到任何【画面N】/
  );
});
