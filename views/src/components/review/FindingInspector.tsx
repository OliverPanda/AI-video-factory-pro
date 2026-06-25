import { AlertTriangle, CheckCircle2, ClipboardList } from 'lucide-react';

import type { ReviewClip, ReviewFinding, ReviewTask } from '../../lib/workbench';

type FindingInspectorProps = {
  selectedClip: ReviewClip | null;
  findings: ReviewFinding[];
  tasks: ReviewTask[];
  onOpenTaskDrawer: () => void;
};

export default function FindingInspector({
  selectedClip,
  findings,
  tasks,
  onOpenTaskDrawer,
}: FindingInspectorProps) {
  const clipFindings = selectedClip
    ? findings.filter((finding) => finding.targetRef.id === selectedClip.targetRef.id || finding.targetRef.id === selectedClip.id)
    : findings;
  const clipTasks = selectedClip
    ? tasks.filter((task) => task.targetRef.id === selectedClip.targetRef.id || task.targetRef.id === selectedClip.id)
    : tasks;

  return (
    <aside className="flex h-full flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="text-sm font-semibold text-slate-900">问题分析</div>
        <div className="mt-1 text-xs text-slate-500">
          {selectedClip ? `${selectedClip.label} · ${clipFindings.length} 条 finding` : '选择左侧片段查看详情'}
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
        {clipFindings.length ? clipFindings.map((finding) => (
          <article key={finding.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                finding.severity === 'blocker' || finding.severity === 'high'
                  ? 'bg-rose-50 text-rose-600'
                  : finding.severity === 'warn'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-200 text-slate-600'
              }`}>
                {finding.severity}
              </span>
              <span className="text-[10px] text-slate-400">{finding.category}</span>
            </div>
            <p className="text-sm leading-6 text-slate-700">{finding.message}</p>
            {finding.evidenceRefs.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {finding.evidenceRefs.map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
            当前片段没有额外 finding。
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
            <ClipboardList size={14} />
            关联任务
          </div>
          <button
            type="button"
            onClick={onOpenTaskDrawer}
            className="text-xs font-semibold text-cyan-700 transition hover:text-cyan-500"
          >
            打开抽屉
          </button>
        </div>
        <div className="space-y-2">
          {clipTasks.slice(0, 3).map((task) => (
            <div key={task.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold text-slate-900">{task.action}</div>
              <div className="mt-1 flex items-center gap-2">
                {task.status === 'approved' ? (
                  <CheckCircle2 size={13} className="text-emerald-500" />
                ) : (
                  <AlertTriangle size={13} className="text-amber-500" />
                )}
                <span>{task.status}</span>
              </div>
            </div>
          ))}
          {!clipTasks.length ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
              当前片段没有任务。
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
