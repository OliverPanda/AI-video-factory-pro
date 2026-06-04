import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, MapPin } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';

export default function SceneManager() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { project, loading, error } = useWorkbenchProject(projectId);

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
          <button
            onClick={() => navigate(`/drama/${project.id}`)}
            className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft size={18} />
            返回项目详情
          </button>
          <h1 className="text-2xl font-bold text-slate-900 font-heading">场景管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            这里按当前 run 的 `scenePacks` 展示场景结构。每个场景卡片都映射到真实空间锚点、目标、演员列表和关联镜头，不再依赖旧版场景表单。
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="font-medium">Scene Packs</div>
          <div className="mt-1 text-xs text-emerald-600/80">{project.scenes.length} 个场景包已接入</div>
        </div>
      </header>

      {project.scenes.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <MapPin className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="text-lg text-slate-600">当前 run 没有场景包</p>
          <p className="mt-2 text-sm text-slate-400">先确认 Director 的场景规划阶段是否产出了 `scenePacks`。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {project.scenes.map((scene) => (
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
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{scene.title}</h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <MapPin size={14} />
                      {scene.location}
                    </div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                    {scene.shotCount} 个镜头
                  </span>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">场景目标</div>
                  <p className="text-sm leading-6 text-slate-600">{scene.goal}</p>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">视觉母题</div>
                    <p className="text-sm leading-6 text-slate-600">{scene.visualMotif}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">校验状态</div>
                    <div className="text-sm text-slate-600">{scene.validationStatus}</div>
                    {scene.validationIssues.length ? (
                      <ul className="mt-2 space-y-1 text-xs text-amber-700">
                        {scene.validationIssues.map((issue) => (
                          <li key={issue}>- {issue}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                    <ImageIcon size={14} />
                    出场角色
                  </div>
                  <div className="flex flex-wrap gap-2">
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
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
