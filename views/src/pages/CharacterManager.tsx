import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, Users } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';

export default function CharacterManager() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { project, loading, error } = useWorkbenchProject(projectId);

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
          <button
            onClick={() => navigate(`/drama/${project.id}`)}
            className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft size={18} />
            返回项目详情
          </button>
          <h1 className="text-2xl font-bold text-slate-900 font-heading">角色管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            这里直接读取当前 run 的 `characterRegistry` 和参考图产物。后端当前没有角色编辑 API，因此本页只读展示，不再沿用旧版增删改逻辑。
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-indigo-700">
          <div className="font-medium">只读联调模式</div>
          <div className="mt-1 text-xs text-indigo-500/80">以 Director 生成出的角色档案为准</div>
        </div>
      </header>

      {project.characters.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <Users className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="text-lg text-slate-600">当前 run 没有角色档案</p>
          <p className="mt-2 text-sm text-slate-400">先确认脚本解析和角色注册阶段是否已写出产物。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {project.characters.map((character) => (
            <article key={character.id} className="glass-card overflow-hidden">
              <div className="grid grid-cols-[168px,1fr] gap-0">
                <div className="border-r border-slate-200 bg-slate-100">
                  {character.referenceImageUrl ? (
                    <img src={character.referenceImageUrl} alt={character.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-slate-400">
                      暂无参考图
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{character.name}</h2>
                      <div className="mt-1 text-xs text-slate-400">
                        {character.gender} · {character.age} · {character.shotCount} 个镜头
                      </div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                      {character.scenes.length} 个场景
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">视觉描述</div>
                    <p className="text-sm leading-6 text-slate-600">{character.visualDescription}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">角色气质</div>
                      <p className="text-sm leading-6 text-slate-600">{character.personality}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Prompt Tokens</div>
                      <p className="text-sm leading-6 text-slate-600">{character.promptTokens || '未记录'}</p>
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
                      className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-600 transition hover:text-indigo-500"
                    >
                      <Sparkles size={16} />
                      打开参考图
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
