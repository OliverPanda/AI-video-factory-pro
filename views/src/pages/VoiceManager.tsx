import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Mic, PlayCircle, Save, UserRound } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';
import { updateVoiceAsset, type WorkbenchVoice } from '../lib/workbench';
import { useToast } from '../components/ToastContext';

function queryValue(searchParams: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) return value;
  }
  return '';
}

export default function VoiceManager() {
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
  const [voices, setVoices] = useState<WorkbenchVoice[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const persistedRef = useRef<Record<string, WorkbenchVoice>>({});

  useEffect(() => {
    setVoices(project?.voices || []);
    persistedRef.current = Object.fromEntries((project?.voices || []).map((item) => [item.id, { ...item }]));
  }, [project?.voices]);

  const backTo = projectId
    ? `/drama/${projectId}${episodeId ? `?episode=${encodeURIComponent(episodeId)}${scriptId ? `&script=${encodeURIComponent(scriptId)}` : ''}${runId ? `&run=${encodeURIComponent(runId)}` : ''}` : ''}`
    : '/projects';

  const updateLocalVoice = (voiceId: string, updater: (item: WorkbenchVoice) => WorkbenchVoice) => {
    setVoices((previous) => previous.map((item) => (item.id === voiceId ? updater(item) : item)));
  };

  const handleSave = async (voice: WorkbenchVoice) => {
    if (!projectId || !scriptId || !episodeId) {
      toast('缺少项目上下文，无法写回配音编辑', 'error');
      return;
    }

    const previous = persistedRef.current[voice.id] || voice;
    setSavingId(voice.id);
    try {
      await updateVoiceAsset(projectId, scriptId, episodeId, voice.id, {
        name: voice.name,
        provider: voice.provider,
        gender: voice.gender,
        voiceSource: voice.voiceSource,
        characterNames: voice.characterNames,
      }, project?.currentRun?.artifactRunDir);
      persistedRef.current[voice.id] = { ...voice };
      toast('配音配置已保存', 'success');
      setEditingId(null);
    } catch (saveError) {
      updateLocalVoice(voice.id, () => previous);
      toast(saveError instanceof Error ? saveError.message : '配音保存失败', 'error');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return <div className="glass-card p-6 text-sm text-red-600">配音数据加载失败{error ? `：${error}` : ''}。</div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <Link to={backTo} className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900">
            <ArrowLeft size={18} />
            返回项目详情
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 font-heading">配音管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            配音页继续基于真实 `audioVoiceResolution` 聚合数据，并把常用配置写回到 voice PUT API。
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <div className="font-medium">{voices.length} 个说话人入口</div>
          <div className="mt-1 text-xs text-amber-600/80">provider / gender / source / 绑定角色可编辑</div>
        </div>
      </header>

      {voices.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <Mic className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="text-lg text-slate-600">当前 run 没有可展示的配音结果</p>
          <p className="mt-2 text-sm text-slate-400">先确认 TTS 阶段是否已产出 `audioVoiceResolution` 和音频文件。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {voices.map((voice) => {
            const editing = editingId === voice.id;
            return (
              <article key={voice.id} className="glass-card p-5">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100">
                      <Mic className="text-amber-600" size={26} />
                    </div>
                    <div className="min-w-[220px]">
                      {editing ? (
                        <input
                          value={voice.name}
                          onChange={(event) => updateLocalVoice(voice.id, (item) => ({ ...item, name: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-lg font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:bg-white"
                        />
                      ) : (
                        <h2 className="text-lg font-semibold text-slate-900">{voice.name}</h2>
                      )}
                      <div className="mt-1 text-xs text-slate-400">
                        {voice.segmentCount} 段对白 · {voice.shotCount} 个镜头
                      </div>
                    </div>
                  </div>

                  <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Provider</div>
                      <input
                        value={voice.provider}
                        disabled={!editing}
                        onChange={(event) => updateLocalVoice(voice.id, (item) => ({ ...item, provider: event.target.value }))}
                        className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                      />
                    </label>
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Gender</div>
                      <input
                        value={voice.gender}
                        disabled={!editing}
                        onChange={(event) => updateLocalVoice(voice.id, (item) => ({ ...item, gender: event.target.value }))}
                        className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                      />
                    </label>
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Voice Source</div>
                      <input
                        value={voice.voiceSource}
                        disabled={!editing}
                        onChange={(event) => updateLocalVoice(voice.id, (item) => ({ ...item, voiceSource: event.target.value }))}
                        className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                      />
                    </label>
                  </div>

                  <div className="flex min-w-[240px] flex-col gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">角色绑定</div>
                      <input
                        value={voice.characterNames.join(', ')}
                        disabled={!editing}
                        onChange={(event) => updateLocalVoice(voice.id, (item) => ({
                          ...item,
                          characterNames: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                        }))}
                        className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      {savingId === voice.id ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                          <Loader2 size={12} className="animate-spin" />
                          保存中
                        </span>
                      ) : null}
                      {editing ? (
                        <button
                          type="button"
                          onClick={() => void handleSave(voice)}
                          className="inline-flex items-center gap-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                        >
                          <Save size={12} />
                          保存
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingId(voice.id)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          编辑
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr,280px]">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">角色映射</div>
                    <div className="flex flex-wrap gap-2">
                      {voice.characterNames.length ? (
                        voice.characterNames.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs text-cyan-700"
                          >
                            <UserRound size={12} />
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">非角色口播或系统音</span>
                      )}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      Fallback：{voice.fallbackUsed ? '使用默认兜底音色' : '未使用兜底'}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                      <PlayCircle size={14} />
                      试听样本
                    </div>
                    {voice.sampleAudioUrl ? (
                      <audio className="w-full" controls src={voice.sampleAudioUrl} preload="none" />
                    ) : (
                      <div className="text-sm text-slate-400">当前没有可直接试听的音频样本</div>
                    )}
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
