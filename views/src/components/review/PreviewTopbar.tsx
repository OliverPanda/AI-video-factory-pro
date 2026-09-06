import { ArrowLeft, FolderSearch, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { RunReviewData } from '../../lib/workbench';

type PreviewTopbarProps = {
  review: RunReviewData;
  pendingCount: number;
  backTo: string;
  onRefresh: () => void;
  refreshing: boolean;
};

function statusTone(status?: string) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'approved' || normalized === 'completed' || normalized === 'pass') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized === 'blocked' || normalized === 'block' || normalized === 'failed' || normalized === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

export default function PreviewTopbar({
  review,
  pendingCount,
  backTo,
  onRefresh,
  refreshing,
}: PreviewTopbarProps) {
  return (
    <header className="border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link
              to={backTo}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft size={12} />
              返回
            </Link>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusTone(review.reviewSummary.status || review.status)}`}>
              {review.reviewSummary.status || review.status}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
              Run {review.runId}
            </span>
          </div>

          <h1 className="truncate text-xl font-bold text-slate-900">
            {review.projectTitle} / {review.episodeTitle}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>{review.scriptTitle}</span>
            <span>{review.reviewSummary.totalFindings} 个问题</span>
            <span>{pendingCount} 个待确认任务</span>
            {review.createdAt ? <span>{new Date(review.createdAt).toLocaleString('zh-CN')}</span> : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:min-w-[360px]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Repair Cost</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">
              {review.reviewSummary.estimatedRepairCost?.currency || 'USD'}
              {' '}
              {review.reviewSummary.estimatedRepairCost?.min ?? 0}
              {review.reviewSummary.estimatedRepairCost?.max ? ` - ${review.reviewSummary.estimatedRepairCost.max}` : '+'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Blocking</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{review.reviewSummary.blockingFindings}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100 disabled:opacity-50"
        >
          {refreshing ? <RefreshCw size={15} className="animate-spin" /> : <FolderSearch size={15} />}
          刷新审片
        </button>
      </div>
    </header>
  );
}
