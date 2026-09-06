import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  Film,
  Play,
} from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';
import {
  clearRequestCache,
  formatRunStatus,
  getStatusTone,
  humanizeQaText,
  isRunReviewable,
  isRunTerminal,
  subscribeToRunStream,
  triggerRun,
  type QaAgentSummary,
  type RunMode,
  type RunStreamSubscription,
  type WorkbenchStatus,
} from '../lib/workbench';
import { useToast } from '../components/ToastContext';
import GoldComboPreview from '../components/remotion/GoldComboPreview';
import ImageWithPreview from '../components/ImageWithPreview';

type TabKey = 'shots' | 'summary' | 'qa' | 'goldCombo';

function QaIssueCard({
  item,
}: {
  item: { summary: QaAgentSummary; status: 'warn' | 'block'; issue: string };
}) {
  const statusTone =
    item.status === 'block'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  const badgeTone =
    item.status === 'block'
      ? 'border-rose-200 bg-white text-rose-600'
      : 'border-amber-200 bg-white text-amber-700';
  const evidence = item.summary.evidenceFiles || [];
  const nextAction = item.summary.nextAction || item.summary.nextActions?.[0] || '';

  return (
    <div className={`rounded-xl border p-4 text-xs leading-relaxed ${statusTone}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-extrabold text-slate-900">{humanizeQaText(item.summary.agentName || item.summary.agentKey || '未知模块')}</div>
          <div className="mt-0.5 font-medium opacity-80">{humanizeQaText(item.summary.headline || item.summary.summary || '')}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${badgeTone}`}>
          {item.status === 'block' ? '阻断' : '提醒'}
        </span>
      </div>

      <div className="rounded-lg border border-white/70 bg-white/70 p-3 font-semibold text-slate-700">
        {humanizeQaText(item.issue)}
      </div>

      {nextAction ? (
        <div className="mt-2 text-[10px] font-medium text-slate-600">
          下一步：{humanizeQaText(nextAction)}
        </div>
      ) : null}

      {evidence.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {evidence.slice(0, 4).map((file) => (
            <span key={file} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[9px] text-slate-500">
              {file}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DramaDetail() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const explicitEpisodeId = searchParams.get('episode');
  const explicitScriptId = searchParams.get('script');
  const queryRunId = searchParams.get('run');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(queryRunId);
  const [activeTab, setActiveTab] = useState<TabKey>('shots');
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  const [qaFilter, setQaFilter] = useState<'all' | 'warn' | 'block'>('all');
  const { project, loading, error } = useWorkbenchProject(projectId, {
    runId: selectedRunId,
    scriptId: explicitScriptId || undefined,
    episodeId: explicitEpisodeId || undefined,
  });

  useEffect(() => {
    setSelectedRunId(queryRunId);
  }, [queryRunId]);

  useEffect(() => {
    if (!project?.selectedEpisode) return;
    if (queryRunId && project.currentRun?.id !== queryRunId) {
      setSelectedRunId(project.currentRun?.id || null);
      return;
    }
    if (!queryRunId && explicitEpisodeId && !selectedRunId && project.currentRun?.id) {
      setSelectedRunId(project.currentRun.id);
    }
  }, [explicitEpisodeId, project?.currentRun?.id, project?.selectedEpisode, queryRunId, selectedRunId]);

  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMenuOpen, setRetryMenuOpen] = useState(false);
  const retryMenuRef = useRef<HTMLDivElement>(null);
  const retrySubRef = useRef<RunStreamSubscription | null>(null);

  useEffect(() => {
    if (!explicitEpisodeId || !project?.episodes?.length || selectedRunId) return;
    const matched = project.episodes.find((episode) => episode.id === explicitEpisodeId && (!explicitScriptId || episode.scriptId === explicitScriptId));
    if (matched?.latestRunId) {
      setSelectedRunId(matched.latestRunId);
    }
  }, [explicitEpisodeId, explicitScriptId, project?.episodes, selectedRunId]);

  const currentRunStatus = String(project?.currentRun?.status || '').toLowerCase();
  const isFailedRun = ['failed', 'error', 'blocked', 'block'].includes(currentRunStatus);

  const refreshAfterRetry = (runId: string) => {
    setRetrying(false);
    retrySubRef.current?.close();
    retrySubRef.current = null;
    clearRequestCache('/api/projects');
    clearRequestCache(`/api/runs/${runId}`);
    window.location.reload();
  };

  const retryModeOptions: Array<{ label: string; icon: ReactNode; mode: RunMode; confirmLabel: string }> = [
    { label: '完整重试', icon: <Play size={12} className="text-cyan-500" />, mode: { kind: 'retry', stopAt: 'full' }, confirmLabel: '清理上次阻断产物并完整重试' },
    { label: '重试到角色三视图后', icon: <Users size={12} className="text-pink-500" />, mode: { kind: 'retry', stopAt: 'after_ref_sheets' }, confirmLabel: '清理上次阻断产物并重试到角色三视图后' },
    { label: '重试到角色/场景图后', icon: <ImageIcon size={12} className="text-amber-500" />, mode: { kind: 'retry', stopAt: 'after_images' }, confirmLabel: '清理上次阻断产物并重试到角色/场景图后' },
    { label: '重试到生视频前', icon: <Film size={12} className="text-violet-500" />, mode: { kind: 'retry', stopAt: 'before_video' }, confirmLabel: '清理上次阻断产物并重试到生视频前' },
    { label: '根据现有进度继续运行', icon: <RefreshCw size={12} className="text-emerald-500" />, mode: { kind: 'continue' }, confirmLabel: '根据现有进度继续运行' },
    { label: '继续运行到生视频前', icon: <RefreshCw size={12} className="text-blue-500" />, mode: { kind: 'continue', stopAt: 'before_video' }, confirmLabel: '根据现有进度继续运行到生视频前' },
  ];

  useEffect(() => {
    if (!retryMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (retryMenuRef.current && !retryMenuRef.current.contains(event.target as Node)) {
        setRetryMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [retryMenuOpen]);

  const handleRetryConfirmed = async (mode: RunMode = { kind: 'retry', stopAt: 'full' }, confirmLabel = '清理上次阻断产物并完整重试') => {
    if (!project?.id || !project.selectedEpisode) return;
    if (!confirm(`确认「${confirmLabel}」本集？\n\n提示：选择“生视频前”可以避免直接产生昂贵的视频生成费用。`)) return;
    setRetryMenuOpen(false);
    setRetrying(true);

    try {
      const result = await triggerRun(project.id, project.selectedEpisode.scriptId, project.selectedEpisode.id, {
        mode,
      });
      const runId = (result as { runId?: string }).runId;
      if (!runId) {
        throw new Error('重试未返回 Run ID');
      }

      toast('重试任务已启动', 'success');
      retrySubRef.current?.close();
      retrySubRef.current = subscribeToRunStream(runId, {
        onStatus(data) {
          if (isRunTerminal(data.status)) {
            refreshAfterRetry(runId);
          }
        },
        onDone() {
          refreshAfterRetry(runId);
        },
        onServerError(message) {
          setRetrying(false);
          toast(`❌ 实时订阅失败：${message}`, 'error');
        },
        onConnectionError() {
          toast('⚠️ 进度连接暂时中断，任务可能仍在后台继续运行', 'error');
        },
      });
    } catch (err: any) {
      setRetrying(false);
      toast(`❌ 重试失败：${err?.message || '未知错误'}`, 'error');
    }
  };

  useEffect(() => {
    return () => {
      retrySubRef.current?.close();
    };
  }, []);

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
      setExportError(err.message || '导出发生未知错误');
      toast('❌ 导出剪映草稿失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const qaStatus = (project?.qaOverview?.status as WorkbenchStatus | undefined) || 'running';
  const composeReport = project?.snapshot?.composeResult?.report;
  const stageTasks = project?.currentRun?.agentTaskRuns || [];
  const topWarnings = useMemo(() => (composeReport?.warnings || []).slice(0, 5), [composeReport?.warnings]);
  const qaPanelRef = useRef<HTMLDivElement>(null);
  const qaIssueLogRef = useRef<HTMLDivElement>(null);
  const qaIssueSummaries = useMemo(() => {
    const summaries = project?.qaOverview?.agentSummaries || [];
    return summaries
      .filter((item) => item.status === 'warn' || item.status === 'block')
      .flatMap((item) => {
        const status: 'warn' | 'block' = item.status === 'block' ? 'block' : 'warn';
        const issues = status === 'block' ? item.blockItems || [] : item.warnItems || [];
        const fallback = item.summary || item.headline || '';
        const rows = issues.length ? issues : (fallback ? [fallback] : []);
        return rows.map((issue) => ({ summary: item, status, issue }));
      });
  }, [project?.qaOverview?.agentSummaries]);

  const jumpToQa = (filter: 'all' | 'warn' | 'block') => {
    setQaFilter(filter);
    setActiveTab('qa');
    window.setTimeout(() => {
      (qaIssueLogRef.current || qaPanelRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  useEffect(() => {
    setSelectedShotIndex(0);
  }, [project?.id, project?.shots?.length, selectedRunId]);

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

  const episodeQuery = new URLSearchParams();
  if (project.selectedEpisode?.id) episodeQuery.set('episode', project.selectedEpisode.id);
  if (project.selectedEpisode?.scriptId) episodeQuery.set('script', project.selectedEpisode.scriptId);
  if (project.currentRun?.id) episodeQuery.set('run', project.currentRun.id);
  const detailQuery = episodeQuery.toString() ? `?${episodeQuery.toString()}` : '';
  const canReviewCurrentRun = Boolean(project.currentRun?.id && isRunReviewable(project.currentRun?.status));
  const reviewHref = canReviewCurrentRun
    ? `/review/${encodeURIComponent(project.currentRun!.id)}?projectId=${encodeURIComponent(project.id)}&episodeId=${encodeURIComponent(project.selectedEpisode?.id || '')}&scriptId=${encodeURIComponent(project.selectedEpisode?.scriptId || '')}&runId=${encodeURIComponent(project.currentRun!.id)}`
    : '';
  const editorHref = `/editor?projectId=${encodeURIComponent(project.id)}&scriptId=${encodeURIComponent(project.selectedEpisode?.scriptId || '')}&episodeId=${encodeURIComponent(project.selectedEpisode?.id || '')}&runId=${encodeURIComponent(project.currentRun?.id || '')}`;
  const runStatus = String(project.currentRun?.status || '').toLowerCase();
  const runIsTerminal = project.currentRun?.status ? isRunTerminal(project.currentRun.status) || ['pass', 'success', 'cached'].includes(runStatus) : false;
  const hasPreviewAsset = Boolean(project.finalVideoUrl || project.coverAssetUrl);
  const hasAnyDeliveryAsset = Boolean(
    project.finalVideoUrl ||
    project.deliverySummaryUrl ||
    project.coverAssetUrl ||
    project.counts.imageReady > 0 ||
    project.counts.videoReady > 0 ||
    (project.artifactSummary?.outputFiles?.length || 0) > 0
  );
  const runFailureMessage = isFailedRun ? humanizeQaText(project.currentRun?.error || project.qaOverview?.summary || '') : '';
  const deliveryIssues = [
    ...(!isFailedRun && runIsTerminal && !project.currentRun?.finishedAt ? ['运行已进入终态，但 run 没有写入结束时间。'] : []),
    ...(!isFailedRun && qaStatus === 'pass' && !project.finalVideoUrl ? ['QA 显示通过，但没有成片视频输出。'] : []),
    ...(!isFailedRun && runIsTerminal && !hasAnyDeliveryAsset ? ['运行已结束，但没有任何可预览产物或交付文件。'] : []),
    ...(!isFailedRun && runIsTerminal && project.counts.totalShots > 0 && project.counts.videoReady === 0 ? ['当前分集有镜头，但没有生成任何视频片段。'] : []),
  ];
  const deliveryStatus: WorkbenchStatus = isFailedRun ? 'block' : deliveryIssues.length ? 'warn' : qaStatus;
  const deliveryStatusLabel = deliveryIssues.length ? '产物缺失' : formatRunStatus(deliveryStatus);

  return (
    <div className="mx-auto max-w-7xl animate-in">
      <header className="mb-8 flex flex-col gap-6 border-b border-slate-200 pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => navigate(`/project/${projectId}`)}
            className="group mb-5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm transition-all duration-300 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98]"
          >
            <ArrowLeft size={14} className="text-slate-500 transition-transform duration-300 group-hover:-translate-x-0.5 group-hover:text-slate-900" />
            <span>返回项目概览</span>
          </button>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-3xl font-extrabold tracking-tight text-slate-900">{project.title}</h1>
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold shadow-sm ${getStatusTone(deliveryStatus)}`}>
              {deliveryStatusLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {project.selectedEpisode?.title || '未命名分集'}
            </span>
          </div>

          <p className="max-w-3xl text-xs leading-5 text-slate-500">{project.description}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {[
              { to: `/drama/${project.id}/characters${detailQuery}`, label: '角色 / 配音管理' },
              { to: `/drama/${project.id}/scenes${detailQuery}`, label: '场景管理' },
            ].map((link, idx) => (
              <Link
                key={idx}
                to={link.to}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98]"
              >
                {link.label}
              </Link>
            ))}

            {project.selectedEpisode?.id && project.selectedEpisode?.scriptId ? (
              <Link
                to={editorHref}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98]"
              >
                编辑分镜
              </Link>
            ) : null}

            {canReviewCurrentRun ? (
              <Link
                to={reviewHref}
                className="rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-700 transition-all duration-300 hover:bg-amber-100 active:scale-[0.98]"
              >
                审片
              </Link>
            ) : null}

            {project.finalVideoUrl ? (
              <a
                href={project.finalVideoUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-gradient-to-r from-cyan-500 via-cyan-600 to-teal-600 px-4 py-1.5 text-xs font-semibold text-slate-900 shadow-md shadow-cyan-500/10 transition-all duration-300 hover:scale-[1.02] hover:shadow-cyan-500/20 active:scale-[0.98]"
              >
                打开成片
              </a>
            ) : null}

            {isFailedRun && !retrying ? (
              <div className="relative" ref={retryMenuRef}>
                <button
                  onClick={() => setRetryMenuOpen((open) => !open)}
                  disabled={retrying}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-1.5 text-xs font-bold text-white shadow-md shadow-rose-500/20 transition-all duration-300 hover:scale-[1.02] hover:shadow-rose-500/35 active:scale-[0.98] disabled:opacity-50"
                >
                  <RefreshCw size={13} />
                  重试本集
                </button>
                {retryMenuOpen ? (
                  <div className="absolute left-0 top-full z-50 mt-2 w-60 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
                    {retryModeOptions.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => void handleRetryConfirmed(item.mode, item.confirmLabel)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        {item.icon}
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {retrying ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-xs font-bold text-cyan-700">
                <Loader2 size={13} className="animate-spin" />
                重试运行中…
              </span>
            ) : null}
          </div>
        </div>

        <div className="glass-card group relative min-w-[300px] overflow-hidden p-5">
          <div className="pointer-events-none absolute right-0 top-0 h-20 w-20 rounded-full bg-cyan-50 blur-lg transition-transform duration-700 group-hover:scale-150" />
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Run</p>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="mb-3 select-all break-all rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] text-slate-700 shadow-sm">
              {project.currentRun?.id || '无 run'}
            </div>
            <div className="flex justify-between border-b border-slate-100 py-0.5">
              <span className="text-slate-400">开始</span>
              <span className="font-semibold text-slate-600">
                {project.currentRun?.startedAt
                  ? new Date(project.currentRun.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
                  : '无'}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-400">结束</span>
              <span className="font-semibold text-slate-600">
                {project.currentRun?.finishedAt
                  ? new Date(project.currentRun.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
                  : runIsTerminal
                    ? '缺少结束时间'
                    : '未结束'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {error ? (
        <div className="glass-card mb-8 border border-red-200 bg-red-50 p-4 text-xs text-red-600">
          切换数据时发生错误：{error}
        </div>
      ) : null}

      {runFailureMessage ? (
        <div className="glass-card mb-8 border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-700">
          <div className="mb-2 flex items-center gap-2 font-extrabold text-rose-800">
            <AlertTriangle size={15} />
            当前 run 已阻断
          </div>
          <div className="whitespace-pre-wrap">{runFailureMessage}</div>
          <div className="mt-3 rounded-lg border border-rose-200 bg-white/70 px-3 py-2 font-mono text-[10px] text-rose-600">
            run={project.currentRun?.id || '无'} status={project.currentRun?.status || 'unknown'}
          </div>
        </div>
      ) : null}

      {deliveryIssues.length ? (
        <div className="glass-card mb-8 border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          <div className="mb-2 flex items-center gap-2 font-extrabold text-amber-900">
            <AlertTriangle size={15} />
            交付状态不完整
          </div>
          <ul className="list-inside list-disc space-y-1">
            {deliveryIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 font-mono text-[10px] text-amber-700">
            run={project.currentRun?.id || '无'} status={project.currentRun?.status || 'unknown'} finalVideo={project.finalVideoUrl || 'missing'}
          </div>
        </div>
      ) : null}

      <section className="mb-10 grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr,1fr]">
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">交付预览</h2>
            {project.finalVideoUrl ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,1)]" /> : null}
          </div>

          <div className="p-6">
            {project.finalVideoUrl ? (
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-2xl">
                <video src={project.finalVideoUrl} controls className="aspect-video w-full object-cover" preload="metadata" />
              </div>
            ) : deliveryIssues.length ? (
              <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-6 text-center text-xs leading-6 text-amber-800">
                当前 run 被标记为完成/通过，但没有成片视频可预览。请查看下方 QA、任务流水或 run 目录，确认生成链路在哪一步没有产出。
              </div>
            ) : hasPreviewAsset ? (
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black">
                <img src={project.coverAssetUrl!} alt={project.title} className="aspect-video w-full object-cover" />
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
                <div key={idx} className="rounded-xl border border-slate-200 bg-white py-3 transition-colors duration-300 hover:bg-slate-100">
                  <div className="text-xl font-extrabold tracking-tight text-slate-900">{stat.value}</div>
                  <div className="mt-0.5 text-[10px] font-medium text-slate-400">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-900">QA 摘要</h2>
            <div className="grid grid-cols-3 gap-2.5 text-center">
              {[
                { value: project.qaOverview?.passCount || 0, label: '已通过', color: 'text-emerald-500', filter: 'all' as const },
                { value: project.qaOverview?.warnCount || 0, label: '需留意', color: 'text-amber-600', filter: 'warn' as const },
                { value: project.qaOverview?.blockCount || 0, label: '已阻断', color: 'text-rose-500', filter: 'block' as const },
              ].map((qa, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => jumpToQa(qa.filter)}
                  className="rounded-xl border border-slate-200 bg-white py-3 text-center transition hover:border-cyan-200 hover:bg-cyan-50"
                  title="点击查看对应 QA 日志"
                >
                  <div className={`text-xl font-extrabold tracking-tight ${qa.color}`}>{qa.value}</div>
                  <div className="mt-0.5 text-[10px] font-medium text-slate-400">{qa.label}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
              {humanizeQaText(project.qaOverview?.headline || project.qaOverview?.summary || '当前 run 没有额外 QA 摘要。')}
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-900">分集与运行</h2>
            <div className="max-h-[280px] space-y-2.5 overflow-y-auto pr-1">
              {project.episodes.map((episode) => {
                const isActive = episode.latestRunId === (selectedRunId || project.selectedEpisode?.latestRunId);
                return (
                  <button
                    key={episode.id}
                    onClick={() => setSelectedRunId(episode.latestRunId)}
                    className={`group relative w-full cursor-pointer overflow-hidden rounded-xl border p-4 text-left transition-all duration-300 ${
                      isActive
                        ? 'border-cyan-200 bg-cyan-50 shadow-[inset_0_1px_0_rgba(0,0,0,0.04)]'
                        : 'border-slate-200 bg-white hover:translate-x-0.5 hover:bg-slate-100'
                    }`}
                  >
                    {isActive ? <span className="absolute bottom-3 left-0 top-3 w-[2px] rounded-r bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]" /> : null}
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-slate-900 transition-colors duration-300 group-hover:text-cyan-600">{episode.title}</div>
                        <div className="mt-0.5 max-w-[200px] truncate text-[10px] font-medium text-slate-400">{episode.scriptTitle}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${getStatusTone(episode.status)}`}>
                        {formatRunStatus(episode.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-[10px] font-medium leading-relaxed text-slate-400">{episode.headline || '无额外 run 摘要'}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="pill-tab-container mb-8 inline-flex p-1 shadow-md backdrop-blur-md">
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
              className={`relative inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-5 py-2.5 text-xs font-bold transition-all duration-300 ${
                isActive
                  ? 'border-cyan-200 bg-gradient-to-r from-cyan-500/10 via-teal-500/10 to-emerald-500/10 text-slate-900 shadow-[0_4px_12px_rgba(6,182,212,0.15)]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {isActive ? <span className="absolute inset-0 z-0 rounded-full bg-white" /> : null}
              <item.icon size={13} className={`relative z-10 ${isActive ? 'text-cyan-500' : 'text-slate-400'}`} />
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </section>

      {activeTab === 'shots'
        ? (() => {
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
                        <span className="text-xs font-medium text-slate-400">
                          第 {safeShotIndex + 1} / {shotCount} 镜
                        </span>
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

                  <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 custom-scrollbar">
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
                                  <div className="flex h-full w-full items-center justify-center text-[8px] font-semibold text-slate-400">无图</div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 bg-slate-900/55 px-1 py-0.5 text-center text-[8px] font-bold text-white">
                                  {String(index + 1).padStart(2, '0')}
                                </div>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className={`truncate text-[11px] font-bold ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>{item.title}</div>
                                <div className="mt-1 line-clamp-2 text-[9px] leading-4 text-slate-400">{item.action || '未记录动作描述'}</div>
                                <div className="mt-2 flex items-center gap-1.5">
                                  <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[8px] font-bold text-slate-500">{item.durationSec ? `${item.durationSec}s` : '-'}</span>
                                  <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-extrabold ${getStatusTone(item.status)}`}>{formatRunStatus(item.status)}</span>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <article className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
                  <div className="space-y-6">
                    <section className="glass-card overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Visual Delivery</div>
                          <h2 className="mt-1 text-lg font-extrabold text-slate-900">{shot.title}</h2>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${getStatusTone(shot.status)}`}>{formatRunStatus(shot.status)}</span>
                      </div>

                      <div className="p-5">
                        {shot.videoUrl ? (
                          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-xl">
                            <video src={shot.videoUrl} controls className="aspect-video w-full object-cover" preload="metadata" />
                          </div>
                        ) : shot.imageUrl ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-100 p-2">
                            <ImageWithPreview
                              src={shot.imageUrl}
                              alt={shot.title}
                              containerClassName="w-full aspect-video rounded-xl border border-slate-200 bg-slate-200 flex items-center justify-center"
                              className="max-h-full max-w-full object-contain transition-transform duration-500 ease-out group-hover:scale-[1.02]"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-xs text-slate-400">
                            当前镜头没有视频或原画
                          </div>
                        )}
                      </div>
                    </section>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-2 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">镜头画面动作描述 (Action)</div>
                      <p className="text-xs font-semibold leading-relaxed text-slate-700">{shot.action || '未记录动作描述'}</p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-2 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">台词配音</div>
                      {shot.dialogue ? (
                        <div className="space-y-3">
                          <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold leading-relaxed text-slate-700 shadow-inner">
                            <span className="font-extrabold text-cyan-500">[{shot.speaker || '说话人'}]</span> “{shot.dialogue}”
                          </p>
                          {shot.audioUrl ? <audio className="h-8 w-full" controls src={shot.audioUrl} preload="metadata" /> : null}
                        </div>
                      ) : (
                        <div className="py-2 text-center text-[11px] font-medium italic text-slate-400">本镜头无需台词配音</div>
                      )}
                    </div>

                    {shot.prompt ? (
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">出图 Prompt 词包</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(shot.prompt || '');
                              toast('📋 Prompt 词包已复制', 'success');
                            }}
                            className="cursor-pointer text-[9px] font-extrabold text-cyan-500 transition duration-300 hover:text-cyan-600"
                          >
                            一键复制
                          </button>
                        </div>
                        <div className="custom-scrollbar max-h-[120px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-3 font-mono text-[10px] font-medium leading-relaxed text-slate-500 select-all">
                          {shot.prompt}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-6">
                    <div className="glass-card p-6">
                      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-900">镜头元信息</h2>
                      <div className="space-y-2 text-xs text-slate-500">
                        <div className="flex justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <span>场景</span>
                          <span className="font-semibold text-slate-700">{shot.scene}</span>
                        </div>
                        <div className="flex justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <span>人物</span>
                          <span className="font-semibold text-slate-700">{shot.characters.length ? shot.characters.join(' / ') : '无'}</span>
                        </div>
                        <div className="flex justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <span>镜头类型</span>
                          <span className="font-semibold text-slate-700">{shot.cameraType || '未记录'}</span>
                        </div>
                        <div className="flex justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <span>视频 Provider</span>
                          <span className="font-semibold text-slate-700">{shot.provider || '未记录'}</span>
                        </div>
                      </div>
                    </div>

                    {shot.imageUrl ? (
                      <div className="glass-card p-6">
                        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-900">原画入口</h2>
                        <a
                          href={shot.imageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                        >
                          <ImageIcon size={14} />
                          查看大图
                        </a>
                      </div>
                    ) : null}
                  </div>
                </article>
              </section>
            );
          })()
        : null}

      {activeTab === 'goldCombo' && project
        ? (() => {
            const allShots =
              project.shots?.map((shot) => ({
                id: shot.id,
                title: shot.title || `镜头 ${shot.index + 1}`,
                videoUrl: shot.videoUrl || undefined,
                imageUrl: shot.imageUrl || undefined,
                audioUrl: shot.audioUrl || undefined,
                dialogue: shot.dialogue || undefined,
                speaker: shot.speaker || undefined,
                durationSec: shot.durationSec || 3.0,
              })) || [];

            return (
              <div className="grid animate-in items-start gap-8 grid-cols-1 xl:grid-cols-[6fr_4fr]">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">黄金连贯视轨预览 ({allShots.length} 个分镜)</span>
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-mono text-[10px] font-bold text-cyan-600">Remotion Active</span>
                  </div>
                  <div className="rounded-3xl bg-gradient-to-tr from-cyan-500/10 via-teal-500/10 to-emerald-500/10 p-[1px] shadow-2xl">
                    <div className="overflow-hidden rounded-[23px] bg-white p-2">
                      <GoldComboPreview shots={allShots} className="mx-auto w-full max-w-[400px] border-none bg-transparent shadow-none" />
                    </div>
                  </div>
                </div>

                <div className="glass-card group relative overflow-hidden rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-2xl">
                  <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-emerald-50 blur-2xl" />
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-extrabold uppercase tracking-wide text-slate-900">
                      <Sparkles className="animate-pulse text-emerald-500" size={20} />
                      剪映草稿一键直达
                    </h3>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      一键将音轨、视轨与字幕轨道写入本地 Windows 剪映草稿，便于继续包装与精修。
                    </p>
                  </div>

                  <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
                    <button
                      onClick={handleExportJianying}
                      disabled={exporting || allShots.length === 0}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 py-4 text-xs font-extrabold uppercase tracking-wider text-slate-900 shadow-lg transition-all duration-300 hover:scale-[1.01] hover:shadow-emerald-500/10 active:scale-[0.99] disabled:opacity-40"
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

                    {exportResult ? (
                      <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 animate-in">
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={15} />
                          <div>
                            <h4 className="text-xs font-bold text-emerald-500">一键导出并写入成功</h4>
                            <p className="mt-1 text-[10px] text-emerald-600/80">
                              项目名称：
                              <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-slate-900 select-all">{exportResult.projectName}</span>
                            </p>
                          </div>
                        </div>
                        <div className={`rounded-lg px-3 py-2 text-[10px] font-medium ${exportResult.directToCapcut ? 'border border-emerald-100 bg-emerald-50 text-emerald-500' : 'border border-cyan-100 bg-cyan-50 text-cyan-500'}`}>
                          {exportResult.directToCapcut
                            ? '草稿已直接写入剪映本地列表。'
                            : `草稿已生成到：${exportResult.exportPath}`}
                        </div>
                      </div>
                    ) : null}

                    {exportError ? (
                      <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 animate-in">
                        <AlertTriangle className="mt-0.5 shrink-0 text-rose-500" size={15} />
                        <div>
                          <h4 className="text-xs font-bold text-rose-500">导出发生错误</h4>
                          <p className="mt-1 text-[10px] text-rose-600/80">{exportError}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 space-y-3.5 border-t border-slate-200 pt-5">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <HelpCircle size={14} className="text-slate-400" />
                      联调指南
                    </h4>
                    <ol className="list-inside list-decimal space-y-2 pl-1 text-[10px] font-medium leading-relaxed text-slate-500">
                      <li>先在左侧播放器核对画面、节奏和字幕。</li>
                      <li>点击按钮写入剪映草稿。</li>
                      <li>打开本地剪映，检查草稿中的音视频轨道与字幕。</li>
                    </ol>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {activeTab === 'summary' ? (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <Users className="text-cyan-500" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">角色</h2>
            </div>
            <div className="custom-scrollbar max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {project.characters.map((character) => (
                <div key={character.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{character.name}</div>
                      <div className="mt-0.5 text-[10px] font-medium text-slate-400">
                        {character.gender} · {character.age} · {character.shotCount} 个镜头
                      </div>
                    </div>
                    {character.referenceImageUrl ? (
                      <a href={character.referenceImageUrl} target="_blank" rel="noreferrer" className="block h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                        <img src={character.referenceImageUrl} alt={character.name} className="h-full w-full object-contain" />
                      </a>
                    ) : null}
                  </div>
                  <p className="text-[10px] font-medium leading-relaxed text-slate-500">{character.visualDescription}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <ImageIcon className="text-emerald-500" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">场景</h2>
            </div>
            <div className="custom-scrollbar max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {project.scenes.map((scene) => (
                <div key={scene.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{scene.title}</div>
                      <div className="mt-0.5 text-[10px] font-medium text-slate-400">{scene.location}</div>
                    </div>
                    {scene.imageUrl ? <img src={scene.imageUrl} alt={scene.title} className="h-10 w-10 rounded-lg border border-slate-200 object-cover" /> : null}
                  </div>
                  <p className="text-[10px] font-medium leading-relaxed text-slate-500">{scene.goal}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <Mic className="text-amber-600" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">配音</h2>
            </div>
            <div className="custom-scrollbar max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {project.voices.map((voice) => (
                <div key={voice.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-bold text-slate-900">{voice.name}</div>
                  <div className="mt-1.5 space-y-0.5 text-[10px] font-medium text-slate-400">
                    <div>厂商：{voice.provider} · {voice.gender}</div>
                    <div>段数：{voice.segmentCount} 段对白 · {voice.voiceSource}</div>
                  </div>
                  {voice.sampleAudioUrl ? <audio className="mt-3 h-8 w-full" controls src={voice.sampleAudioUrl} preload="none" /> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'qa' ? (
        <section ref={qaPanelRef} className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <RefreshCw className="animate-spin-slow text-cyan-500" size={18} />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">任务流水</h2>
            </div>
            <div className="custom-scrollbar max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {stageTasks.map((task) => {
                const status = task.error ? 'block' : (task.status as 'pass' | 'warn' | 'block' | 'running' | undefined) || 'running';
                return (
                  <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900">{humanizeQaText(task.detail || task.step)}</div>
                        <div className="mt-1 break-all font-mono text-[9px] text-slate-400">{task.step}</div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${getStatusTone(status as any)}`}>
                        {formatRunStatus(status as any)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">
                      <span>Agent: {task.agent || 'director'}</span>
                      <span>开始: {task.startedAt ? new Date(task.startedAt).toLocaleTimeString('zh-CN') : '无'}</span>
                      <span>结束: {task.finishedAt ? new Date(task.finishedAt).toLocaleTimeString('zh-CN') : '未完成'}</span>
                    </div>
                    {task.error ? <div className="mt-3 whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[10px] font-medium text-rose-600">{humanizeQaText(task.error)}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div ref={qaIssueLogRef} className="glass-card p-6">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2.5">
                  <ShieldAlert className="text-rose-500" size={18} />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">问题日志</h2>
                </div>
                <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
                  {[
                    { key: 'all', label: '全部' },
                    { key: 'warn', label: '提醒' },
                    { key: 'block', label: '阻断' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setQaFilter(item.key as 'all' | 'warn' | 'block')}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${
                        qaFilter === item.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1 custom-scrollbar">
                {qaIssueSummaries.filter((item) => qaFilter === 'all' || item.status === qaFilter).length ? (
                  qaIssueSummaries
                    .filter((item) => qaFilter === 'all' || item.status === qaFilter)
                    .map((item, index) => (
                      <QaIssueCard key={`${item.summary.agentKey || item.summary.agentName}-${index}`} item={item} />
                    ))
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-xs font-medium text-slate-400">
                    当前筛选下没有问题日志。
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card p-6">
              <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
                <Sparkles className="text-amber-600" size={18} />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">交付提醒</h2>
              </div>
              {topWarnings.length ? (
                <div className="space-y-2.5">
                  {topWarnings.map((warning, index) => (
                    <div key={index} className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs font-medium leading-relaxed text-amber-700/90">
                      {humanizeQaText(warning)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-xs font-medium text-slate-400">当前没有额外交付提醒。</div>
              )}
            </div>

            <div className="glass-card p-6">
              <div className="mb-4 flex items-center gap-2.5 border-b border-slate-200 pb-3">
                <PlayCircle className="text-emerald-500" size={18} />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">产物入口</h2>
              </div>
              <div className="space-y-2.5 text-xs">
                {project.finalVideoUrl ? (
                  <a
                    href={project.finalVideoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-slate-200 bg-white p-4 font-bold text-slate-900 transition-all duration-300 hover:border-cyan-100 hover:bg-slate-100 hover:text-cyan-500"
                  >
                    成片视频
                  </a>
                ) : null}
                {project.deliverySummaryUrl ? (
                  <a
                    href={project.deliverySummaryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-slate-200 bg-white p-4 font-bold text-slate-900 transition-all duration-300 hover:border-cyan-100 hover:bg-slate-100 hover:text-cyan-500"
                  >
                    delivery-summary.md
                  </a>
                ) : null}
                {project.artifactSummary?.runDir ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 font-mono text-[10px] font-medium leading-relaxed text-slate-400">
                    Run 目录：{project.artifactSummary.runDir}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
