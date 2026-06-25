import { Search } from 'lucide-react';

import type { ReviewClip } from '../../lib/workbench';

export type ReviewFilterMode = 'all' | 'shot' | 'sequence' | 'bridge' | 'audio' | 'blocked' | 'warn';

type TimelineNavigatorProps = {
  clips: ReviewClip[];
  selectedClipId: string | null;
  filterMode: ReviewFilterMode;
  searchQuery: string;
  onFilterChange: (value: ReviewFilterMode) => void;
  onSearchChange: (value: string) => void;
  onSelectClip: (clipId: string) => void;
};

const FILTERS: Array<{ key: ReviewFilterMode; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'shot', label: 'Shot' },
  { key: 'sequence', label: 'Sequence' },
  { key: 'bridge', label: 'Bridge' },
  { key: 'audio', label: 'Audio' },
  { key: 'blocked', label: '阻断' },
  { key: 'warn', label: '提醒' },
];

function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TimelineNavigator({
  clips,
  selectedClipId,
  filterMode,
  searchQuery,
  onFilterChange,
  onSearchChange,
  onSelectClip,
}: TimelineNavigatorProps) {
  return (
    <aside className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索片段 / ID"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => onFilterChange(filter.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                filterMode === filter.key
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-4">
        {clips.map((clip) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => onSelectClip(clip.id)}
            className={`w-full rounded-2xl border p-3 text-left transition ${
              selectedClipId === clip.id
                ? 'border-cyan-300 bg-cyan-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{clip.label}</div>
                <div className="mt-1 text-[11px] text-slate-400">{clip.id}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                clip.riskLevel === 'blocker'
                  ? 'bg-rose-50 text-rose-600'
                  : clip.riskLevel === 'warn'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-500'
              }`}>
                {clip.kind}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>{formatMs(clip.startMs)} - {formatMs(clip.endMs)}</span>
              <span>{Math.round(clip.durationMs / 1000)}s</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
