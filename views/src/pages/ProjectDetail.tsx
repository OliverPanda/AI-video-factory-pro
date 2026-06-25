import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Film,
  Layers,
  Play,
  AlertCircle,
  Loader2,
  Sparkles,
  Hash,
  Pencil,
  Trash2,
  ImageIcon,
  X,
  FileText,
  Upload,
  Eye,
  Save,
  FilePlus,
  BookOpen,
  User,
  RefreshCw,
} from 'lucide-react';

import { useProjectDetail, useWorkbenchProject } from '../hooks/useWorkbench';
import {
  updateProjectApi,
  deleteProjectApi,
  fetchScripts,
  fetchScriptDetail,
  uploadScript,
  professionalizeScript,
  updateScript,
  deleteScript,
  triggerRun,
  clearRequestCache,
  isRunReviewable,
  subscribeToRunStream,
  isRunTerminal,
  type ScriptEntry,
  type RunMode,
  type RunStreamSubscription,
} from '../lib/workbench';
import { StylePicker, StyleBadge, GENRE_OPTIONS, RATIO_OPTIONS } from '../components/StylePresets';

const PROFESSIONAL_SCRIPT_EXAMPLE = `【画面1】
场景：周凛的智能公寓客厅，夜晚。
人物：周凛。
动作：周凛用平板电脑尝试打开客厅灯光，灯闪烁一下后熄灭。他皱眉，又尝试启动空调，空调发出故障提示音。
对白：周凛（压着怒火）：这套系统到底还能不能用？
时长：6秒

【画面2】
场景：同一客厅，酒柜旁。
人物：周凛。
动作：智能窗帘卡在半空，智能音箱毫无反应。周凛松开领带，拿出手机拨给物业。
对白：周凛（冰冷）：我每年交的智能系统维护费，是让你们用来听响的吗？
时长：8秒

【画面3】
场景：客厅沙发区，手机冷光映在周凛脸上。
人物：周凛、物业客服（电话声）。
动作：周凛挂断电话，环顾漆黑失控的房间，疲惫地坐进沙发。
对白：物业客服（电话）：周先生，我们立刻派最好的电工上门，他姓向，半小时后到。
时长：7秒`;

const statusConfig: Record<string, { label: string; tone: string; dot: string }> = {
  pass:    { label: '已完成', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  warn:    { label: '需复核', tone: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  block:   { label: '已阻断', tone: 'border-rose-200 bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  running: { label: '运行中', tone: 'border-cyan-200 bg-cyan-50 text-cyan-700', dot: 'bg-cyan-500' },
};

function getStatus(status?: string) {
  const s = (status || '').toLowerCase();
  if (['pass', 'completed', 'cached', 'success'].includes(s)) return statusConfig.pass;
  if (['warn', 'warning'].includes(s)) return statusConfig.warn;
  if (['block', 'blocked', 'failed', 'error'].includes(s)) return statusConfig.block;
  return statusConfig.running;
}

function formatDate(iso?: string) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getScriptParseState(script: ScriptEntry) {
  if (script.parseOk === true && Number(script.shotCount || 0) > 0) {
    return {
      runnable: true,
      label: `${Number(script.shotCount || 0)} 镜头`,
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      message: '',
    };
  }
  if (script.parseError) {
    return {
      runnable: false,
      label: '解析失败',
      tone: 'border-rose-200 bg-rose-50 text-rose-700',
      message: script.parseError,
    };
  }
  return {
    runnable: false,
    label: '未解析',
    tone: 'border-slate-200 bg-slate-50 text-slate-500',
    message: '剧本尚未解析出可运行分镜，请先编辑或使用一键优化。',
  };
}

function ScriptManager({
  projectId,
  onUploadSuccess,
  onRunStateChange,
}: {
  projectId: string;
  onUploadSuccess?: () => void;
  onRunStateChange?: (polling: boolean) => void;
}) {
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [optimizingScript, setOptimizingScript] = useState(false);
  const [previewScript, setPreviewScript] = useState<{ title: string; content: string } | null>(null);
  const [editingScript, setEditingScript] = useState<{ id: string; title: string; content: string } | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [optimizingEditScript, setOptimizingEditScript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);
  const [runModeScriptId, setRunModeScriptId] = useState<string | null>(null);
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const runModeRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Stable refs for callbacks to avoid re-subscribing SSE on every render
  const onUploadSuccessRef = useRef(onUploadSuccess);
  onUploadSuccessRef.current = onUploadSuccess;
  const onRunStateChangeRef = useRef(onRunStateChange);
  onRunStateChangeRef.current = onRunStateChange;

  useEffect(() => {
    if (!runModeScriptId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (runModeRef.current && !runModeRef.current.contains(e.target as Node)) {
        setRunModeScriptId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [runModeScriptId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchScripts(projectId);
      setScripts(data);
      return data;
    } catch (err) {
      setScripts([]);
      setError(err instanceof Error ? err.message : '加载剧本失败');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadTitle(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = () => setUploadContent(reader.result as string);
    reader.readAsText(file);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle.trim() || !uploadContent.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await uploadScript(projectId, uploadTitle.trim(), uploadContent);
      setShowUpload(false);
      setUploadTitle('');
      setUploadContent('');
      clearRequestCache('/api/projects');
      await reload().catch(() => undefined);
      onUploadSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleProfessionalizeScript = async () => {
    if (!uploadContent.trim()) {
      setError('请先输入需要优化的剧本内容');
      return;
    }
    setOptimizingScript(true);
    setError(null);
    try {
      const result = await professionalizeScript(uploadTitle.trim() || '未命名剧本', uploadContent);
      setUploadContent(result.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一键优化失败');
    } finally {
      setOptimizingScript(false);
    }
  };

  const openPreview = async (entry: ScriptEntry) => {
    try {
      const detail = await fetchScriptDetail(projectId, entry.id);
      setPreviewScript({ title: detail.title, content: detail.content });
    } catch {
      setPreviewScript({ title: entry.title, content: '（加载失败）' });
    }
  };

  const openEdit = async (entry: ScriptEntry) => {
    try {
      const detail = await fetchScriptDetail(projectId, entry.id);
      setEditingScript({ id: entry.id, title: detail.title, content: detail.content });
      setEditTitle(detail.title);
      setEditContent(detail.content);
    } catch { /* ignore */ }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingScript || !editTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateScript(projectId, editingScript.id, { title: editTitle.trim(), content: editContent });
      setEditingScript(null);
      await reload().catch(() => undefined);
      onUploadSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleProfessionalizeEditScript = async () => {
    if (!editContent.trim()) {
      setError('请先输入需要优化的剧本内容');
      return;
    }
    setOptimizingEditScript(true);
    setError(null);
    try {
      const result = await professionalizeScript(editTitle.trim() || '未命名剧本', editContent);
      setEditContent(result.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一键优化失败');
    } finally {
      setOptimizingEditScript(false);
    }
  };

  const handleDelete = async (entry: ScriptEntry) => {
    if (!confirm(`确认删除剧本「${entry.title}」？此操作不可恢复。`)) return;
    try {
      await deleteScript(projectId, entry.id);
      await reload().catch(() => undefined);
      onUploadSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleRun = async (entry: ScriptEntry, mode: RunMode = { kind: 'stop', stopAt: 'full' }) => {
    const parseState = getScriptParseState(entry);
    if (!parseState.runnable) {
      setRunModeScriptId(null);
      setError(parseState.message || '剧本解析失败，请先编辑剧本或使用一键优化。');
      return;
    }
    let modeLabel = '完整运行';
    if (mode.kind === 'continue') {
      modeLabel = mode.stopAt === 'before_video' ? '根据现有进度继续运行到生视频前' : '根据现有进度继续运行';
    } else if (mode.kind === 'retry') {
      modeLabel = '清理上次阻断产物并重新运行';
    } else if (mode.stopAt === 'after_ref_sheets') {
      modeLabel = '生成角色三视图后';
    } else if (mode.stopAt === 'after_images') {
      modeLabel = '生成角色/场景图后';
    } else if (mode.stopAt === 'before_video') {
      modeLabel = '生视频前';
    }
    if (!confirm(`确认「${modeLabel}」剧本「${entry.title}」？`)) return;
    setRunningScriptId(entry.id);
    setRunModeScriptId(null);
    setError(null);
    try {
      const episodeId = entry.episodeId;
      if (!episodeId) {
        throw new Error('剧本尚未绑定真实分集，当前不能发起运行。请先确认上传/解析结果。');
      }
      const result = await triggerRun(projectId, entry.id, episodeId, { mode });
      const runId = (result as { runId?: string })?.runId;
      if (runId) {
        setPollingRunId(runId);
        onRunStateChange?.(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '运行失败';
      if (message.includes('Episode not found')) {
        setError('剧本对应的分集不存在，请重新上传剧本');
      } else {
        setError(message);
      }
    } finally {
      setRunningScriptId(null);
    }
  };

  // SSE-based run status subscription (replaces interval polling)
  // Uses refs for callbacks to avoid re-subscribing on every render
  useEffect(() => {
    if (!pollingRunId) return;

    const subscription: RunStreamSubscription = subscribeToRunStream(pollingRunId, {
      onStatus(data) {
        if (isRunTerminal(data.status)) {
          setPollingRunId(null);
          onRunStateChangeRef.current?.(false);
          clearRequestCache('/api/projects');
          onUploadSuccessRef.current?.();
        }
      },
      onDone() {
        setPollingRunId(null);
        onRunStateChangeRef.current?.(false);
        clearRequestCache('/api/projects');
        onUploadSuccessRef.current?.();
      },
      onConnectionError() {
        // On SSE failure, fall back: just stop and let user refresh manually
        setPollingRunId(null);
        onRunStateChangeRef.current?.(false);
      },
    });

    return () => subscription.close();
  }, [pollingRunId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <FileText size={16} className="text-slate-400" />
          <h2 className="text-sm font-bold text-slate-900 tracking-wide">剧本管理</h2>
          <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            {scripts.length} 份
          </span>
        </div>
        <button
          onClick={() => { setUploadTitle(''); setUploadContent(''); setError(null); setShowUpload(true); }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 transition-all"
        >
          <FilePlus size={13} />
          上传剧本
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="glass-card p-8 text-center">
          <Loader2 size={24} className="animate-spin text-cyan-500 mx-auto" />
        </div>
      ) : scripts.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Upload className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="text-sm font-semibold text-slate-500 mb-1">暂无剧本</p>
          <p className="text-xs text-slate-400">上传 .txt 文件或直接粘贴剧本文本</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.map((s) => (
            <div key={s.id} className="glass-card p-4 flex items-start justify-between gap-4 group hover:border-cyan-200 transition-all">
              <div className="min-w-0 flex-1">
                {(() => {
                  const parseState = getScriptParseState(s);
                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 truncate text-sm font-bold text-slate-900">{s.title}</h3>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${parseState.tone}`}>
                          {parseState.label}
                        </span>
                      </div>
                      {!parseState.runnable && parseState.message ? (
                        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-medium leading-5 text-rose-600">
                          {parseState.message}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-400 font-medium">
                  <span>{s.charCount.toLocaleString()} 字</span>
                  <span>上传于 {new Date(s.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {s.updatedAt !== s.createdAt && (
                    <span>· 编辑于 {new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="relative" ref={runModeScriptId === s.id ? runModeRef : undefined}>
                  <button
                    onClick={() => setRunModeScriptId(runModeScriptId === s.id ? null : s.id)}
                    disabled={runningScriptId === s.id || !getScriptParseState(s).runnable}
                    className="rounded-lg p-2 text-cyan-500 hover:bg-cyan-50 hover:text-cyan-600 transition-colors disabled:opacity-50"
                    title={getScriptParseState(s).runnable ? '运行这一集' : '剧本解析失败，暂不可运行'}
                  >
                    {runningScriptId === s.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                  </button>
                  {runModeScriptId === s.id && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                      {[
                        { label: '完整运行', icon: <Play size={12} className="text-cyan-500" />, mode: { kind: 'stop' as const, stopAt: 'full' as const } },
                        { label: '生成角色三视图后', icon: <User size={12} className="text-pink-500" />, mode: { kind: 'stop' as const, stopAt: 'after_ref_sheets' as const } },
                        { label: '生成角色/场景图后', icon: <ImageIcon size={12} className="text-amber-500" />, mode: { kind: 'stop' as const, stopAt: 'after_images' as const } },
                        { label: '生视频前', icon: <Film size={12} className="text-violet-500" />, mode: { kind: 'stop' as const, stopAt: 'before_video' as const } },
                        { label: '根据现有进度继续运行', icon: <RefreshCw size={12} className="text-emerald-500" />, mode: { kind: 'continue' as const } },
                        { label: '继续运行到生视频前', icon: <RefreshCw size={12} className="text-blue-500" />, mode: { kind: 'continue' as const, stopAt: 'before_video' as const } },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={() => handleRun(s, item.mode)}
                          className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => openPreview(s)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-cyan-600 transition-colors" title="预览">
                  <Eye size={15} />
                </button>
                <button onClick={() => openEdit(s)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-cyan-600 transition-colors" title="编辑">
                  <Pencil size={15} />
                </button>
                <button onClick={() => handleDelete(s)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors" title="删除">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 font-heading">上传剧本</h2>
              <button onClick={() => setShowUpload(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleUpload}>
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">剧本标题 *</label>
                <input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="例：第一集 命运的邂逅" autoFocus className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all" />
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">导入 .txt 文件</label>
                <input ref={fileRef} type="file" accept=".txt,.md" onChange={handleFileSelect} className="w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-cyan-700 hover:file:bg-cyan-100 file:cursor-pointer" />
              </div>
              <div className="mb-5">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <label className="block text-xs font-semibold text-slate-600">剧本内容 *</label>
                    <div className="group relative">
                      <button
                        type="button"
                        className="flex h-4 w-4 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-[10px] font-bold text-amber-700"
                        aria-label="专业剧本格式提示"
                      >
                        ?
                      </button>
                      <div className="pointer-events-none absolute left-0 top-5 z-50 hidden w-72 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-5 text-amber-800 shadow-lg group-hover:block">
                        默认按专业剧本解析，请使用【画面1】、【画面2】分段，并写清场景、人物、动作、对白、时长。
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleProfessionalizeScript}
                      disabled={!uploadContent.trim() || optimizingScript}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {optimizingScript ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      一键优化
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadTitle((current) => current || 'S1E1：精英的困境');
                        setUploadContent(PROFESSIONAL_SCRIPT_EXAMPLE);
                      }}
                      className="rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[10px] font-bold text-cyan-700 transition hover:bg-cyan-100"
                    >
                      填入专业剧本示例
                    </button>
                  </div>
                </div>
                <textarea value={uploadContent} onChange={(e) => setUploadContent(e.target.value)} placeholder={PROFESSIONAL_SCRIPT_EXAMPLE} rows={14} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all resize-y font-mono leading-relaxed" />
                {uploadContent && <p className="mt-1 text-[10px] text-slate-400 font-medium">{uploadContent.length} 字</p>}
              </div>
              {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={() => setShowUpload(false)} disabled={uploading} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">取消</button>
                <button type="submit" disabled={!uploadTitle.trim() || !uploadContent.trim() || uploading} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-cyan-500/20 hover:shadow-cyan-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={14} />}
                  {uploading ? '上传中…' : '上传剧本'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPreviewScript(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-cyan-500" />
                <h2 className="text-lg font-bold text-slate-900 font-heading">{previewScript.title}</h2>
              </div>
              <button onClick={() => setPreviewScript(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
              <pre className="text-sm text-slate-800 whitespace-pre-wrap font-mono leading-relaxed">{previewScript.content}</pre>
            </div>
            <div className="mt-3 text-right text-[10px] text-slate-400 font-medium shrink-0">{previewScript.content.length} 字</div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingScript(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Pencil size={16} className="text-cyan-500" />
                <h2 className="text-lg font-bold text-slate-900 font-heading">编辑剧本</h2>
              </div>
              <button onClick={() => setEditingScript(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveEdit} className="flex-1 flex flex-col min-h-0">
              <div className="mb-4 shrink-0">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">剧本标题</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all" />
              </div>
              <div className="mb-4 flex-1 flex flex-col min-h-0">
                <div className="mb-1.5 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <label className="block text-xs font-semibold text-slate-600">剧本内容</label>
                    <div className="group relative">
                      <button
                        type="button"
                        className="flex h-4 w-4 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-[10px] font-bold text-amber-700"
                        aria-label="专业剧本格式提示"
                      >
                        ?
                      </button>
                      <div className="pointer-events-none absolute left-0 top-5 z-50 hidden w-72 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-5 text-amber-800 shadow-lg group-hover:block">
                        默认按专业剧本解析，请使用【画面1】、【画面2】分段，并写清场景、人物、动作、对白、时长。
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleProfessionalizeEditScript}
                    disabled={!editContent.trim() || optimizingEditScript}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {optimizingEditScript ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    一键优化
                  </button>
                </div>
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={16} className="flex-1 min-h-[200px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all resize-y font-mono leading-relaxed" />
                <p className="mt-1 text-[10px] text-slate-400 font-medium shrink-0">{editContent.length} 字</p>
              </div>
              {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 shrink-0">{error}</div>}
              <div className="flex items-center justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setEditingScript(null)} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">取消</button>
                <button type="submit" disabled={!editTitle.trim() || saving} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-cyan-500/20 hover:shadow-cyan-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={14} />}
                  {saving ? '保存中…' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const [runPolling, setRunPolling] = useState(false);
  const { project, loading, error } = useProjectDetail(projectId, refreshKey);
  const { project: fullProject } = useWorkbenchProject(projectId);
  const characters = fullProject?.characters || [];

  const handleUploadSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const handleRunStateChange = useCallback((polling: boolean) => {
    setRunPolling(polling);
  }, []);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editStyle, setEditStyle] = useState('');
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [editAspectRatio, setEditAspectRatio] = useState('9:16');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const openEditModal = useCallback(() => {
    if (!project) return;
    setEditTitle(project.title);
    setEditDescription(project.description || '');
    setEditGenre(project.genre || '');
    setEditStyle(project.style || '');
    setEditCoverUrl(project.coverUrl || '');
    setEditAspectRatio(project.aspectRatio || '9:16');
    setActionError(null);
    setShowEditModal(true);
  }, [project]);

  const handleEditSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !editTitle.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await updateProjectApi(projectId, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        genre: editGenre || undefined,
        style: editStyle || undefined,
        coverUrl: editCoverUrl.trim() || undefined,
        aspectRatio: editAspectRatio,
      });
      setShowEditModal(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSubmitting(false);
    }
  }, [projectId, editTitle, editDescription, editGenre, editStyle, editCoverUrl, editAspectRatio]);

  const handleDelete = useCallback(async () => {
    if (!projectId) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await deleteProjectApi(projectId);
      navigate('/projects');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除失败');
      setSubmitting(false);
    }
  }, [projectId, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-cyan-500" />
          <span className="text-sm text-slate-400 font-medium">加载项目详情…</span>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="glass-card p-12 text-center">
          <AlertCircle className="mx-auto mb-4 text-rose-400" size={48} />
          <p className="mb-2 text-lg font-bold text-slate-900">加载失败</p>
          <p className="mb-6 text-sm text-slate-500">{error || '项目不存在或数据异常'}</p>
          <button
            onClick={() => navigate('/projects')}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            返回项目列表
          </button>
        </div>
      </div>
    );
  }

  const totalEpisodes = project.episodeCount;
  const totalRuns = project.runCount;
  const allRuns = project.scripts.flatMap(s => s.episodes.flatMap(e => e.runs));
  const latestRun = allRuns.sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())[0];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* 面包屑 */}
      <nav className="mb-6 flex items-center gap-2 text-xs font-semibold text-slate-400">
        <Link to="/projects" className="hover:text-cyan-600 transition-colors">项目列表</Link>
        <ChevronRight size={12} />
        <span className="text-slate-900">{project.title}</span>
      </nav>

      {/* 项目头部 */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <button onClick={() => navigate('/projects')} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 hover:border-cyan-200 hover:text-cyan-700 transition-all shrink-0">
                <ArrowLeft size={12} />返回
              </button>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{project.title}</h1>
            {project.description && (
              <p className="mt-0.5 text-sm text-slate-500 line-clamp-1">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => navigate(`/project/${projectId}/assets`)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 transition-all"
              title="资产库 & 跨集继承"
            >
              <BookOpen size={13} />
              资产库
            </button>
            <button onClick={openEditModal} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:border-cyan-200 hover:text-cyan-700 transition-all">
              <Pencil size={12} />编辑
            </button>
            <button onClick={() => { setActionError(null); setShowDeleteConfirm(true); }} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-all">
              <Trash2 size={12} />删除
            </button>
          </div>
        </div>

        {/* 紧凑统计 chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            <Film size={12} className="text-cyan-500" />{totalEpisodes} 集
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            <Play size={12} className="text-teal-500" />{totalRuns} 次运行
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            <Layers size={12} className="text-violet-500" />{project.scripts.length} 个剧本
          </span>
          {project.genre && (
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-[10px] font-bold text-cyan-700">{project.genre}</span>
          )}
          {project.style && <StyleBadge value={project.style} />}
          {project.aspectRatio && (
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[10px] font-bold text-teal-700">{project.aspectRatio}</span>
          )}
          {latestRun && (
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${getStatus(latestRun.status).tone}`}>
              {getStatus(latestRun.status).label}
            </span>
          )}
          {runPolling && (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-[10px] font-bold text-cyan-700">
              <Loader2 size={11} className="animate-spin" />
              运行中…
            </span>
          )}
          {latestRun && (
            <span className="text-[11px] text-slate-400 font-medium">
              <Clock size={11} className="inline -mt-0.5 mr-0.5 text-slate-400" />
              {formatDate(latestRun.startedAt)}
            </span>
          )}
        </div>

        {/* 角色头像条 */}
        {characters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {characters.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
              >
                {ch.referenceImageUrl ? (
                  <img
                    src={ch.referenceImageUrl}
                    alt={ch.name}
                    className="h-5 w-5 rounded-md object-cover border border-slate-200"
                  />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 border border-slate-200">
                    <User size={10} className="text-slate-400" />
                  </div>
                )}
                <span className="truncate max-w-[64px]">{ch.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 无剧集 */}
      {totalEpisodes === 0 && (
        <div className="glass-card p-16 text-center">
          <Film className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="mb-2 text-lg font-bold text-slate-600">暂无剧集</p>
          <p className="text-sm text-slate-400">该项目下还没有运行过任何剧集，跑一轮 Director 流水线后会自动显示。</p>
        </div>
      )}

      {/* 剧集列表 - 按剧本分组 */}
      {project.scripts.map((script) => (
        <div key={script.id} className="mb-6">
          {/* 剧本标题 */}
          <div className="mb-4 flex items-center gap-2.5">
            <Sparkles size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold text-slate-900 tracking-wide">{script.title}</h2>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              {script.episodes.length} 集
            </span>
          </div>

          {/* 剧集卡片网格 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {script.episodes.map((episode) => {
              const latestEpRun = episode.runs.sort(
                (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
              )[0];
              const epStatus = getStatus(latestEpRun?.status);
              const passCount = episode.runs.filter(r => ['pass', 'completed', 'cached', 'success'].includes((r.status || '').toLowerCase())).length;
              const episodeQuery = new URLSearchParams({
                episode: episode.id,
                script: script.id,
              });
              if (latestEpRun?.id) {
                episodeQuery.set('run', latestEpRun.id);
              }
              const detailQuery = `?${episodeQuery.toString()}`;
              const canReview = Boolean(latestEpRun?.id && isRunReviewable(latestEpRun.status));

              return (
                <div
                  key={episode.id}
                  className="glass-card p-4 transition-all duration-300 group hover:border-cyan-200 hover:ring-2 hover:ring-cyan-100"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/drama/${projectId}${detailQuery}`)}
                    className="w-full text-left"
                  >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900 group-hover:text-cyan-700 transition-colors leading-snug truncate">
                          {episode.title || '未命名剧集'}
                        </h3>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-bold shrink-0 ${epStatus.tone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${epStatus.dot}`} />
                          {epStatus.label}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400 font-medium">
                        <span className="flex items-center gap-1">
                          <Hash size={10} />
                          {episode.runs.length} 次运行
                        </span>
                        {latestEpRun && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(latestEpRun.startedAt)}
                          </span>
                        )}
                        {episode.runs.length > 0 && (
                          <span>{passCount}/{episode.runs.length} 通过</span>
                        )}
                        {latestEpRun?.headline && (
                          <span className="truncate max-w-[160px] text-slate-500">{latestEpRun.headline}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-cyan-500 transition-colors shrink-0 mt-0.5" />
                  </div>
                  </button>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      to={`/editor?projectId=${encodeURIComponent(projectId || '')}&scriptId=${encodeURIComponent(script.id)}&episodeId=${encodeURIComponent(episode.id)}&runId=${encodeURIComponent(latestEpRun?.id || '')}`}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      编辑分镜
                    </Link>
                    {canReview ? (
                      <Link
                        to={`/review/${encodeURIComponent(latestEpRun!.id)}?projectId=${encodeURIComponent(projectId || '')}&scriptId=${encodeURIComponent(script.id)}&episodeId=${encodeURIComponent(episode.id)}&runId=${encodeURIComponent(latestEpRun!.id)}`}
                        className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
                      >
                        审片
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* 剧本管理 */}
      <div className="mt-8">
        <ScriptManager
          projectId={projectId!}
          onUploadSuccess={handleUploadSuccess}
          onRunStateChange={handleRunStateChange}
        />
      </div>

      {/* Action error toast */}
      {actionError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 shadow-lg animate-in">
          {actionError}
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowEditModal(false)}>
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 font-heading">编辑项目</h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              {/* 标题 */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">项目标题</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all"
                />
              </div>

              {/* 简述 */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">项目简述</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="简要描述项目内容（可选）…"
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all resize-none"
                />
              </div>

              {/* 题材 + 画风 */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">题材风格</label>
                <select
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all appearance-none"
                >
                  {GENRE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">画风</label>
                <StylePicker value={editStyle} onChange={setEditStyle} />
              </div>

              {/* 封面 + 比例 */}
              <div className="mb-4 grid grid-cols-[1fr_140px] gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">封面图片 URL</label>
                  <input
                    type="text"
                    value={editCoverUrl}
                    onChange={(e) => setEditCoverUrl(e.target.value)}
                    placeholder="粘贴封面图链接（可选）"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">画面比例</label>
                  <select
                    value={editAspectRatio}
                    onChange={(e) => setEditAspectRatio(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all appearance-none"
                  >
                    {RATIO_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 封面预览 */}
              {editCoverUrl.trim() && (
                <div className="mb-5 rounded-xl border border-slate-200 overflow-hidden">
                  <img
                    src={editCoverUrl.trim()}
                    alt="封面预览"
                    className="w-full h-36 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

              {actionError && (
                <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  {actionError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={submitting}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!editTitle.trim() || submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-cyan-500/20 hover:shadow-cyan-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={14} />}
                  {submitting ? '保存中…' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100">
                <Trash2 size={18} className="text-rose-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">确认删除项目</h2>
                <p className="text-xs text-slate-500 mt-0.5">此操作不可恢复，所有运行数据将一并删除。</p>
              </div>
            </div>

            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 leading-relaxed">
              项目 <span className="font-bold">{project?.title}</span> 包含 {totalEpisodes} 个剧集和 {totalRuns} 次运行记录，删除后将无法找回。
            </div>

            {actionError && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {actionError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={submitting}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-rose-500/20 hover:bg-rose-700 hover:shadow-rose-500/35 disabled:opacity-50 transition-all"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={14} />}
                {submitting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
