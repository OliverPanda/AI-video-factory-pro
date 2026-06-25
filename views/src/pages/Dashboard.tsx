import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CircleCheckBig,
  FolderKanban,
  PlayCircle,
  Search,
  X,
  Plus,
  Sparkles,
  Loader2,
} from 'lucide-react';

import { useWorkbenchProjects, useWorkbenchOverview } from '../hooks/useWorkbench';
import { formatRunStatus, getStatusTone, createProjectApi } from '../lib/workbench';
import { StylePicker, GENRE_OPTIONS, RATIO_OPTIONS } from '../components/StylePresets';

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="glass-card p-16 text-center">
      <FolderKanban className="mx-auto mb-4 text-slate-300" size={56} />
      <p className="mb-4 text-lg text-slate-600">{query ? '没有匹配的工作台项目' : '当前没有可展示的运行项目'}</p>
      <p className="text-sm text-slate-400">
        {query ? '清掉搜索词后可以继续浏览最新运行。' : '先跑一轮 Director 流水线，前端会自动读入真实产物。'}
      </p>
      {query ? (
        <button
          onClick={onClear}
          className="mt-6 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          清除搜索
        </button>
      ) : null}
    </div>
  );
}

function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [style, setStyle] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProjectApi({
        title: title.trim(),
        description: description.trim() || undefined,
        genre: genre || undefined,
        style: style || undefined,
        coverUrl: coverUrl.trim() || undefined,
        aspectRatio,
      });
      onCreated(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 font-heading">新建项目</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* 标题 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">项目标题 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入项目标题…"
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all"
            />
          </div>

          {/* 简述 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">项目简述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述项目内容（可选）…"
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all resize-none"
            />
          </div>

          {/* 题材 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">题材风格</label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all appearance-none"
            >
              {GENRE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 画风视觉选择 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">画风</label>
            <StylePicker value={style} onChange={setStyle} />
          </div>

          {/* 封面 + 比例 */}
          <div className="mb-5 grid grid-cols-[1fr_140px] gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">封面图片 URL</label>
              <input
                type="text"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="粘贴封面图链接（可选）"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">画面比例</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all appearance-none"
              >
                {RATIO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 封面预览 */}
          {coverUrl.trim() && (
            <div className="mb-5 rounded-xl border border-slate-200 overflow-hidden">
              <img
                src={coverUrl.trim()}
                alt="封面预览"
                className="w-full h-36 object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-cyan-500/20 hover:shadow-cyan-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {submitting ? '创建中…' : '创建项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const { projects, loading, error } = useWorkbenchProjects(refreshKey);
  const { overview } = useWorkbenchOverview();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleProjectCreated = useCallback((projectId: string) => {
    setShowCreateModal(false);
    setRefreshKey((k) => k + 1);
    navigate(`/project/${projectId}`);
  }, [navigate]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => {
      const haystack = [
        project.title,
        project.description,
        project.selectedEpisode?.title,
        project.currentRun?.scriptTitle,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [projects, searchQuery]);

  const runCount = overview?.summary.runCount ?? projects.reduce((total, project) => total + project.runCount, 0);
  const passCount =
    overview?.summary.passCount ??
    projects.filter((project) => project.currentRun?.qaOverview?.status === 'pass').length;
  const blockCount =
    overview?.summary.blockCount ??
    projects.filter((project) => project.currentRun?.qaOverview?.status === 'block').length;

  const runningCount = projects.filter(
    (p) => p.currentRun?.qaOverview?.status !== 'pass' && p.currentRun?.qaOverview?.status !== 'block'
  ).length;

  return (
    <div className="mx-auto max-w-7xl animate-in">
      {/* ========== Hero 欢迎区 ========== */}
      <section className="mb-10 rounded-2xl bg-gradient-to-r from-cyan-50 via-teal-50 to-emerald-50 border border-cyan-100 p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500 to-teal-500 flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/20">
            <Sparkles size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">
              欢迎回来 👋
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed max-w-lg">
              {projects.length > 0
                ? `你有 ${projects.length} 个项目，其中 ${runningCount} 个正在运行，${passCount} 个已就绪可导出。`
                : '开始你的第一个 AI 漫剧项目，一键生成高质量短视频。'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/35 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 shrink-0"
        >
          <Plus size={18} />
          新建项目
        </button>
      </section>

      {/* ========== 统计卡片 ========== */}
      <section className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-3">
        {/* 项目数 */}
        <div className="glass-card p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-100 rounded-full filter blur-xl pointer-events-none group-hover:scale-150 transition-transform duration-700" />
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">项目数</p>
          <p className="text-5xl font-extrabold tracking-tight stat-number">{projects.length}</p>
          <p className="mt-3 text-[10px] text-slate-400 font-medium">当前运行产生的可编辑漫剧项目</p>
        </div>

        {/* 运行中 */}
        <div className="glass-card p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-teal-100 rounded-full filter blur-xl pointer-events-none group-hover:scale-150 transition-transform duration-700" />
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">运行总数</p>
            {runningCount > 0 && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
              </span>
            )}
          </div>
          <p className="text-5xl font-extrabold tracking-tight stat-number">{runCount}</p>
          <p className="mt-3 text-[10px] text-slate-400 font-medium">来自本地工作流的有效运行任务</p>
        </div>

        {/* 已就绪 */}
        <div className="glass-card p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-100 rounded-full filter blur-xl pointer-events-none group-hover:scale-150 transition-transform duration-700" />
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">成功交付数</p>
              <p className="text-5xl font-extrabold tracking-tight stat-number">{passCount}</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-right">
              <p className="text-[9px] uppercase tracking-wider font-extrabold text-rose-500">Blocked</p>
              <p className="text-sm font-bold text-rose-600 mt-0.5">{blockCount}</p>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-slate-400 font-medium">通过质检与待人工确认的任务比例</p>
        </div>
      </section>

      {/* ========== 错误提示 ========== */}
      {error ? (
        <div className="glass-card mb-8 border border-red-200 bg-red-50 p-4 text-xs text-red-600">
          前端读取数据失败：{error}
        </div>
      ) : null}

      {/* ========== 项目列表 ========== */}
      <section className="pb-12">
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 font-heading tracking-wide">运行项目</h2>
            <p className="text-[11px] text-slate-400 mt-1">点击卡片进入分镜看板，对镜头、角色与配音进行管理。</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-[11px] bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full text-slate-500 font-medium">
              {filteredProjects.length} 个项目
            </div>
            {/* 搜索栏 */}
            <div className="relative min-w-[260px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors" size={16} />
              <input
                type="text"
                placeholder="搜索项目、分集或运行说明..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-xs text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all duration-300 shadow-sm"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="glass-card animate-pulse p-5">
                <div className="mb-4 aspect-video rounded-2xl bg-slate-100" />
                <div className="mb-2 h-5 w-2/3 rounded bg-slate-100" />
                <div className="mb-4 h-4 w-1/2 rounded bg-slate-100" />
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-14 rounded-xl bg-slate-100" />
                  <div className="h-14 rounded-xl bg-slate-100" />
                  <div className="h-14 rounded-xl bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <EmptyState query={searchQuery} onClear={() => setSearchQuery('')} />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {filteredProjects.map((project) => {
              const status = project.currentRun?.qaOverview?.status
                ? (project.currentRun.qaOverview.status as 'pass' | 'warn' | 'block' | 'running')
                : project.selectedEpisode?.status || 'running';

              return (
                <button
                  key={project.id}
                  onClick={() => navigate(`/project/${project.id}`)}
                  className="glass-card overflow-hidden text-left hover:border-cyan-200 hover:ring-2 hover:ring-cyan-100 active:scale-[0.99] transition-all duration-300 group"
                >
                  <div className="relative aspect-video overflow-hidden border-b border-slate-100">
                    {project.finalVideoUrl ? (
                      <video
                        src={project.finalVideoUrl}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : project.coverAssetUrl ? (
                      <img src={project.coverAssetUrl} alt={project.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-cyan-50 to-teal-50">
                        <PlayCircle size={40} className="text-slate-300 group-hover:text-cyan-500 transition-colors duration-300" />
                      </div>
                    )}

                    <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/80 backdrop-blur-sm px-3 py-1.5 text-[11px] text-slate-900 shadow-sm">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-extrabold ${getStatusTone(status)}`}>
                        {formatRunStatus(status)}
                      </span>
                      <span className="font-semibold">{project.selectedEpisode?.title || '未命名分集'}</span>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900 tracking-wide group-hover:text-cyan-700 transition-colors duration-300">{project.title}</h3>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{project.description}</p>
                      </div>
                      {status === 'block' ? (
                        <AlertTriangle className="mt-1 text-rose-400 shrink-0" size={18} />
                      ) : (
                        <CircleCheckBig className="mt-1 text-emerald-500 shrink-0" size={18} />
                      )}
                    </div>

                    <div className="mb-5 grid grid-cols-4 gap-2.5 text-center text-sm">
                      {[
                        { value: project.counts.totalShots, label: '镜头' },
                        { value: project.counts.imageReady, label: '出图' },
                        { value: project.counts.videoReady, label: '视频' },
                        { value: project.characters.length, label: '角色' },
                      ].map((stat, i) => (
                        <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 py-2.5 transition-colors duration-300 hover:bg-slate-100">
                          <div className="text-base font-bold text-slate-900 tracking-tight">{stat.value}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400 font-medium">{stat.label}</div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 pt-4">
                      <span className="font-mono text-slate-300">ID: {project.currentRun?.id.slice(0, 18) || '无 Run'}...</span>
                      <span className="font-medium text-slate-400">更新: {project.currentRun?.finishedAt ? new Date(project.currentRun.finishedAt).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'numeric', minute:'numeric'}) : '未完成'}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <CreateProjectModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleProjectCreated}
      />
    </div>
  );
}
