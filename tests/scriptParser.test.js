import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decomposeScriptToEpisodes,
  parseEpisodeToShots,
  parseScript,
  parseScriptToEpisodes,
} from '../src/agents/scriptParser.js';
import {
  EPISODE_STORYBOARD_SYSTEM,
  EPISODE_STORYBOARD_USER,
  SCRIPT_DECOMPOSITION_SYSTEM,
  SCRIPT_DECOMPOSITION_USER,
} from '../src/llm/prompts/scriptAnalysis.js';

test('parseScript compatibility bridge flattens episode shots into legacy shape', async () => {
  const calls = [];
  const fakeChatJSON = async (messages) => {
    calls.push(messages);

    if (calls.length === 1) {
      return {
        title: '宫墙疑云',
        totalDuration: 12,
        characters: [{ name: '沈清', gender: 'female', age: '20多岁' }],
        episodes: [
          { episodeNo: 1, title: '第一集', summary: '沈清夜探冷宫' },
          { episodeNo: 2, title: '第二集', summary: '她发现密信' },
        ],
      };
    }

    if (calls.length === 2) {
      return {
        shots: [
          { scene: '冷宫外夜色', characters: [{ name: '沈清' }], action: '潜入', camera_type: '远景' },
          { id: 'custom_shot', scene: '长廊', characters: ['沈清'], dialogue: '有人来了', speaker: '沈清', duration: 5 },
        ],
      };
    }

    return {
      shots: [
        { scene: '偏殿烛火', action: '展开密信', emotion: '震惊' },
      ],
    };
  };

  const result = await parseScript('测试剧本', { chatJSON: fakeChatJSON });

  assert.equal(result.title, '宫墙疑云');
  assert.equal(result.totalDuration, 12);
  assert.deepEqual(result.characters, [{ name: '沈清', gender: 'female', age: '20多岁' }]);
  assert.equal(result.shots.length, 3);
  assert.equal(result.shots[0].id, 'shot_001');
  assert.deepEqual(result.shots[0].characters, ['沈清']);
  assert.equal(result.shots[0].duration, 3);
  assert.equal(result.shots[0].dialogue, '');
  assert.equal(result.shots[0].speaker, '');
  assert.equal(result.shots[1].id, 'custom_shot');
  assert.equal(result.shots[2].id, 'shot_003');
});

test('parseEpisodeToShots normalizes defaults and generates sequential ids', async () => {
  const result = await parseEpisodeToShots(
    { summary: '测试分集' },
    {
      chatJSON: async () => ({
        shots: [
          { scene: '屋顶', characters: [{ name: '阿九' }], action: '俯视街道' },
          { scene: '巷口', characters: [], dialogue: '快走', speaker: '阿九', duration: 4 },
        ],
      }),
    }
  );

  assert.equal(result.shots.length, 2);
  assert.equal(result.shots[0].id, 'shot_001');
  assert.equal(result.shots[1].id, 'shot_002');
  assert.equal(result.shots[0].duration, 3);
  assert.equal(result.shots[0].dialogue, '');
  assert.equal(result.shots[0].speaker, '');
  assert.deepEqual(result.shots[0].characters, ['阿九']);
  assert.deepEqual(result.shots[1].characters, []);
});

test('parseEpisodeToShots rejects malformed storyboard payloads', async () => {
  await assert.rejects(
    parseEpisodeToShots('测试分集', {
      chatJSON: async () => ({ storyboard: [] }),
    }),
    /分镜解析结果缺少 shots 数组/
  );
});

test('new parser APIs accept injected chatJSON without network access', async () => {
  const calls = [];
  const fakeChatJSON = async (_messages, _options) => {
    calls.push(true);

    if (calls.length === 1) {
      return {
        title: '双生局',
        totalDuration: 8,
        characters: [],
        episodes: [{ episodeNo: 1, title: '开局', summary: '主角相遇' }],
      };
    }

    return {
      shots: [{ scene: '茶楼', action: '对视' }],
    };
  };

  const episodesResult = await decomposeScriptToEpisodes('测试剧本', { chatJSON: fakeChatJSON });
  const shotsResult = await parseEpisodeToShots('主角相遇', { chatJSON: fakeChatJSON });

  assert.equal(episodesResult.title, '双生局');
  assert.equal(episodesResult.episodes.length, 1);
  assert.equal(shotsResult.shots.length, 1);
  assert.equal(calls.length, 2);
});

test('parseScriptToEpisodes remains an alias of decomposeScriptToEpisodes', async () => {
  const fakeChatJSON = async () => ({
    title: '别枝惊鹊',
    totalDuration: 6,
    characters: [],
    episodes: [{ episodeNo: 1, title: '第一集', summary: '夜行追查' }],
  });

  const aliasResult = await parseScriptToEpisodes('测试剧本', { chatJSON: fakeChatJSON });
  const plannedResult = await decomposeScriptToEpisodes('测试剧本', { chatJSON: fakeChatJSON });

  assert.deepEqual(aliasResult, plannedResult);
});

test('decomposeScriptToEpisodes falls back from legacy top-level shots payload', async () => {
  const result = await decomposeScriptToEpisodes('测试剧本', {
    chatJSON: async () => ({
      title: '旧结构',
      totalDuration: 5,
      characters: [],
      shots: [{ scene: '桥上', action: '回望' }],
    }),
  });

  assert.equal(result.title, '旧结构');
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].episodeNo, 1);
  assert.equal(result.episodes[0].title, '第1集');
  assert.equal(result.episodes[0].summary, '');
  assert.deepEqual(result.episodes[0].shots, [{ scene: '桥上', action: '回望' }]);
});

test('decomposeScriptToEpisodes normalizes invalid episode metadata to sane defaults', async () => {
  const result = await decomposeScriptToEpisodes('测试剧本', {
    chatJSON: async () => ({
      title: '断案录',
      totalDuration: 9,
      characters: [],
      episodes: [
        { episodeNo: 0, title: '', summary: '' },
        { episodeNo: null, title: undefined, summary: null },
      ],
    }),
  });

  assert.deepEqual(
    result.episodes.map(({ episodeNo, title, summary }) => ({ episodeNo, title, summary })),
    [
      { episodeNo: 1, title: '第1集', summary: '' },
      { episodeNo: 2, title: '第2集', summary: '' },
    ]
  );
});

test('script analysis prompts expose planned decomposition and episode storyboard names', () => {
  assert.equal(typeof SCRIPT_DECOMPOSITION_SYSTEM, 'string');
  assert.equal(typeof SCRIPT_DECOMPOSITION_USER, 'function');
  assert.equal(typeof EPISODE_STORYBOARD_SYSTEM, 'string');
  assert.equal(typeof EPISODE_STORYBOARD_USER, 'function');
});
