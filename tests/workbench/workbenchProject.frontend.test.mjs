import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearRequestCache,
  fetchStoryboard,
  updateStoryboardShot,
  fetchWorkbenchProject,
  updateVoiceAsset,
} from '../../views/src/lib/workbench.ts';
import { resolveSelectedClipId } from '../../views/src/components/review/reviewSelection.ts';

test('fetchWorkbenchProject prefers episode detail over snapshot for edited assets', async () => {
  clearRequestCache();
  const originalFetch = global.fetch;

  const responses = new Map([
    ['/api/projects/project_demo', {
      id: 'project_demo',
      title: '演示项目',
      latestRunId: 'run_latest',
      runCount: 1,
      scripts: [
        {
          id: 'script_demo',
          title: '第一季',
          episodes: [
            {
              id: 'episode_demo',
              title: '第一集',
              runs: [
                {
                  id: 'run_latest',
                  status: 'warn',
                  startedAt: '2026-06-20T08:00:00.000Z',
                  finishedAt: '2026-06-20T08:10:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    }],
    ['/api/runs/run_latest', {
      id: 'run_latest',
      projectId: 'project_demo',
      scriptId: 'script_demo',
      episodeId: 'episode_demo',
      scriptTitle: '第一季',
      episodeTitle: '第一集',
      status: 'warn',
      artifactRunDir: 'artifacts/run_latest',
      qaOverview: null,
      artifacts: null,
    }],
    ['/artifacts/run_latest/state.snapshot.json', {
      scriptData: {
        shots: [
          {
            id: 'shot_001',
            scene: '旧场景',
            dialogue: '旧对白',
            duration: 3,
            camera_type: 'wide',
            characters: ['旧角色'],
          },
        ],
      },
      characterRegistry: [
        {
          id: 'char_old',
          episodeCharacterId: 'char_old',
          name: '旧角色',
          personality: '旧性格',
          basePromptTokens: 'old',
        },
      ],
      scenePacks: [
        {
          scene_id: 'scene_old',
          scene_title: '旧场景',
          scene_goal: '旧目标',
          location_anchor: '旧地点',
          cast: ['旧角色'],
          visual_motif: '旧母题',
          validation_status: 'stale',
          validation_issues: ['old'],
          action_beats: [{ shot_ids: ['shot_001'] }],
        },
      ],
      audioVoiceResolution: [
        {
          shotId: 'shot_001',
          segmentId: 'seg_old',
          hasDialogue: true,
          dialogue: '旧对白',
          speakerName: '旧角色',
          resolvedGender: '男',
          ttsOptions: { provider: 'old-provider', gender: '男' },
          voiceSource: 'snapshot',
          usedDefaultVoiceFallback: true,
        },
      ],
    }],
    ['/api/projects/project_demo/scripts/script_demo/episodes/episode_demo', {
      id: 'episode_demo',
      title: '第一集',
      shots: [
        {
          id: 'shot_001',
          scene: '新场景',
          dialogue: '新对白',
          duration: 6,
          camera_type: 'close-up',
          characters: ['新角色'],
        },
      ],
      characters: [
        {
          id: 'char_new',
          name: '新角色',
          gender: '女',
          age: '19',
          personality: '新性格',
          visualDescription: '新外观',
          promptTokens: 'new-token',
          scenes: ['新场景'],
          shotCount: 1,
        },
      ],
      scenes: [
        {
          id: 'scene_new',
          title: '新场景',
          goal: '新目标',
          location: '新地点',
          cast: ['新角色'],
          visualMotif: '新母题',
          validationStatus: 'ready',
          validationIssues: [],
        },
      ],
      voices: [
        {
          id: 'voice_new',
          name: '新角色音色',
          provider: 'new-provider',
          gender: '女',
          voiceSource: 'episode',
          characterNames: ['新角色'],
          segmentCount: 1,
          shotCount: 1,
          fallbackUsed: false,
        },
      ],
    }],
  ]);

  global.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    const pathname = new URL(url, 'http://127.0.0.1').pathname;
    if (!responses.has(pathname)) {
      return { ok: false, status: 404, json: async () => ({ error: `missing mock for ${pathname}` }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => responses.get(pathname),
    };
  };

  try {
    const project = await fetchWorkbenchProject('project_demo', {
      scriptId: 'script_demo',
      episodeId: 'episode_demo',
    });

    assert.equal(project.shots[0].scene, '新场景');
    assert.equal(project.shots[0].dialogue, '新对白');
    assert.equal(project.characters[0].name, '新角色');
    assert.equal(project.characters[0].personality, '新性格');
    assert.equal(project.characters[0].voice.provider, 'new-provider');
    assert.equal(project.scenes[0].title, '新场景');
    assert.equal(project.scenes[0].goal, '新目标');
    assert.equal(project.voices[0].name, '新角色音色');
    assert.equal(project.voices[0].provider, 'new-provider');
  } finally {
    global.fetch = originalFetch;
    clearRequestCache();
  }
});

test('updateVoiceAsset sends voice patch for character-integrated voice editing', async () => {
  clearRequestCache();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const pathname = new URL(url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/projects/project_demo/scripts/script_demo/episodes/episode_demo/voices/%E6%B2%88%E6%B8%85') {
      requests.push({
        method: init?.method || 'GET',
        body: init?.body,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: `missing mock for ${pathname}` }) };
  };

  try {
    await updateVoiceAsset('project_demo', 'script_demo', 'episode_demo', '沈清', {
      name: '沈清配音',
      provider: 'minimax',
      gender: 'female',
      voiceSource: 'Chinese (Mandarin)_Warm_Girl',
      characterNames: ['沈清'],
    });

    assert.deepEqual(requests, [
      {
        method: 'PUT',
        body: JSON.stringify({
          name: '沈清配音',
          provider: 'minimax',
          gender: 'female',
          voiceSource: 'Chinese (Mandarin)_Warm_Girl',
          characterNames: ['沈清'],
        }),
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    clearRequestCache();
  }
});

test('resolveSelectedClipId falls back to the first filtered clip', () => {
  const filteredClips = [
    { id: 'clip_b' },
    { id: 'clip_c' },
  ];

  assert.equal(resolveSelectedClipId(filteredClips, 'clip_a'), 'clip_b');
  assert.equal(resolveSelectedClipId(filteredClips, 'clip_c'), 'clip_c');
  assert.equal(resolveSelectedClipId([], 'clip_c'), null);
});

test('storyboard emotion is normalized and updateStoryboardShot sends emotion patch', async () => {
  clearRequestCache();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const pathname = new URL(url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/projects/project_demo/scripts/script_demo/episodes/episode_demo/storyboard') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          projectId: 'project_demo',
          scriptId: 'script_demo',
          episodeId: 'episode_demo',
          title: '第一集',
          shots: [
            {
              id: 'shot_001',
              scene: '控制室',
              dialogue: '收到',
              emotion: 'tense',
              durationSec: 4,
            },
          ],
        }),
      };
    }
    if (pathname === '/api/projects/project_demo/scripts/script_demo/episodes/episode_demo/shots/shot_001') {
      requests.push({
        method: init?.method || 'GET',
        body: init?.body,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: `missing mock for ${pathname}` }) };
  };

  try {
    const storyboard = await fetchStoryboard('project_demo', 'script_demo', 'episode_demo');
    assert.equal(storyboard.shots[0].emotion, 'tense');
    await updateStoryboardShot('project_demo', 'script_demo', 'episode_demo', 'shot_001', { emotion: 'relieved' });

    assert.deepEqual(requests, [
      {
        method: 'PUT',
        body: JSON.stringify({ emotion: 'relieved' }),
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    clearRequestCache();
  }
});
