import { useCallback, useEffect, useState } from 'react';

import {
  fetchLlmHealthCheck,
  fetchProviderSettings,
  runProviderPrecheckAll,
  saveProviderSettings,
  fetchWorkbenchOverview,
  fetchWorkbenchProject,
  fetchWorkbenchProjects,
  fetchProjectDetail,
  fetchRunReview,
  fetchRunReviewClips,
  fetchStoryboard,
  type WorkbenchProject,
  type WorkbenchProjectLocator,
  type ProjectDetailData,
  type ProviderSettingSection,
  type RunReviewData,
  type ReviewClip,
  type StoryboardPayload,
} from '../lib/workbench';

export function useWorkbenchProjects(refreshKey?: number) {
  const [projects, setProjects] = useState<WorkbenchProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);

    fetchWorkbenchProjects()
      .then((data) => {
        if (disposed) return;
        setProjects(data);
      })
      .catch((err) => {
        if (disposed) return;
        setProjects([]);
        setError(err instanceof Error ? err.message : '加载项目失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [refreshKey]);

  return { projects, loading, error };
}

export function useWorkbenchProject(projectId?: string, locator?: string | null | WorkbenchProjectLocator) {
  const [project, setProject] = useState<WorkbenchProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locatorKey = typeof locator === 'string' ? locator : JSON.stringify(locator || {});

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setError(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    setError(null);

    fetchWorkbenchProject(projectId, locator)
      .then((data) => {
        if (disposed) return;
        setProject(data);
      })
      .catch((err) => {
        if (disposed) return;
        setProject(null);
        setError(err instanceof Error ? err.message : '加载项目失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [locatorKey, projectId]);

  return { project, loading, error };
}

export function useWorkbenchOverview() {
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof fetchWorkbenchOverview>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    fetchWorkbenchOverview()
      .then((data) => {
        if (disposed) return;
        setOverview(data);
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  return { overview, loading };
}

export function useProviderSettings() {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof fetchProviderSettings>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    fetchProviderSettings()
      .then((data) => {
        if (disposed) return;
        setSettings(data);
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : '加载设置失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  return { settings, loading, error };
}

export function useProviderSettingsActions() {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [precheckError, setPrecheckError] = useState<string | null>(null);
  const [precheckResult, setPrecheckResult] = useState<Awaited<ReturnType<typeof runProviderPrecheckAll>> | null>(null);

  const save = useCallback(async (sections: ProviderSettingSection[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      return await saveProviderSettings(sections);
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存配置失败';
      setSaveError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const runAllChecks = useCallback(async () => {
    setCheckingAll(true);
    setPrecheckError(null);
    try {
      const result = await runProviderPrecheckAll();
      setPrecheckResult(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : '批量预检失败';
      setPrecheckError(message);
      throw err;
    } finally {
      setCheckingAll(false);
    }
  }, []);

  return {
    save,
    saving,
    saveError,
    runAllChecks,
    checkingAll,
    precheckResult,
    precheckError,
    setPrecheckResult,
  };
}

export function useLlmHealthCheck(params?: {
  projectId?: string;
  scriptId?: string;
  episodeId?: string;
  enabled?: boolean;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof fetchLlmHealthCheck>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (params?.enabled === false) return null;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLlmHealthCheck({
        projectId: params?.projectId,
        scriptId: params?.scriptId,
        episodeId: params?.episodeId,
      });
      setResult(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : '健康检查失败';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [params?.enabled, params?.episodeId, params?.projectId, params?.scriptId]);

  return { result, loading, error, run, setResult };
}

export function useProjectDetail(projectId?: string, refreshKey?: number) {
  const [project, setProject] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setError(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    setError(null);

    fetchProjectDetail(projectId)
      .then((data) => {
        if (disposed) return;
        setProject(data);
      })
      .catch((err) => {
        if (disposed) return;
        setProject(null);
        setError(err instanceof Error ? err.message : '加载项目详情失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [projectId, refreshKey]);

  return { project, loading, error };
}

export function useRunReview(runId?: string, refreshKey?: number) {
  const [review, setReview] = useState<RunReviewData | null>(null);
  const [clips, setClips] = useState<ReviewClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setReview(null);
      setClips([]);
      setError(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchRunReview(runId), fetchRunReviewClips(runId)])
      .then(([reviewData, clipData]) => {
        if (disposed) return;
        setReview(reviewData);
        setClips(clipData);
      })
      .catch((err) => {
        if (disposed) return;
        setReview(null);
        setClips([]);
        setError(err instanceof Error ? err.message : '加载审片数据失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [refreshKey, runId]);

  return { review, clips, loading, error, setReview, setClips };
}

export function useStoryboardData(projectId?: string, scriptId?: string, episodeId?: string, runId?: string | null, refreshKey?: number) {
  const [storyboard, setStoryboard] = useState<StoryboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !scriptId || !episodeId) {
      setStoryboard(null);
      setError(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    setError(null);

    fetchStoryboard(projectId, scriptId, episodeId, runId)
      .then((data) => {
        if (disposed) return;
        setStoryboard(data);
      })
      .catch((err) => {
        if (disposed) return;
        setStoryboard(null);
        setError(err instanceof Error ? err.message : '加载分镜失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [episodeId, projectId, refreshKey, runId, scriptId]);

  return { storyboard, loading, error, setStoryboard };
}
