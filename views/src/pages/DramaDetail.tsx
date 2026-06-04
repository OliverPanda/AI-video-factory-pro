import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileVideo,
  FolderTree,
  Image as ImageIcon,
  Mic,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';
import { formatRunStatus, getStatusTone } from '../lib/workbench';
import { useToast } from '../components/ToastContext';
import GoldComboPreview from '../components/remotion/GoldComboPreview';

type TabKey = 'shots' | 'summary' | 'qa' | 'goldCombo';

export default function DramaDetail() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('shots');
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  const { project, loading, error } = useWorkbenchProject(projectId, selectedRunId);

  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportJianying = async () => {
    const runId = selectedRunId || project?.currentRun?.id || project?.selectedEpisode?.latestRunId;
    if (!runId) {
      toast('❌ 未能定位到当前有效的运行记录(Run ID)，请先选择分集或等待运行开始', 'error');
      setExportError('未定位到当前有效的运行记录(Run ID)');
      return;
    }

    setExporting(true);
    setExportError(null);
    setExportResult(null);

    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/export-jianying`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setExportResult(data);
      toast('🎉 剪映专业版草稿一键写入成功！', 'success');
    } catch (err: any) {
      console.error(err);
      setExportError(err.message || '导出发生未知错误');
      toast('❌ 导出剪映草稿失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const qaStatus = (project?.qaOverview?.status as 'pass' | 'warn' | 'block' | 'running' | undefined) || 'running';
  const composeReport = project?.snapshot?.composeResult?.report;
  const stageTasks = project?.currentRun?.agentTaskRuns || [];
  const topWarnings = useMemo(() => (composeReport?.warnings || []).slice(0, 5), [composeReport?.warnings]);

  useEffect(() => {
    setSelectedShotIndex(0);
  }, [project?.id, selectedRunId, project?.shots?.length]);

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="glass-card p-8 text-sm text-red-600">
        无法加载项目详情{error ? `：${error}` : ''}。
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl animate-in">
      <header className="mb-8 flex flex-col lg:flex-row lg:items-start justify-between gap-6 pb-6 border-b border-slate-200">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => navigate('/projects')}
            className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200 active:scale-[0.98] transition-all duration-300 group shadow-sm cursor-pointer"
          >
            <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform duration-300 text-slate-500 group-hover:text-slate-900" />
            <span>返回项目列表</span>
          </button>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900 font-heading tracking-tight">{project.title}</h1>
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold shadow-sm ${getStatusTone(qaStatus)}`}>
              {formatRunStatus(qaStatus)}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {project.selectedEpisode?.title || '未命名分集'}
            </span>
          </div>

          <p className="max-w-3xl text-xs leading-5 text-slate-500">{project.description}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {[
              { to: `/drama/${project.id}/characters`, label: '角色管理' },
              { to: `/drama/${project.id}/scenes`, label: '场景管理' },
              { to: `/drama/${project.id}/voices`, label: '配音管理' },
            ].map((link, idx) => (
              <Link
                key={idx}
                to={link.to}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200 active:scale-[0.98] transition-all duration-300"
              >
                {link.label}
              </Link>
            ))}
            
            {project.finalVideoUrl ? (
              <a
                href={project.finalVideoUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-gradient-to-r from-cyan-500 via-cyan-600 to-teal-600 px-4 py-1.5 text-xs font-semibold text-slate-900 shadow-md shadow-cyan-500/10 hover:shadow-cyan-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              >
                打开成片
              </a>
            ) : null}
          </div>
        </div>

        <div className="glass-card min-w-[300px] p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-50 rounded-full filter blur-lg pointer-events-none group-hover:scale-150 transition-transform duration-700" />
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Run</p>
          <div className="text-xs text-slate-600 space-y-2">
            <div className="mb-3 break-all rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] text-slate-700 shadow-sm select-all">
              {project.currentRun?.id || '无 run'}
            </div>
            <div className="flex justify-between py-0.5 border-b border-slate-100">
              <span className="text-slate-400">开始</span>
              <span className="font-semibold text-slate-600">{project.currentRun?.startedAt ? new Date(project.currentRun.startedAt).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'numeric', minute:'numeric'}) : '无'}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400">结束</span>
              <span className="font-semibold text-slate-600">{project.currentRun?.finishedAt ? new Date(project.currentRun.finishedAt).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'numeric', minute:'numeric'}) : '未结束'}</span>
            </div>
          </div>
        </div>
      </header>

      {error ? (
        <div className="glass-card mb-8 border border-red-200 bg-red-50 p-4 text-xs text-red-600">
          切换数据时发生错误：{error}
        </div>
      ) : null}

      <section className="mb-10 grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr,1fr]">
        <div className="glass-card overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 tracking-wide uppercase">交付预览</h2>
            {project.finalVideoUrl && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(52,211,153,1)]" />
            )}
          </div>

          <div className="p-6">
            {project.finalVideoUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-2xl bg-black">
                <video
                  src={project.finalVideoUrl}
                  controls
                  className="aspect-video w-full object-cover"
                  preload="metadata"
                />
              </div>
            ) : project.coverAssetUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-black">
                <img
                  src={project.coverAssetUrl}
                  alt={project.title}
                  className="aspect-video w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-xs text-slate-400">
                当前 run 没有可预览的成片或封面
              </div>
            )}

            <div className="mt-6 grid grid-cols-4 gap-2.5 text-center">
              {[
                { value: project.counts.totalShots, label: '镜头数' },
                { value: project.counts.imageReady, label: '出图数' },
                { value: project.counts.videoReady, label: '视频数' },
                { value: project.counts.dialogueShots, label: '对白镜头' },
              ].map((stat, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white py-3 hover:bg-slate-100 transition-colors duration-300">
                  <div className="text-xl font-extrabold text-slate-900 tracking-tight">{stat.value}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400 font-medium">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-6">
            <h2 className="mb-4 text-sm font-bold text-slate-900 tracking-wide uppercase">QA 摘要</h2>
            <div className="grid grid-cols-3 gap-2.5 text-center">
              {[
                { value: project.qaOverview?.passCount || 0, label: 'Pass', color: 'text-emerald-500' },
                { value: project.qaOverview?.warnCount || 0, label: 'Warn', color: 'text-amber-600' },
                { value: project.qaOverview?.blockCount || 0, label: 'Block', color: 'text-rose-500' },
              ].map((qa, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white py-3">
                  <div className={`text-xl font-extrabold tracking-tight ${qa.color}`}>{qa.value}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400 font-medium">{qa.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
              {project.qaOverview?.headline || project.qaOverview?.summary || '当前 run 没有额外 QA 摘要。'}
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="mb-4 text-sm font-bold text-slate-900 tracking-wide uppercase">分集与运行</h2>
            <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {project.episodes.map((episode) => {
                const isActive = episode.latestRunId === (selectedRunId || project.selectedEpisode?.latestRunId);
                return (
                  <button
                    key={episode.id}
                    onClick={() => setSelectedRunId(episode.latestRunId)}
                    className={`w-full rounded-xl border p-4 text-left transition-all duration-300 relative overflow-hidden group cursor-pointer
                      ${isActive
                        ? 'border-cyan-200 bg-cyan-50 shadow-[inset_0_1px_0_rgba(0,0,0,0.04)]'
                        : 'border-slate-200 bg-white hover:bg-slate-100 hover:translate-x-0.5'
                      }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-3 bottom-3 w-[2px] bg-cyan-500 rounded-r shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-slate-900 group-hover:text-cyan-600 transition-colors duration-300">{episode.title}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400 font-medium truncate max-w-[200px]">{episode.scriptTitle}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${getStatusTone(episode.status)}`}>
                        {formatRunStatus(episode.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-400 font-medium leading-relaxed">{episode.headline || '无额外 run 摘要'}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8 inline-flex pill-tab-container p-1 shadow-md backdrop-blur-md">
        {[
          { key: 'shots', label: '镜头详情', icon: FileVideo },
          { key: 'summary', label: '资源概览', icon: FolderTree },
          { key: 'qa', label: '任务与 QA', icon: ShieldAlert },
          { key: 'goldCombo', label: '黄金连贯预览与剪映', icon: Sparkles },
        ].map((item) => {
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key as TabKey)}
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-full transition-all duration-300 select-none relative cursor-pointer
                ${isActive 
                  ? 'bg-gradient-to-r from-cyan-500/10 via-teal-500/10 to-emerald-500/10 border border-cyan-200 text-slate-900 shadow-[0_4px_12px_rgba(6,182,212,0.15)]' 
                  : 'text-slate-500 hover:text-slate-900 border border-transparent'
                }`}
            >
              {isActive && (
                <span className="absolute inset-0 z-0 rounded-full bg-white pointer-events-none" />
              )}
              <item.icon size={13} className={`relative z-10 ${isActive ? 'text-cyan-500' : 'text-slate-400'}`} />
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </section>

      {activeTab === 'shots' ? (
        (() => {
          const shotCount = project.shots.length;
          const safeShotIndex = shotCount ? Math.min(selectedShotIndex, shotCount - 1) : 0;
          const shot = project.shots[safeShotIndex];

          if (!shot) {
            return (
              <section className="glass-card p-8 text-center text-sm text-slate-400">
                当前 run 暂无镜头详情可展示
              </section>
            );
          }

          return (
            <section className="space-y-6">
              <div className="glass-card overflow-hidden p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Shot Navigator</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-bold text-slate-900">
                      <span>{shot.title}</span>
                      <span className="text-xs font-medium text-slate-400">第 {safeShotIndex + 1} / {shotCount} 镜</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start xl:self-auto">
                    <button
                      onClick={() => setSelectedShotIndex((current) => Math.max(current - 1, 0))}
                      disabled={safeShotIndex === 0}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                      上一镜
                    </button>
                    <button
                      onClick={() => setSelectedShotIndex((current) => Math.min(current + 1, shotCount - 1))}
                      disabled={safeShotIndex === shotCount - 1}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一镜
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 -mx-4 overflow-x-auto px-4 pb-1 custom-scrollbar">
                  <div className="flex gap-3">
                  {project.shots.map((item, index) => {
                    const isSelected = index === safeShotIndex;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelectedShotIndex(index)}
                        className={`group shrink-0 overflow-hidden rounded-2xl border text-left transition-all duration-200 ${
                          isSelected
                            ? 'border-cyan-200 bg-cyan-50 text-slate-900 shadow-md'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <div className="flex w-[156px] gap-3 p-2.5">
                          <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[8px] font-semibold text-slate-400">
                                无图
                              </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-slate-900/55 px-1 py-0.5 text-center text-[8px] font-bold text-white">
                              {String(index + 1).padStart(2, '0')}
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-[11px] font-bold ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                              {item.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-[9px] leading-4 text-slate-400">
                              {item.action || '未记录动作描述'}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-[9px] font-medium text-slate-400">
                                {item.durationSec ? `${item.durationSec}s` : '未记录'}
                              </span>
                              <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${getStatusTone(item.status)}`}>
                                {formatRunStatus(item.status)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  </div>
                </div>
              </div>

              <article key={shot.id} className="glass-card overflow-hidden border border-slate-200 bg-white rounded-[20px] shadow-lg relative group">
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                  {/* 左侧列：高瘦黄金 9:16 大视频大卡片 */}
                  <div className="flex items-start justify-center px-6 pt-6 xl:px-0 xl:py-6">
                    <div className="relative w-full max-w-[420px] overflow-hidden rounded-[20px] bg-black shadow-inner" style={{ aspectRatio: '9/16' }}>
                      {shot.videoUrl ? (
                        <video
                          key={shot.videoUrl}
                          src={shot.videoUrl}
                          controls
                          className="h-full w-full object-cover"
                          preload="metadata"
                        />
                      ) : shot.imageUrl ? (
                        <div className="relative h-full w-full">
                          <img src={shot.imageUrl} alt={shot.title} className="absolute inset-0 h-full w-full scale-105 object-cover opacity-40 filter blur-[4px]" />
                          <img src={shot.imageUrl} alt={shot.title} className="relative z-10 h-full w-full object-contain" />
                        </div>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-100 text-xs text-slate-400">
                          暂无视觉产物
                        </div>
                      )}

                      {/* 左上角已完成标记 */}
                      <div className="absolute top-4 left-4 z-20">
                        <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[10px] font-bold text-slate-700 shadow-md backdrop-blur-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,1)] animate-pulse"></span>
                          已完成 {shot.title}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 右侧列：分镜详情格栅栏 */}
                  <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[85vh] custom-scrollbar">
                    {/* 1. 头部标题与基础信息 */}
                    <div className="border border-slate-200 bg-white p-5 rounded-2xl space-y-4 shadow-sm relative overflow-hidden group/inner">
                      <div className="absolute top-0 right-0 w-16 h-16 bg-white rounded-full filter blur-md pointer-events-none" />
                      <div className="flex min-h-9 items-center justify-between gap-3">
                        <h3 className="text-xl font-extrabold leading-none text-slate-900 tracking-wide">{shot.title}</h3>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-extrabold leading-none ${getStatusTone(shot.status)}`}>
                          {formatRunStatus(shot.status)}
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                        {shot.videoUrl && (
                          <a
                            href={shot.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200 transition duration-300"
                          >
                            新窗口播放
                          </a>
                        )}
                        {shot.imageUrl && (
                          <a
                            href={shot.imageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200 transition duration-300"
                          >
                            打开原画大图
                          </a>
                        )}
                      </div>

                      <div className="pt-4 border-t border-slate-200 grid grid-cols-2 gap-3 text-[10px] font-semibold text-slate-500">
                        <div>场景：<span className="text-slate-900 font-bold">{shot.scene || '未记录'}</span></div>
                        <div>角色：<span className="text-slate-900 font-bold">{shot.characters.length ? shot.characters.join(' / ') : '无'}</span></div>
                        <div>时长：<span className="text-slate-900 font-bold">{shot.durationSec ? `${shot.durationSec}s` : '未记录'}</span></div>
                        <div>机位：<span className="text-slate-900 font-bold">{shot.cameraType || '全景'}</span></div>
                      </div>
                    </div>

                    {/* 2. 分镜原画 */}
                    {shot.imageUrl && (
                      <div className="border border-slate-200 bg-white p-5 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">分镜原画 (STORYBOARD)</span>
                          <a
                            href={shot.imageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[9px] font-extrabold text-cyan-500 hover:text-cyan-600 hover:underline transition duration-300"
                          >
                            查看大图
                          </a>
                        </div>
                        <div className="w-full aspect-video rounded-xl overflow-hidden border border-slate-200 bg-slate-200 flex items-center justify-center relative group/img">
                          <img src={shot.imageUrl} alt={shot.title} className="max-h-full max-w-full object-contain group-hover/img:scale-[1.02] transition-transform duration-500 ease-out" />
                        </div>
                      </div>
                    )}

                    {/* 3. 镜头动作描述 */}
                    <div className="border border-slate-200 bg-white p-5 rounded-2xl">
                      <div className="mb-2 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">镜头画面动作描述 (ACTION)</div>
                      <p className="text-xs leading-relaxed text-slate-700 font-semibold">{shot.action || '未记录动作描述'}</p>
                    </div>

                    {/* 4. 对白配音 */}
                    <div className="border border-slate-200 bg-white p-5 rounded-2xl">
                      <div className="mb-2 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">台词配音</div>
                      {shot.dialogue ? (
                        <div className="space-y-3">
                          <p className="text-xs leading-relaxed text-slate-700 font-bold bg-white border border-slate-200 p-3 rounded-xl shadow-inner">
                            <span className="text-cyan-500 font-extrabold">[{shot.speaker || '说话人'}]</span> “{shot.dialogue}”
                          </p>
                          {shot.audioUrl && (
                            <audio className="w-full h-8" controls src={shot.audioUrl} preload="metadata" />
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic text-center py-2 font-medium">
                          本镜头无需台词配音
                        </div>
                      )}
                    </div>

                    {/* 5. 出图 Prompt 词包 */}
                    {shot.prompt && (
                      <div className="border border-slate-200 bg-white p-5 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">出图 PROMPT 词包</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(shot.prompt || '');
                              toast('📋 Prompt 词包已复制', 'success');
                            }}
                            className="text-[9px] font-extrabold text-cyan-500 hover:text-cyan-600 transition duration-300 cursor-pointer"
                          >
                            一键复制
                          </button>
                        </div>
                        <div className="max-h-[120px] overflow-y-auto p-3 bg-slate-100 border border-slate-200 rounded-xl text-[10px] leading-relaxed text-slate-500 font-mono font-medium custom-scrollbar select-all">
                          {shot.prompt}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </section>
          );
        })()
      ) : null}

      {activeTab === 'goldCombo' && project && (() => {
        const allShots = useMemo(() => {
          return project.shots?.map(s => ({
            id: s.id,
            title: s.title || `镜头 ${s.index + 1}`,
            videoUrl: s.videoUrl || undefined,
            imageUrl: s.imageUrl || undefined,
            audioUrl: s.audioUrl || undefined,
            dialogue: s.dialogue || undefined,
            speaker: s.speaker || undefined,
            durationSec: s.durationSec || 3.0
          })) || [];
        }, [project]);

        return (
          <div className="grid grid-cols-1 xl:grid-cols-[6fr_4fr] gap-8 items-start animate-in duration-300">
            {/* 左列：Remotion 连贯播放 */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">黄金连贯视轨预览 ({allShots.length} 个分镜)</span>
                <span className="text-[10px] bg-cyan-50 text-cyan-600 px-2.5 py-1 rounded-full border border-cyan-200 font-mono font-bold">
                  Remotion Active
                </span>
              </div>
              <div className="relative rounded-3xl overflow-hidden shadow-2xl p-[1px] bg-gradient-to-tr from-cyan-500/10 via-teal-500/10 to-emerald-500/10">
                <div className="bg-white rounded-[23px] overflow-hidden p-2">
                  <GoldComboPreview shots={allShots} className="w-full max-w-[400px] mx-auto border-none shadow-none bg-transparent" />
                </div>
              </div>
            </div>

            {/* 右列：剪映直达面板 */}
            <div className="glass-card border border-slate-200 bg-white/80 p-8 rounded-3xl shadow-2xl space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full filter blur-2xl pointer-events-none" />
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2 tracking-wide uppercase">
                  <Sparkles className="text-emerald-500 animate-pulse" size={20} />
                  剪映草稿一键直达
                </h3>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  一键快速将音轨（对白配音）、视轨（原画或已生成视频）及台词字幕轨道，100%原样写入您本地 Windows 剪映 App 的草稿夹，极速开展二次精修与创意包装！
                </p>
              </div>

              {/* 触发导出与状态 */}
              <div className="p-6 bg-white border border-slate-200 rounded-2xl space-y-4">
                <button
                  onClick={handleExportJianying}
                  disabled={exporting || allShots.length === 0}
                  className="w-full py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-slate-900 font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg hover:shadow-emerald-500/10 hover:scale-[1.01] active:scale-[0.99] transition-all duration-300 disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {exporting ? (
                    <>
                      <Loader2 className="animate-spin text-slate-900" size={16} />
                      <span>构建音视频字幕轨道中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>一键写入本地剪映专业版草稿</span>
                    </>
                  )}
                </button>

                {/* 成功状态 */}
                {exportResult && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3 animate-in">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={15} />
                      <div>
                        <h4 className="text-xs font-bold text-emerald-500">一键导出并写入成功！</h4>
                        <p className="text-[10px] text-emerald-600/80 mt-1">
                          项目名称：<span className="font-mono bg-slate-200 px-1.5 py-0.5 rounded text-slate-900 select-all">{exportResult.projectName}</span>
                        </p>
                      </div>
                    </div>
                    {exportResult.directToCapcut ? (
                      <div className="text-[10px] text-emerald-500 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 font-medium">
                        🎉 剪映客户端环境检测通过，草稿已**直接送达**您的剪映本地列表中！
                      </div>
                    ) : (
                      <div className="text-[10px] text-cyan-500 bg-cyan-50 px-3 py-2 rounded-lg border border-cyan-100 font-medium">
                        ℹ️ 未定位到标准剪映路径，草稿已保存在项目根目录下：<br/>
                        <span className="font-mono select-all bg-white/80 px-1.5 py-0.5 rounded block mt-1">{exportResult.exportPath}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 失败状态 */}
                {exportError && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 animate-in">
                    <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={15} />
                    <div>
                      <h4 className="text-xs font-bold text-rose-500">导出发生错误</h4>
                      <p className="text-[10px] text-rose-600/80 mt-1">{exportError}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 双向联调演练指南 */}
              <div className="space-y-3.5 border-t border-slate-200 pt-5">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <HelpCircle size={14} className="text-slate-400" />
                  双向联调联演指南
                </h4>
                <ol className="text-[10px] text-slate-500 space-y-2 list-decimal list-inside leading-relaxed pl-1 font-medium">
                  <li>在左侧播放器中**点按播放**，核对原画与视频片段在时间轴上的连贯卡点与字幕视觉；</li>
                  <li>点击“一键写入本地剪映专业版草稿”按钮，等待成功通知；</li>
                  <li>打开您 Windows 本地的**剪映专业版** App，在草稿列表中将直接看到名为 <span className="text-emerald-500 font-bold">[{exportResult?.projectName || 'AI漫剧_xxxx'}]</span> 的草稿项目；</li>
                  <li>双击打开该草稿项目，所有的视频分镜、标准配音音频、台词花字字幕轨道皆已**完美卡点对齐**，您只需进行转场、滤镜与背景音乐的叠加即可完美秒级导出成片！</li>
                </ol>
              </div>
            </div>
          </div>
        );
      })()}

      {activeTab === 'summary' ? (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <Users className="text-cyan-500" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">角色</h2>
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
              {project.characters.map((character) => (
                <div key={character.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{character.name}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400 font-medium">
                        {character.gender} · {character.age} · {character.shotCount} 个镜头
                      </div>
                    </div>
                    {character.referenceImageUrl && (
                      <img src={character.referenceImageUrl} alt={character.name} className="h-10 w-10 rounded-lg object-cover border border-slate-200" />
                    )}
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500 font-medium">{character.visualDescription}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <ImageIcon className="text-emerald-500" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">场景</h2>
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
              {project.scenes.map((scene) => (
                <div key={scene.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{scene.title}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400 font-medium">{scene.location}</div>
                    </div>
                    {scene.imageUrl && (
                      <img src={scene.imageUrl} alt={scene.title} className="h-10 w-10 rounded-lg object-cover border border-slate-200" />
                    )}
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500 font-medium">{scene.goal}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <Mic className="text-amber-600" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">配音</h2>
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
              {project.voices.map((voice) => (
                <div key={voice.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-bold text-slate-900">{voice.name}</div>
                  <div className="mt-1.5 text-[10px] text-slate-400 font-medium space-y-0.5">
                    <div>厂商：{voice.provider} · {voice.gender}</div>
                    <div>段数：{voice.segmentCount} 段对白 · {voice.voiceSource}</div>
                  </div>
                  {voice.sampleAudioUrl && (
                    <audio className="mt-3 w-full h-8" controls src={voice.sampleAudioUrl} preload="none" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'qa' ? (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <RefreshCw className="text-cyan-500 animate-spin-slow" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">任务流水</h2>
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
              {stageTasks.map((task) => {
                const status = task.error ? 'block' : (task.status as 'pass' | 'warn' | 'block' | 'running' | undefined) || 'running';
                return (
                  <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900">{task.detail || task.step}</div>
                        <div className="mt-1 break-all font-mono text-[9px] text-slate-400">{task.step}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-extrabold shrink-0 ${getStatusTone(status as any)}`}>
                        {formatRunStatus(status as any)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-slate-400 font-semibold border-t border-slate-100 pt-2">
                      <span>Agent: {task.agent || 'director'}</span>
                      <span>开始: {task.startedAt ? new Date(task.startedAt).toLocaleTimeString('zh-CN') : '无'}</span>
                      <span>结束: {task.finishedAt ? new Date(task.finishedAt).toLocaleTimeString('zh-CN') : '未完成'}</span>
                    </div>
                    {task.error && <div className="mt-3 text-[10px] text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-lg font-medium">{task.error}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-card p-6">
              <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
                <Sparkles className="text-amber-600" size={18} />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">交付提醒</h2>
              </div>
              {topWarnings.length ? (
                <div className="space-y-2.5">
                  {topWarnings.map((warning, index) => (
                    <div key={index} className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs text-amber-700/90 leading-relaxed font-medium">
                      {warning}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-400 text-center font-medium">当前没有额外交付提醒。</div>
              )}
            </div>

            <div className="glass-card p-6">
              <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
                <PlayCircle className="text-emerald-500" size={18} />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">产物入口</h2>
              </div>
              <div className="space-y-2.5 text-xs">
                {project.finalVideoUrl && (
                  <a
                    href={project.finalVideoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-slate-200 bg-white p-4 text-slate-900 hover:text-cyan-500 hover:bg-slate-100 hover:border-cyan-100 transition-all duration-300 font-bold"
                  >
                    成片视频
                  </a>
                )}
                {project.deliverySummaryUrl && (
                  <a
                    href={project.deliverySummaryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-slate-200 bg-white p-4 text-slate-900 hover:text-cyan-500 hover:bg-slate-100 hover:border-cyan-100 transition-all duration-300 font-bold"
                  >
                    delivery-summary.md
                  </a>
                )}
                {project.artifactSummary?.runDir && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-[10px] leading-relaxed text-slate-400 font-mono font-medium">
                    Run 目录：{project.artifactSummary.runDir}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
