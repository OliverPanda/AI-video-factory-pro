import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  Film,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  TimerReset,
  Users,
} from 'lucide-react';

import { useStoryboardData, useWorkbenchProject } from '../hooks/useWorkbench';
import { updateStoryboardShot, type WorkbenchShot } from '../lib/workbench';
import { useToast } from '../components/ToastContext';
import { reconcileShotSceneDraft, revertFailedShotPatch } from './editorState';

const CAMERA_OPTIONS = [
  '特写',
  '近景',
  '中景',
  '全景',
  '俯拍',
  '仰拍',
  '跟拍',
  '主观镜头',
];

function readQuery(searchParams: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) return value;
  }
  return '';
}

function buildShotPatch(current: WorkbenchShot, previous: WorkbenchShot) {
  const patch: Record<string, string | number> = {};
  if (current.dialogue !== previous.dialogue) patch.dialogue = current.dialogue;
  if (current.emotion !== previous.emotion) patch.emotion = current.emotion;
  if (current.scene !== previous.scene) patch.scene = current.scene;
  if (current.cameraType !== previous.cameraType) patch.cameraType = current.cameraType;
  if (current.durationSec !== previous.durationSec) patch.durationSec = current.durationSec;
  return patch;
}

export function Editor() {
  const [searchParams] = useSearchParams();
  const projectId = readQuery(searchParams, 'projectId', 'project');
  const queryScriptId = readQuery(searchParams, 'scriptId', 'script');
  const queryEpisodeId = readQuery(searchParams, 'episodeId', 'episode');
  const runId = readQuery(searchParams, 'runId', 'run');
  const { project: contextProject, loading: contextLoading } = useWorkbenchProject(projectId, runId
    ? { runId }
    : {
        scriptId: queryScriptId || undefined,
        episodeId: queryEpisodeId || undefined,
      });
  const scriptId = runId ? (contextProject?.selectedEpisode?.scriptId || '') : queryScriptId;
  const episodeId = runId ? (contextProject?.selectedEpisode?.id || '') : queryEpisodeId;
  const [refreshKey, setRefreshKey] = useState(0);
  const { storyboard, loading, error, setStoryboard } = useStoryboardData(projectId, scriptId, episodeId, runId || null, refreshKey);
  const { toast } = useToast();
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [savingShotId, setSavingShotId] = useState<string | null>(null);
  const originalShotRef = useRef<Record<string, WorkbenchShot>>({});
  const storyboardRef = useRef(storyboard);
  storyboardRef.current = storyboard;

  useEffect(() => {
    if (!selectedShotId && storyboard?.shots.length) {
      setSelectedShotId(storyboard.shots[0].id);
    }
  }, [selectedShotId, storyboard?.shots]);

  useEffect(() => {
    originalShotRef.current = {};
  }, [storyboard?.episodeId]);

  const selectedShot = useMemo(
    () => storyboard?.shots.find((shot) => shot.id === selectedShotId) || storyboard?.shots[0] || null,
    [selectedShotId, storyboard?.shots]
  );

  const selectedScene = useMemo(
    () => storyboard?.scenes.find((scene) => scene.title === selectedShot?.scene || scene.id === selectedShot?.sceneId) || null,
    [selectedShot?.scene, selectedShot?.sceneId, storyboard?.scenes]
  );

  const backTo = projectId
    ? `/drama/${projectId}${episodeId ? `?episode=${encodeURIComponent(episodeId)}${scriptId ? `&script=${encodeURIComponent(scriptId)}` : ''}${runId ? `&run=${encodeURIComponent(runId)}` : ''}` : ''}`
    : '/projects';

  const updateLocalShot = (shotId: string, updater: (shot: WorkbenchShot) => WorkbenchShot) => {
    setStoryboard((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        shots: previous.shots.map((shot) => (shot.id === shotId ? updater(shot) : shot)),
      };
    });
  };

  const rememberOriginal = (shot: WorkbenchShot) => {
    if (!originalShotRef.current[shot.id]) {
      originalShotRef.current[shot.id] = { ...shot };
    }
  };

  const commitShotChanges = useCallback(async (shotId: string) => {
    const previousShot = originalShotRef.current[shotId];
    const currentShot = storyboardRef.current?.shots.find((shot) => shot.id === shotId);
    if (!previousShot || !currentShot || !projectId || !scriptId || !episodeId) {
      return;
    }

    const patch = buildShotPatch(currentShot, previousShot);
    if (!Object.keys(patch).length) {
      delete originalShotRef.current[shotId];
      return;
    }

    setSavingShotId(shotId);
    try {
      await updateStoryboardShot(projectId, scriptId, episodeId, shotId, patch, runId || null, contextProject?.currentRun?.artifactRunDir);
      toast('分镜字段已保存', 'success');
    } catch (saveError) {
      updateLocalShot(shotId, (shot) => revertFailedShotPatch(shot, previousShot, patch));
      toast(saveError instanceof Error ? saveError.message : '分镜保存失败', 'error');
    } finally {
      delete originalShotRef.current[shotId];
      setSavingShotId(null);
    }
  }, [projectId, scriptId, episodeId, runId, contextProject?.currentRun?.artifactRunDir]);

  if (contextLoading && runId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (!projectId || !scriptId || !episodeId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {runId
            ? '无法根据当前 run 解析对应的剧本与分集，当前无法加载真实分镜。'
            : '缺少 `projectId / scriptId / episodeId`，当前无法加载真实分镜。'}
        </div>
      </div>
    );
  }

  if (loading && !storyboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (error && !storyboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-sm text-rose-600">
          <div className="font-semibold text-slate-900">分镜加载失败</div>
          <div className="mt-2">{error}</div>
          <div className="mt-4 flex gap-3">
            <Link
              to={backTo}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <ArrowLeft size={14} />
              返回剧集
            </Link>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100"
            >
              <RefreshCw size={14} />
              重试加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Link
                to={backTo}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <ArrowLeft size={12} />
                返回剧集
              </Link>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                Episode {storyboard?.title || episodeId}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900">Storyboard Editor</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{storyboard?.shots.length || 0} 个镜头</span>
              <span>{storyboard?.characters.length || 0} 个角色</span>
              <span>{storyboard?.scenes.length || 0} 个场景</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100"
          >
            <RefreshCw size={15} />
            刷新数据
          </button>
        </div>
        {error ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            {error}
          </div>
        ) : null}
      </header>

      <main className="grid min-h-[calc(100vh-89px)] grid-cols-[360px,1fr] overflow-hidden">
        <aside className="border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">镜头列表</div>
            <div className="mt-1 text-xs text-slate-500">已移除原型素材源，当前直接读取 storyboard API。</div>
          </div>
          <div className="custom-scrollbar h-[calc(100vh-170px)] space-y-3 overflow-y-auto p-4">
            {storyboard?.shots.map((shot) => (
              <button
                key={shot.id}
                type="button"
                onClick={() => setSelectedShotId(shot.id)}
                className={`w-full rounded-2xl border p-3 text-left transition ${
                  selectedShot?.id === shot.id
                    ? 'border-cyan-300 bg-cyan-50'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{shot.title}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{shot.id}</div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {shot.durationSec || 0}s
                  </span>
                </div>
                <div className="line-clamp-2 text-xs leading-5 text-slate-600">{shot.dialogue || '暂无对白'}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="custom-scrollbar h-[calc(100vh-89px)] overflow-y-auto p-6">
          {selectedShot ? (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
                <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                  <div className="flex aspect-video items-center justify-center bg-slate-950">
                    {selectedShot.videoUrl ? (
                      <video controls src={selectedShot.videoUrl} className="h-full w-full object-contain" />
                    ) : selectedShot.imageUrl ? (
                      <img src={selectedShot.imageUrl} alt={selectedShot.title} className="h-full w-full object-contain" />
                    ) : (
                      <div className="text-sm text-slate-300">当前镜头没有可预览素材</div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-[20px] border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Film size={16} className="text-cyan-500" />
                      镜头元信息
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-400">Scene</div>
                        <div className="mt-1 font-semibold text-slate-800">{selectedShot.scene || '未标注'}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] text-slate-400">Camera</div>
                      <div className="mt-1 font-semibold text-slate-800">{selectedShot.cameraType || '未标注'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] text-slate-400">Emotion</div>
                      <div className="mt-1 font-semibold text-slate-800">{selectedShot.emotion || '未标注'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] text-slate-400">Characters</div>
                      <div className="mt-1 font-semibold text-slate-800">{selectedShot.characters.join(' / ') || '无'}</div>
                    </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-400">Status</div>
                        <div className="mt-1 font-semibold text-slate-800">{selectedShot.status}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Users size={16} className="text-emerald-500" />
                      场景上下文
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      <div>{selectedScene?.goal || '当前没有关联 scene pack 目标。'}</div>
                      <div className="text-xs text-slate-400">{selectedScene?.location || '未记录空间锚点'}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-white p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{selectedShot.title}</div>
                    <div className="mt-1 text-xs text-slate-500">支持 `dialogue / emotion / scene / cameraType / durationSec` 实时编辑</div>
                  </div>
                  {savingShotId === selectedShot.id ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                      <Loader2 size={13} className="animate-spin" />
                      保存中
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                      <Save size={13} />
                      失焦自动保存
                    </span>
                  )}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <MessageSquare size={13} />
                      Dialogue
                    </div>
                    <textarea
                      value={selectedShot.dialogue}
                      onFocus={() => rememberOriginal(selectedShot)}
                      onChange={(event) => updateLocalShot(selectedShot.id, (shot) => ({ ...shot, dialogue: event.target.value, hasDialogue: Boolean(event.target.value) }))}
                      onBlur={() => void commitShotChanges(selectedShot.id)}
                      rows={6}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                    />
                  </label>

                  <div className="grid gap-4">
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Scene</div>
                      <input
                        value={selectedShot.scene}
                        onFocus={() => rememberOriginal(selectedShot)}
                        onChange={(event) => updateLocalShot(
                          selectedShot.id,
                          (shot) => reconcileShotSceneDraft(shot, storyboard?.scenes || [], event.target.value)
                        )}
                        onBlur={() => void commitShotChanges(selectedShot.id)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Emotion</div>
                      <input
                        value={selectedShot.emotion}
                        onFocus={() => rememberOriginal(selectedShot)}
                        onChange={(event) => updateLocalShot(selectedShot.id, (shot) => ({ ...shot, emotion: event.target.value }))}
                        onBlur={() => void commitShotChanges(selectedShot.id)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <Camera size={13} />
                        Camera Type
                      </div>
                      <input
                        list="camera-type-options"
                        value={selectedShot.cameraType}
                        onFocus={() => rememberOriginal(selectedShot)}
                        onChange={(event) => updateLocalShot(selectedShot.id, (shot) => ({ ...shot, cameraType: event.target.value }))}
                        onBlur={() => void commitShotChanges(selectedShot.id)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                      />
                      <datalist id="camera-type-options">
                        {CAMERA_OPTIONS.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>

                    <label className="block">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <TimerReset size={13} />
                        Duration Sec
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={selectedShot.durationSec}
                        onFocus={() => rememberOriginal(selectedShot)}
                        onChange={(event) => updateLocalShot(selectedShot.id, (shot) => ({ ...shot, durationSec: Number(event.target.value || 0) }))}
                        onBlur={() => void commitShotChanges(selectedShot.id)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
              当前没有可编辑镜头。
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
