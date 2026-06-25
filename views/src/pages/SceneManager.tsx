import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Loader2, MapPin, Save } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';
import { updateSceneAsset, type WorkbenchScene } from '../lib/workbench';
import { useToast } from '../components/ToastContext';

function queryValue(searchParams: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) return value;
  }
  return '';
}

export default function SceneManager() {
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
  const [scenes, setScenes] = useState<WorkbenchScene[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const persistedRef = useRef<Record<string, WorkbenchScene>>({});

  useEffect(() => {
    setScenes(project?.scenes || []);
    persistedRef.current = Object.fromEntries((project?.scenes || []).map((item) => [item.id, { ...item }]));
  }, [project?.scenes]);

  const backTo = projectId
    ? `/drama/${projectId}${episodeId ? `?episode=${encodeURIComponent(episodeId)}${scriptId ? `&script=${encodeURIComponent(scriptId)}` : ''}${runId ? `&run=${encodeURIComponent(runId)}` : ''}` : ''}`
    : '/projects';

  const updateLocalScene = (sceneId: string, updater: (item: WorkbenchScene) => WorkbenchScene) => {
    setScenes((previous) => previous.map((item) => (item.id === sceneId ? updater(item) : item)));
  };

  const handleSave = async (scene: WorkbenchScene) => {
    if (!projectId || !scriptId || !episodeId) {
      toast('缺少项目上下文，无法写回场景编辑', 'error');
      return;
    }

    const previous = persistedRef.current[scene.id] || scene;
    setSavingId(scene.id);
    try {
      await updateSceneAsset(projectId, scriptId, episodeId, scene.id, {
        title: scene.title,
        goal: scene.goal,
        location: scene.location,
        cast: scene.cast,
        visualMotif: scene.visualMotif,
        validationStatus: scene.validationStatus,
      }, project?.currentRun?.artifactRunDir);
      persistedRef.current[scene.id] = { ...scene };
      toast('场景已保存', 'success');
      setEditingId(null);
    } catch (saveError) {
      updateLocalScene(scene.id, () => previous);
      toast(saveError instanceof Error ? saveError.message : '场景保存失败', 'error');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return <div className="glass-card p-6 text-sm text-red-600">场景数据加载失败{error ? `：${error}` : ''}。</div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <Link to={backTo} className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900">
            <ArrowLeft size={18} />
            返回项目详情
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 font-heading">场景管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            场景编辑围绕 `scenePacks` 的真实字段展开，直接接入场景 PUT API。
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="font-medium">{scenes.length} 个场景包</div>
          <div className="mt-1 text-xs text-emerald-600/80">位置 / 目标 / cast / 状态可编辑</div>
        </div>
      </header>

      {scenes.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <MapPin className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="text-lg text-slate-600">当前 run 没有场景包</p>
          <p className="mt-2 text-sm text-slate-400">先确认 Director 的场景规划阶段是否产出了 `scenePacks`。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {scenes.map((scene) => {
            const editing = editingId === scene.id;
            return (
              <article key={scene.id} className="glass-card overflow-hidden">
                <div className="aspect-video border-b border-slate-200 bg-slate-100">
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} alt={scene.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      当前场景没有可复用的首帧图
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <input
                          value={scene.title}
                          onChange={(event) => updateLocalScene(scene.id, (item) => ({ ...item, title: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-lg font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:bg-white"
                        />
                      ) : (
                        <h2 className="text-lg font-semibold text-slate-900">{scene.title}</h2>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <MapPin size={14} />
                        <input
                          value={scene.location}
                          disabled={!editing}
                          onChange={(event) => updateLocalScene(scene.id, (item) => ({ ...item, location: event.target.value }))}
                          className="w-full bg-transparent outline-none disabled:text-slate-400"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {savingId === scene.id ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                          <Loader2 size={12} className="animate-spin" />
                          保存中
                        </span>
                      ) : null}
                      {editing ? (
                        <button
                          type="button"
                          onClick={() => void handleSave(scene)}
                          className="inline-flex items-center gap-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                        >
                          <Save size={12} />
                          保存
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingId(scene.id)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          编辑
                        </button>
                      )}
                    </div>
                  </div>

                  <label className="block rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">场景目标</div>
                    <textarea
                      value={scene.goal}
                      disabled={!editing}
                      onChange={(event) => updateLocalScene(scene.id, (item) => ({ ...item, goal: event.target.value }))}
                      rows={4}
                      className="w-full resize-none bg-transparent text-sm leading-6 text-slate-700 outline-none disabled:text-slate-500"
                    />
                  </label>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">视觉母题</div>
                      <textarea
                        value={scene.visualMotif}
                        disabled={!editing}
                        onChange={(event) => updateLocalScene(scene.id, (item) => ({ ...item, visualMotif: event.target.value }))}
                        rows={4}
                        className="w-full resize-none bg-transparent text-sm leading-6 text-slate-700 outline-none disabled:text-slate-500"
                      />
                    </label>
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">校验状态</div>
                      <input
                        value={scene.validationStatus}
                        disabled={!editing}
                        onChange={(event) => updateLocalScene(scene.id, (item) => ({ ...item, validationStatus: event.target.value }))}
                        className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                      />
                      {scene.validationIssues.length ? (
                        <ul className="mt-3 space-y-1 text-xs text-amber-700">
                          {scene.validationIssues.map((issue) => (
                            <li key={issue}>- {issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </label>
                  </div>

                  <label className="mt-4 block rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                      <ImageIcon size={14} />
                      出场角色
                    </div>
                    <input
                      value={scene.cast.join(', ')}
                      disabled={!editing}
                      onChange={(event) => updateLocalScene(scene.id, (item) => ({
                        ...item,
                        cast: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                      }))}
                      className="w-full bg-transparent text-sm text-slate-700 outline-none disabled:text-slate-500"
                    />
                  </label>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {scene.cast.length ? (
                      scene.cast.map((name) => (
                        <span
                          key={name}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
                        >
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-400">这个场景包当前没有明确 cast。</span>
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
