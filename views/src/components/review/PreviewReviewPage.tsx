import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { useRunReview } from '../../hooks/useWorkbench';
import {
  getRunReviewVideoUrl,
  updateRunReviewTask,
  type ReviewTask,
  type ReviewTaskStatus,
} from '../../lib/workbench';
import { useToast } from '../ToastContext';
import EditTaskDrawer from './EditTaskDrawer';
import FindingInspector from './FindingInspector';
import PreviewPlayerPanel from './PreviewPlayerPanel';
import PreviewTopbar from './PreviewTopbar';
import { resolveSelectedClipId } from './reviewSelection';
import TimelineNavigator, { type ReviewFilterMode } from './TimelineNavigator';

function buildBackLink(projectId?: string | null, episodeId?: string | null, scriptId?: string | null, runId?: string | null) {
  if (!projectId) return '/projects';
  if (!episodeId) return `/project/${projectId}`;
  const query = new URLSearchParams();
  query.set('episode', episodeId);
  if (scriptId) query.set('script', scriptId);
  if (runId) query.set('run', runId);
  return `/drama/${projectId}?${query.toString()}`;
}

export default function PreviewReviewPage() {
  const { runId } = useParams();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const { review, clips, loading, error, setReview } = useRunReview(runId, refreshKey);
  const refresh = () => setRefreshKey((value) => value + 1);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<ReviewFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(runId ? getRunReviewVideoUrl(runId) : null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (runId) {
      setVideoSrc(getRunReviewVideoUrl(runId));
      setVideoError(null);
    }
  }, [runId, refreshKey]);

  const filteredClips = useMemo(() => {
    return clips.filter((clip) => {
      if (filterMode === 'shot' || filterMode === 'sequence' || filterMode === 'bridge' || filterMode === 'audio') {
        if (clip.kind !== filterMode) return false;
      }
      if (filterMode === 'blocked' && clip.riskLevel !== 'blocker') return false;
      if (filterMode === 'warn' && clip.riskLevel !== 'warn') return false;
      if (searchQuery.trim()) {
        const haystack = `${clip.id} ${clip.label}`.toLowerCase();
        if (!haystack.includes(searchQuery.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [clips, filterMode, searchQuery]);

  const selectedClip = useMemo(
    () => filteredClips.find((clip) => clip.id === selectedClipId) || clips.find((clip) => clip.id === selectedClipId) || null,
    [clips, filteredClips, selectedClipId]
  );

  useEffect(() => {
    const nextSelectedClipId = resolveSelectedClipId(filteredClips, selectedClipId);
    if (nextSelectedClipId !== selectedClipId) {
      setSelectedClipId(nextSelectedClipId);
    }
  }, [filteredClips, selectedClipId]);

  useEffect(() => {
    const currentClip = clips.find((clip) => currentTimeMs >= clip.startMs && currentTimeMs < clip.endMs);
    if (currentClip && currentClip.id !== selectedClipId) {
      setSelectedClipId(currentClip.id);
    }
  }, [clips, currentTimeMs, selectedClipId]);

  const pendingCount = useMemo(
    () => review?.tasks.filter((task) => task.status === 'pending_approval' || task.status === 'manual_review').length || 0,
    [review?.tasks]
  );

  const handleSelectClip = (clipId: string) => {
    const clip = clips.find((item) => item.id === clipId);
    setSelectedClipId(clipId);
    if (clip && videoRef.current) {
      videoRef.current.currentTime = clip.startMs / 1000;
      void videoRef.current.play().catch(() => undefined);
    }
  };

  const handleVideoError = () => {
    setVideoError('无法加载成片视频');
  };

  const updateLocalTask = (taskId: string, status: ReviewTaskStatus) => {
    setReview((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        tasks: previous.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
      };
    });
  };

  const handleTaskAction = async (task: ReviewTask, status: ReviewTaskStatus) => {
    if (!runId) return;
    const previousStatus = task.status;
    setPendingTaskId(task.id);
    updateLocalTask(task.id, status);
    try {
      await updateRunReviewTask(runId, task.id, status);
      toast('审片任务已写回', 'success');
      refresh();
    } catch (mutationError) {
      updateLocalTask(task.id, previousStatus);
      toast(mutationError instanceof Error ? mutationError.message : '任务写回失败', 'error');
    } finally {
      setPendingTaskId(null);
    }
  };

  const handleSelectTaskTarget = (task: ReviewTask) => {
    const clip = clips.find((item) => item.targetRef.id === task.targetRef.id);
    if (clip) {
      handleSelectClip(clip.id);
    }
  };

  if (loading && !review) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (!review) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded-2xl border border-rose-200 bg-white px-6 py-5 text-sm text-rose-600">
          审片数据加载失败{error ? `：${error}` : ''}。
        </div>
      </div>
    );
  }

  const backTo = buildBackLink(
    searchParams.get('projectId') || review.projectId,
    searchParams.get('episodeId') || review.episodeId,
    searchParams.get('scriptId') || review.scriptId,
    searchParams.get('runId') || review.runId
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PreviewTopbar
        review={review}
        pendingCount={pendingCount}
        backTo={backTo}
        onRefresh={refresh}
        refreshing={loading}
      />

      {error ? (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-700">
          {error}
        </div>
      ) : null}

      <div className="grid flex-1 grid-cols-[320px,1fr,360px] overflow-hidden">
        <TimelineNavigator
          clips={filteredClips}
          selectedClipId={selectedClipId}
          filterMode={filterMode}
          searchQuery={searchQuery}
          onFilterChange={setFilterMode}
          onSearchChange={setSearchQuery}
          onSelectClip={handleSelectClip}
        />
        <PreviewPlayerPanel
          review={review}
          clips={clips}
          selectedClip={selectedClip}
          currentTimeMs={currentTimeMs}
          videoRef={videoRef}
          videoSrc={videoSrc}
          videoError={videoError}
          onTimeChange={setCurrentTimeMs}
          onVideoError={handleVideoError}
        />
        <FindingInspector
          selectedClip={selectedClip}
          findings={review.findings}
          tasks={review.tasks}
          onOpenTaskDrawer={() => setDrawerOpen(true)}
        />
      </div>

      <EditTaskDrawer
        open={drawerOpen}
        tasks={review.tasks}
        activeTaskId={review.tasks.find((task) => task.targetRef.id === selectedClip?.targetRef.id)?.id || null}
        pendingTaskId={pendingTaskId}
        onToggle={() => setDrawerOpen((value) => !value)}
        onSelectTarget={handleSelectTaskTarget}
        onAction={handleTaskAction}
      />
    </div>
  );
}
