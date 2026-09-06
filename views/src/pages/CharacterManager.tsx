import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Mic, PlayCircle, Save, Sparkles, Users } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';
import { updateCharacterAsset, updateVoiceAsset, type WorkbenchCharacter, type WorkbenchVoice } from '../lib/workbench';
import { useToast } from '../components/ToastContext';

function queryValue(searchParams: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) return value;
  }
  return '';
}

const MINIMAX_VOICE_OPTIONS = [
  {
    value: 'Chinese (Mandarin)_Warm_Girl',
    label: '温暖少女',
    gender: 'female',
    traits: ['温柔', '少女', '治愈', '亲和', '善良', '细腻', '内向', '敏感', '学生', '妹妹'],
  },
  {
    value: 'Chinese (Mandarin)_Reliable_Executive',
    label: '可靠成熟男声',
    gender: 'male',
    traits: ['成熟', '沉稳', '可靠', '克制', '领导', '老板', '总裁', '经理', '医生', '警察', '父亲', '导师', '军人', '律师'],
  },
  {
    value: 'Chinese (Mandarin)_Gentleman',
    label: '绅士男声',
    gender: 'male',
    traits: ['优雅', '理性', '稳重', '贵族', '教授', '学者', '管家', '绅士', '医生', '白领', '精英'],
  },
  {
    value: 'Chinese (Mandarin)_Sweet_Girl',
    label: '甜美女声',
    gender: 'female',
    traits: ['活泼', '甜美', '开朗', '元气', '俏皮', '可爱', '网红', '主播', '学生', '少女', '乐观'],
  },
];

const VOICE_MATCH_RULES = [
  {
    voice: 'Chinese (Mandarin)_Reliable_Executive',
    weight: 5,
    keywords: ['总裁', '老板', '领导', '经理', '高管', '军人', '警察', '律师', '父亲', '导师', '成熟', '沉稳', '强势', '可靠'],
  },
  {
    voice: 'Chinese (Mandarin)_Gentleman',
    weight: 4,
    keywords: ['教授', '医生', '学者', '绅士', '贵族', '管家', '白领', '精英', '理性', '优雅', '稳重', '克制'],
  },
  {
    voice: 'Chinese (Mandarin)_Sweet_Girl',
    weight: 5,
    keywords: ['主播', '网红', '学生', '少女', '妹妹', '活泼', '甜美', '开朗', '元气', '俏皮', '可爱', '乐观'],
  },
  {
    voice: 'Chinese (Mandarin)_Warm_Girl',
    weight: 4,
    keywords: ['护士', '老师', '母亲', '姐姐', '温柔', '治愈', '善良', '细腻', '内向', '敏感', '亲和', '冷静'],
  },
];

function normalizeGender(value: string) {
  const text = String(value || '').toLowerCase();
  if (['male', 'm', 'man', 'boy', '男'].includes(text)) return 'male';
  if (['female', 'f', 'woman', 'girl', '女'].includes(text)) return 'female';
  return 'female';
}

function recommendMinimaxVoice(character: WorkbenchCharacter) {
  const gender = normalizeGender(character.gender);
  const profile = [
    character.name,
    character.gender,
    character.age,
    character.roleType,
    character.occupation,
    character.personality,
    character.visualDescription,
    character.promptTokens,
  ].join(' ').toLowerCase();
  const candidates = MINIMAX_VOICE_OPTIONS.filter((item) => item.gender === gender);
  const scored = candidates.map((item) => ({
    item,
    score:
      item.traits.reduce((total, trait) => total + (profile.includes(trait.toLowerCase()) ? 1 : 0), 0) +
      VOICE_MATCH_RULES
        .filter((rule) => rule.voice === item.value)
        .reduce(
          (total, rule) =>
            total + rule.keywords.reduce((keywordTotal, keyword) => keywordTotal + (profile.includes(keyword.toLowerCase()) ? rule.weight : 0), 0),
          0
        ),
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.item || candidates[0] || MINIMAX_VOICE_OPTIONS[0];
}

function isKnownMinimaxVoice(value?: string | null) {
  return MINIMAX_VOICE_OPTIONS.some((option) => option.value === value);
}

function resolveCharacterVoiceSource(character: WorkbenchCharacter) {
  const current = character.voice?.voiceSource;
  return isKnownMinimaxVoice(current) ? current as string : recommendMinimaxVoice(character).value;
}

function buildCharacterVoice(character: WorkbenchCharacter): WorkbenchVoice {
  return {
    id: character.name,
    name: `${character.name}配音`,
    provider: 'minimax',
    gender: normalizeGender(character.gender),
    voiceSource: resolveCharacterVoiceSource(character),
    sampleAudioUrl: character.voice?.sampleAudioUrl || null,
    segmentCount: character.voice?.segmentCount || 0,
    shotCount: character.voice?.shotCount || character.shotCount || 0,
    characterNames: [character.name],
    fallbackUsed: Boolean(character.voice?.fallbackUsed),
  };
}

export default function CharacterManager() {
  const { id: projectId } = useParams();
  const [searchParams] = useSearchParams();
  const runId = queryValue(searchParams, 'runId', 'run') || null;
  const explicitScriptId = queryValue(searchParams, 'scriptId', 'script');
  const explicitEpisodeId = queryValue(searchParams, 'episodeId', 'episode');
  const { project, loading, error } = useWorkbenchProject(projectId, {
    runId,
    scriptId: explicitScriptId || undefined,
    episodeId: explicitEpisodeId || undefined,
  });
  const { toast } = useToast();

  const scriptId = runId ? (project?.selectedEpisode?.scriptId || '') : (explicitScriptId || project?.selectedEpisode?.scriptId || '');
  const episodeId = runId ? (project?.selectedEpisode?.id || '') : (explicitEpisodeId || project?.selectedEpisode?.id || '');
  const [characters, setCharacters] = useState<WorkbenchCharacter[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const persistedRef = useRef<Record<string, WorkbenchCharacter>>({});

  useEffect(() => {
    setCharacters(project?.characters || []);
    persistedRef.current = Object.fromEntries((project?.characters || []).map((item) => [item.id, { ...item }]));
  }, [project?.characters]);

  const backTo = projectId
    ? `/drama/${projectId}${episodeId ? `?episode=${encodeURIComponent(episodeId)}${scriptId ? `&script=${encodeURIComponent(scriptId)}` : ''}${runId ? `&run=${encodeURIComponent(runId)}` : ''}` : ''}`
    : '/projects';

  const updateLocalCharacter = (characterId: string, updater: (item: WorkbenchCharacter) => WorkbenchCharacter) => {
    setCharacters((previous) => previous.map((item) => (item.id === characterId ? updater(item) : item)));
  };

  const updateCharacterVoiceSource = (character: WorkbenchCharacter, voiceSource: string) => {
    if (!editingId) {
      setEditingId(character.id);
    }
    updateLocalCharacter(character.id, (item) => ({
      ...item,
      voice: {
        ...buildCharacterVoice(item),
        ...(item.voice || {}),
        provider: 'minimax',
        gender: normalizeGender(item.gender),
        voiceSource,
        characterNames: [item.name],
      },
    }));
  };

  const handleSave = async (character: WorkbenchCharacter) => {
    if (!projectId || !scriptId || !episodeId) {
      toast('缺少项目上下文，无法写回角色编辑', 'error');
      return;
    }

    const previous = persistedRef.current[character.id] || character;
    setSavingId(character.id);
    try {
      const nextVoice = buildCharacterVoice(character);
      await updateCharacterAsset(projectId, scriptId, episodeId, character.id, {
        name: character.name,
        gender: character.gender,
        age: character.age,
        personality: character.personality,
        visualDescription: character.visualDescription,
        promptTokens: character.promptTokens,
      }, project?.currentRun?.artifactRunDir);
      await updateVoiceAsset(projectId, scriptId, episodeId, nextVoice.id, {
        name: nextVoice.name,
        provider: nextVoice.provider,
        gender: nextVoice.gender,
        voiceSource: nextVoice.voiceSource,
        characterNames: nextVoice.characterNames,
      }, project?.currentRun?.artifactRunDir);
      const savedCharacter = { ...character, voice: nextVoice };
      persistedRef.current[character.id] = savedCharacter;
      updateLocalCharacter(character.id, () => savedCharacter);
      toast('角色和配音已保存', 'success');
      setEditingId(null);
    } catch (saveError) {
      updateLocalCharacter(character.id, () => previous);
      toast(saveError instanceof Error ? saveError.message : '角色保存失败', 'error');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return <div className="glass-card p-6 text-sm text-red-600">角色数据加载失败{error ? `：${error}` : ''}。</div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <Link to={backTo} className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900">
            <ArrowLeft size={18} />
            返回项目详情
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 font-heading">角色管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            角色档案直接读取当前 episode 的工作台数据，并按约定接入角色 PUT 写回。
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
          <div className="font-medium">{characters.length} 个角色</div>
          <div className="mt-1 text-xs text-cyan-600/80">保持当前 workbench 卡片风格</div>
        </div>
      </header>

      {characters.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <Users className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="text-lg text-slate-600">当前 run 没有角色档案</p>
          <p className="mt-2 text-sm text-slate-400">先确认脚本解析和角色注册阶段是否已写出产物。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {characters.map((character) => {
            const editing = editingId === character.id;
            return (
              <article key={character.id} className="glass-card overflow-hidden">
                <div className="grid grid-cols-[168px,1fr] gap-0">
                  <div className="border-r border-slate-200 bg-slate-100">
                    {character.referenceImageUrl ? (
                      <img src={character.referenceImageUrl} alt={character.name} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-slate-400">
                        暂无参考图
                      </div>
                    )}
                  </div>

                  <div className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        {editing ? (
                          <input
                            value={character.name}
                            onChange={(event) => updateLocalCharacter(character.id, (item) => ({ ...item, name: event.target.value }))}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:bg-white"
                          />
                        ) : (
                          <h2 className="text-lg font-semibold text-slate-900">{character.name}</h2>
                        )}
                        <div className="mt-1 text-xs text-slate-400">
                          {character.shotCount} 个镜头 · {character.scenes.length} 个场景
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {savingId === character.id ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                            <Loader2 size={12} className="animate-spin" />
                            保存中
                          </span>
                        ) : null}
                        {editing ? (
                          <button
                            type="button"
                            onClick={() => void handleSave(character)}
                            className="inline-flex items-center gap-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                          >
                            <Save size={12} />
                            保存
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingId(character.id)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            编辑
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Gender</div>
                        <input
                          value={character.gender}
                          disabled={!editing}
                          onChange={(event) => updateLocalCharacter(character.id, (item) => ({ ...item, gender: event.target.value }))}
                          className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                        />
                      </label>
                      <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Age</div>
                        <input
                          value={character.age}
                          disabled={!editing}
                          onChange={(event) => updateLocalCharacter(character.id, (item) => ({ ...item, age: event.target.value }))}
                          className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                        />
                      </label>
                    </div>

                    <label className="mt-4 block rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">视觉描述</div>
                      <textarea
                        value={character.visualDescription}
                        disabled={!editing}
                        onChange={(event) => updateLocalCharacter(character.id, (item) => ({ ...item, visualDescription: event.target.value }))}
                        rows={4}
                        className="w-full resize-none bg-transparent text-sm leading-6 text-slate-700 outline-none disabled:text-slate-500"
                      />
                    </label>

                    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">角色气质</div>
                        <textarea
                          value={character.personality}
                          disabled={!editing}
                          onChange={(event) => updateLocalCharacter(character.id, (item) => ({ ...item, personality: event.target.value }))}
                          rows={4}
                          className="w-full resize-none bg-transparent text-sm leading-6 text-slate-700 outline-none disabled:text-slate-500"
                        />
                      </label>
                      <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Prompt Tokens</div>
                        <textarea
                          value={character.promptTokens}
                          disabled={!editing}
                          onChange={(event) => updateLocalCharacter(character.id, (item) => ({ ...item, promptTokens: event.target.value }))}
                          rows={4}
                          className="w-full resize-none bg-transparent text-sm leading-6 text-slate-700 outline-none disabled:text-slate-500"
                        />
                      </label>
                    </div>

                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Mic size={16} className="text-amber-600" />
                          角色配音
                        </div>
                        <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          MiniMax
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr,220px]">
                        <label className="rounded-xl border border-amber-100 bg-white p-3">
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-amber-500">音色</div>
                          <select
                            value={resolveCharacterVoiceSource(character)}
                            onChange={(event) => updateCharacterVoiceSource(character, event.target.value)}
                            className="w-full cursor-pointer bg-transparent text-sm text-slate-700 outline-none"
                          >
                            {MINIMAX_VOICE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label} · {option.value}
                              </option>
                            ))}
                          </select>
                          <div className="mt-2 text-xs text-amber-700/80">
                            自动推荐：{recommendMinimaxVoice(character).label}
                          </div>
                        </label>

                        <div className="rounded-xl border border-amber-100 bg-white p-3">
                          <div className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-amber-500">
                            <PlayCircle size={14} />
                            试听
                          </div>
                          {character.voice?.sampleAudioUrl ? (
                            <audio className="w-full" controls src={character.voice.sampleAudioUrl} preload="none" />
                          ) : (
                            <div className="text-sm text-slate-400">暂无真实试听样本，生成配音后自动回填。</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {character.scenes.map((scene) => (
                        <span
                          key={scene}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
                        >
                          {scene}
                        </span>
                      ))}
                    </div>

                    {character.referenceImageUrl ? (
                      <a
                        href={character.referenceImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-600 transition hover:text-cyan-500"
                      >
                        <Sparkles size={16} />
                        打开参考图
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
