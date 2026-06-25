import { ChevronUp, Loader2 } from 'lucide-react';

import type { ReviewTask, ReviewTaskStatus } from '../../lib/workbench';

type EditTaskDrawerProps = {
  open: boolean;
  tasks: ReviewTask[];
  activeTaskId: string | null;
  pendingTaskId: string | null;
  onToggle: () => void;
  onSelectTarget: (task: ReviewTask) => void;
  onAction: (task: ReviewTask, status: ReviewTaskStatus) => void;
};

const ACTIONS: Array<{ key: ReviewTaskStatus; label: string; tone: string }> = [
  { key: 'approved', label: 'Approve', tone: 'bg-emerald-600 text-white' },
  { key: 'skipped', label: 'Skip', tone: 'bg-slate-900 text-white' },
  { key: 'manual_review', label: 'Manual Review', tone: 'bg-amber-500 text-slate-900' },
];

export default function EditTaskDrawer({
  open,
  tasks,
  activeTaskId,
  pendingTaskId,
  onToggle,
  onSelectTarget,
  onAction,
}: EditTaskDrawerProps) {
  return (
    <section className={`border-t border-slate-200 bg-white transition-[height] duration-300 ${open ? 'h-[280px]' : 'h-[58px]'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-[58px] w-full items-center justify-between px-6"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">任务抽屉</div>
          <div className="mt-0.5 text-xs text-slate-500">{tasks.length} 个任务</div>
        </div>
        <ChevronUp size={18} className={`text-slate-400 transition ${open ? '' : 'rotate-180'}`} />
      </button>

      {open ? (
        <div className="custom-scrollbar h-[222px] overflow-y-auto px-6 pb-5">
          <div className="space-y-3">
            {tasks.map((task) => (
              <article
                key={task.id}
                className={`rounded-2xl border p-4 transition ${
                  activeTaskId === task.id ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{task.action}</div>
                    <div className="mt-1 text-xs text-slate-500">{task.id} · {task.targetRef.type}:{task.targetRef.id}</div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {task.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{task.reason}</p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectTarget(task)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                  >
                    定位片段
                  </button>
                  {ACTIONS.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => onAction(task, action.key)}
                      disabled={pendingTaskId === task.id}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${action.tone}`}
                    >
                      {pendingTaskId === task.id && action.key === task.status ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" />
                          已写回
                        </span>
                      ) : (
                        action.label
                      )}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
