import { useEffect, useState } from 'react';

import {
  fetchProviderSettings,
  fetchWorkbenchOverview,
  fetchWorkbenchProject,
  fetchWorkbenchProjects,
  type WorkbenchProject,
} from '../lib/workbench';

export function useWorkbenchProjects() {
  const [projects, setProjects] = useState<WorkbenchProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    fetchWorkbenchProjects()
      .then((data) => {
        if (disposed) return;
        setProjects(data);
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : '加载项目失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  return { projects, loading, error };
}

export function useWorkbenchProject(projectId?: string, runId?: string | null) {
  const [project, setProject] = useState<WorkbenchProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    setError(null);

    fetchWorkbenchProject(projectId, runId)
      .then((data) => {
        if (disposed) return;
        setProject(data);
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : '加载项目失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [projectId, runId]);

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
