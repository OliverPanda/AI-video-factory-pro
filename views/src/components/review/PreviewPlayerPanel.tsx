import type { RefObject } from 'react';
import { AlertTriangle, Film } from 'lucide-react';

import type { ReviewClip, RunReviewData } from '../../lib/workbench';
import { buildPreviewPlayerErrorState } from './PreviewPlayerPanelState';

type PreviewPlayerPanelProps = {
  review: RunReviewData;
  clips: ReviewClip[];
  selectedClip: ReviewClip | null;
  currentTimeMs: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string | null;
  videoError: string | null;
  onTimeChange: (timeMs: number) => void;
  onVideoError: () => void;
};

function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function PreviewPlayerPanel({
  review,
  clips,
  selectedClip,
  currentTimeMs,
  videoRef,
  videoSrc,
  videoError,
  onTimeChange,
  onVideoError,
}: PreviewPlayerPanelProps) {
  const totalDurationMs = Math.max(...clips.map((clip) => clip.endMs), 0);
  const errorState = buildPreviewPlayerErrorState(review, videoError);

  return (
    <section className="flex h-full flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">成片预览</div>
            <div className="mt-1 text-xs text-slate-500">
              当前片段：{selectedClip?.label || '未选择'} / {formatMs(currentTimeMs)}
            </div>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
            {review.runId}
          </span>
        </div>
      </div>

      <div className="flex-1 p-5">
        <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white">
          <div className="flex flex-1 items-center justify-center bg-slate-950">
            {videoSrc && !videoError ? (
              <video
                ref={videoRef}
                controls
                preload="metadata"
                src={videoSrc}
                onTimeUpdate={(event) => onTimeChange(event.currentTarget.currentTime * 1000)}
                onError={onVideoError}
                className="h-full w-full bg-black object-contain"
              />
            ) : videoError ? (
              <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center text-slate-300">
                <AlertTriangle size={36} />
                <div className="text-sm font-medium text-slate-100">{errorState.message}</div>
                {errorState.detail ? (
                  <div className="text-xs text-slate-400">{errorState.detail}</div>
                ) : null}
                {errorState.artifactHref ? (
                  <a
                    href={errorState.artifactHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400 hover:text-cyan-100"
                  >
                    {errorState.artifactLabel}
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center text-slate-300">
                <Film size={36} />
                <div className="text-sm font-medium text-slate-100">当前 run 暂无可预览的成片视频</div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Film size={13} />
              风险时间线
            </div>
            <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
              {clips.map((clip) => {
                const width = totalDurationMs > 0 ? `${Math.max(2, (clip.durationMs / totalDurationMs) * 100)}%` : '0%';
                const tone =
                  clip.riskLevel === 'blocker'
                    ? 'bg-rose-400'
                    : clip.riskLevel === 'warn'
                      ? 'bg-amber-400'
                      : 'bg-cyan-300';
                return <div key={clip.id} title={clip.label} className={tone} style={{ width }} />;
              })}
            </div>
            {selectedClip ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="font-semibold text-slate-900">{selectedClip.label}</div>
                <div className="mt-1">{selectedClip.id} · {formatMs(selectedClip.startMs)} - {formatMs(selectedClip.endMs)}</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
