import { useState, useEffect } from 'react';
import { X, Check, Edit2, User, MapPin, Video, Clock } from 'lucide-react';
import type { Chapter } from '../types/drama';

interface PreviewShot {
  narration: string;
  visual_description: string;
  character: string | null;
  character_id: string | null;
  scene: string | null;
  camera_movement: string | null;
  duration: string | null;
}

interface Character {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  previewStatus?: string;
  previewErrors?: Array<{
    chunk_index: number;
    stage?: string;
    error_code: string;
    exception_type?: string;
    message: string;
    retryable?: boolean;
  }>;
  onRetryFailed?: () => Promise<void>;
  chapter: Chapter | null;
  previewData: PreviewShot[];
  projectCharacters: Character[];
  onCommit: (shots: PreviewShot[]) => Promise<void>;
}

export default function PreviewModal({
  isOpen,
  onClose,
  isLoading,
  previewStatus,
  previewErrors = [],
  onRetryFailed,
  previewData,
  projectCharacters,
  onCommit
}: PreviewModalProps) {
  const [shots, setShots] = useState<PreviewShot[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    if (isOpen && previewData) {
      setShots(JSON.parse(JSON.stringify(previewData))); // Deep copy
    }
  }, [isOpen, previewData]);

  const handleShotChange = (index: number, field: keyof PreviewShot, value: any) => {
    const newShots = [...shots];
    newShots[index] = { ...newShots[index], [field]: value };
    setShots(newShots);
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    try {
      await onCommit(shots);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!onRetryFailed) return;
    setIsRetrying(true);
    try {
      await onRetryFailed();
    } finally {
      setIsRetrying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl border border-slate-200 flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
              <span className="text-purple-400">分镜预览与确认</span>
              <span className="text-sm px-3 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                {shots.length} Shots
              </span>
            </h2>
            <p className="text-slate-500 text-sm mt-1">
              请确认 AI 拆分的结果。修正角色归属可以大幅提高生成的一致性。
            </p>
            {previewStatus && (
              <p className="text-xs mt-1 text-blue-600">
                当前状态: {previewStatus}
              </p>
            )}
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-900"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content: List of Shots */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!isLoading && previewErrors.length > 0 && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-3">
              <div className="text-sm text-red-600 font-semibold">部分分块生成失败 ({previewErrors.length})</div>
              <div className="mt-2 space-y-2">
                {previewErrors.map((e, idx) => (
                  <div key={`${e.chunk_index}-${idx}`} className="text-xs text-red-600">
                    Chunk {e.chunk_index + 1} | {e.stage || 'unknown'} | {e.exception_type || 'Exception'} | [{e.error_code}] {e.message}
                  </div>
                ))}
              </div>
              {onRetryFailed && (
                <button
                  onClick={handleRetryFailed}
                  disabled={isRetrying || isLoading}
                  className="mt-3 px-3 py-1.5 rounded bg-red-50 border border-red-200 text-red-600 text-xs hover:bg-red-100 disabled:opacity-50"
                >
                  {isRetrying ? "重试中..." : "仅重试失败分块"}
                </button>
              )}
            </div>
          )}
          {isLoading ? (
             <div className="flex flex-col items-center justify-center h-full space-y-4 text-slate-500">
               <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
               <p>正在智能分析章节内容...</p>
             </div>
          ) : (
            shots.map((shot, index) => (
              <div key={index} className="bg-slate-50 rounded-xl p-4 border border-slate-200 hover:border-purple-500/30 transition-all group">
                <div className="flex gap-4">
                  {/* Index */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-500 font-mono text-sm">
                    {index + 1}
                  </div>

                  {/* Main Edit Area */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Left: Narration & Visual */}
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1 block">旁白 / 原文 (Narration)</label>
                        <div className="text-slate-600 text-sm leading-relaxed p-2 bg-slate-50 rounded border border-slate-200">
                          {shot.narration}
                        </div>
                      </div>
                      <div>
                         <label className="text-xs text-purple-400/80 uppercase font-bold tracking-wider mb-1 flex items-center gap-2">
                           <Edit2 size={12} /> 画面描述 (Visual Description)
                         </label>
                         <textarea
                           className="w-full bg-slate-100 border border-slate-200 rounded p-2 text-sm text-slate-800 focus:border-purple-500/50 outline-none transition-colors resize-none h-20"
                           value={shot.visual_description}
                           onChange={(e) => handleShotChange(index, "visual_description", e.target.value)}
                           placeholder="AI generated visual description..."
                         />
                      </div>
                    </div>

                    {/* Right: Metadata (Character & Scene) */}
                    <div className="space-y-4 pt-1">
                      {/* Character Selection */}
                      <div>
                        <label className="text-xs text-blue-400/80 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
                          <User size={12} /> 出场角色 (Character)
                        </label>
                        <div className="flex gap-2">
                            <select
                                className="flex-1 bg-slate-100 border border-slate-200 rounded p-2 text-sm text-slate-900 focus:border-blue-500/50 outline-none"
                                value={shot.character_id || ""}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    handleShotChange(index, "character_id", val || null);
                                    // Update name for UI consistency if needed, though ID is source of truth
                                }}
                            >
                                <option value="">无指定角色 (None)</option>
                                {projectCharacters.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {shot.character && !shot.character_id && (
                            <div className="text-xs text-yellow-500 mt-1 flex items-center gap-1">
                                <span>⚠️ 检测到 "{shot.character}" 但未匹配到 ID</span>
                            </div>
                        )}
                      </div>

                      {/* Camera & Duration */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-orange-400/80 uppercase font-bold tracking-wider mb-1 flex items-center gap-2">
                            <Video size={12} /> 运镜 (Camera)
                          </label>
                          <select
                              className="w-full bg-slate-100 border border-slate-200 rounded p-2 text-sm text-slate-900 focus:border-orange-500/50 outline-none"
                              value={shot.camera_movement || "NONE"}
                              onChange={(e) => handleShotChange(index, "camera_movement", e.target.value)}
                          >
                              <option value="NONE">无运镜</option>
                              <option value="PAN_LEFT">左移 (Pan Left)</option>
                              <option value="PAN_RIGHT">右移 (Pan Right)</option>
                              <option value="PAN_UP">上移 (Pan Up)</option>
                              <option value="PAN_DOWN">下移 (Pan Down)</option>
                              <option value="ZOOM_IN">推近 (Zoom In)</option>
                              <option value="ZOOM_OUT">拉远 (Zoom Out)</option>
                              <option value="STATIC">固定 (Static)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-amber-400/80 uppercase font-bold tracking-wider mb-1 flex items-center gap-2">
                            <Clock size={12} /> 时长 (Duration)
                          </label>
                          <input 
                              type="text" 
                              className="w-full bg-slate-100 border border-slate-200 rounded p-2 text-sm text-slate-900 focus:border-amber-500/50 outline-none"
                              value={shot.duration || "4s"}
                              onChange={(e) => {
                                  let val = e.target.value;
                                  handleShotChange(index, "duration", val);
                              }}
                              onBlur={(e) => {
                                  let val = e.target.value;
                                  if (val && !val.endsWith('s') && !isNaN(Number(val))) val += 's';
                                  handleShotChange(index, "duration", val);
                              }}
                          />
                        </div>
                      </div>

                      {/* Scene (4D Display) */}
                      <div>
                         <label className="text-xs text-green-400/80 uppercase font-bold tracking-wider mb-1 flex items-center gap-2">
                           <MapPin size={12} /> 场景详情 (Scene 4D)
                         </label>
                         <div className="space-y-2">
                            <textarea 
                                className="w-full bg-slate-100 border border-slate-200 rounded p-2 text-sm text-slate-800 focus:border-green-500/50 outline-none transition-colors resize-none h-24"
                                value={shot.scene || ""}
                                onChange={(e) => handleShotChange(index, "scene", e.target.value)}
                                placeholder="时空：...\n环境：...\n物品：...\n镜头与氛围：..."
                            />
                            {shot.scene && (shot.scene.includes('时空：') || shot.scene.includes('环境：')) && (
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {shot.scene.split('\n').map((line, lidx) => {
                                        const [label, content] = line.split(/[：:]/);
                                        if (content) {
                                            return (
                                                <span key={lidx} className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                                                    {label}
                                                </span>
                                            );
                                        }
                                        return null;
                                    })}
                                </div>
                            )}
                         </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-medium"
            disabled={isCommitting}
          >
            取消
          </button>
          <button 
            onClick={handleCommit}
            disabled={isCommitting || isLoading || shots.length === 0}
            className={`
                px-8 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium
                hover:shadow-lg hover:shadow-purple-500/20 transition-all flex items-center gap-2
                ${isCommitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
            `}
          >
            {isCommitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  提交生成中...
                </>
            ) : (
                <>
                  <Check size={18} />
                  确认并生成分镜
                </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
