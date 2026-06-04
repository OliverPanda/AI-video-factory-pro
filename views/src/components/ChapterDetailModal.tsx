import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Image as ImageIcon, FileText, Clock, Clapperboard, RefreshCw, Sparkles, Video, Loader2, Play, Download } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import VideoPreviewModal from './remotion/VideoPreviewModal';
import ImageWithPreview from './ImageWithPreview';
import type { VideoSegment } from './remotion/PreviewComposition';
import type { Chapter, Shot } from '../types/drama';

interface ChapterDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapter: Chapter | null;
  onRegenerate?: () => Promise<void>; // 重新生成整章分镜
  initialTab?: 'script' | 'storyboard' | 'video'; // 初始显示的标签页
  autoStartVideo?: boolean; // 是否自动开始生成视频
  onGenerateVideo?: () => Promise<void>; // 生成全章视频的回调
  videoUrl?: string | null;
  onRegenerateShotPrompt?: (shotId: string) => Promise<void>; // 重新生成分镜提示词
  onRegenerateShotImage?: (shotId: string) => Promise<void>; // 重新生成分镜图片
  onRegenerateAllImages?: () => Promise<void>; // 重新生成所有分镜图片
  onCancelShotImage?: (shotId: string) => Promise<void>; // 取消生图任务
  isAnalyzing?: boolean;
  onGenerateShotVideo?: (shotId: string) => Promise<void>; // 生成单个分镜视频
  onStopShotVideo?: (shotId: string) => void;
  onGenerateShotVideoPrompt?: (shotId: string) => Promise<void>; // 生成单个视频动作提示词
  onGenerateAllVideoPrompts?: () => Promise<void>; // 批量生成所有提示词
  onUpdateShot?: (shotId: string, updates: Partial<Shot>) => Promise<void>; // 更新分镜信息
  isBatchGeneratingPrompts?: boolean;
  onStopBatchPrompts?: () => void;
  isBatchGeneratingVideos?: boolean;
  onStopBatchVideos?: () => void;
  autoStartPrompt?: boolean; // 是否自动开始提示词生成流程
  projectCharacters?: any[]; // Full list of project characters
  projectScenes?: any[]; // Full list of project scenes
}

export default function ChapterDetailModal({ 
  isOpen, onClose, chapter, onRegenerate, initialTab = 'script', 
  autoStartVideo = false, autoStartPrompt = false, onGenerateVideo, videoUrl,
  onRegenerateShotPrompt, onRegenerateShotImage, onRegenerateAllImages, 
  onCancelShotImage,
  onGenerateShotVideo,
  onStopShotVideo,
  onGenerateShotVideoPrompt,
  onGenerateAllVideoPrompts,
  onUpdateShot,
  isBatchGeneratingPrompts = false,
  onStopBatchPrompts,
  isBatchGeneratingVideos = false,
  onStopBatchVideos,
  isAnalyzing = false,
  projectCharacters = [],
  projectScenes = []
}: ChapterDetailModalProps) {
  if (!isOpen || !chapter) return null;

  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false); // 正在执行全章重新生成的标识
  const [regeneratingPrompts, setRegeneratingPrompts] = useState<Set<string>>(new Set());
  const [regeneratingImages, setRegeneratingImages] = useState<Set<string>>(new Set());
  const [cancellingImages, setCancellingImages] = useState<Set<string>>(new Set());
  const [isRegeneratingAllImages, setIsRegeneratingAllImages] = useState(false);
  
  // 视频生成相关状态
  const hasAutoStartedRef = useRef(false);
  const hasAutoStartedPromptRef = useRef(false);
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  
  // 预览全片弹窗状态
  const [showFullPreview, setShowFullPreview] = useState(false);
  
  // 确认弹窗状态
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'warning' | 'danger' | 'info' | 'success';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning',
    onConfirm: () => {},
  });

  // Sync internal video generating state with external if provided
  useEffect(() => {
      if (isBatchGeneratingVideos) {
          setIsVideoGenerating(true);
      } else {
          setIsVideoGenerating(false);
      }
  }, [isBatchGeneratingVideos]);

  // Auto-start prompt generation
  useEffect(() => {
      if (autoStartPrompt && !hasAutoStartedPromptRef.current && onGenerateAllVideoPrompts && !isBatchGeneratingPrompts) {
          hasAutoStartedPromptRef.current = true;
          // Small delay to ensure UI is ready
          setTimeout(() => {
              onGenerateAllVideoPrompts();
          }, 300);
      }
      
      if (!isOpen) { 
          hasAutoStartedPromptRef.current = false; 
      }
  }, [autoStartPrompt, isOpen, onGenerateAllVideoPrompts, isBatchGeneratingPrompts]);

  const isAnyShotGenerating = isVideoGenerating || isBatchGeneratingVideos || chapter.shots?.some((s: any) => s.status === 'generating_video');



  const characters = (() => {
    try {
      const parsed = chapter.characters_json ? JSON.parse(chapter.characters_json) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  })();

  const scenes = (() => {
    try {
      const parsed = chapter.scenes_json ? JSON.parse(chapter.scenes_json) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  })();

  const emotions = (() => {
    try {
      const parsed = chapter.emotions_json ? JSON.parse(chapter.emotions_json) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  })();

  const [activeTab, setActiveTab] = useState<'script' | 'storyboard' | 'video'>('script');

  // 当弹窗打开或章节 ID 变更时，重置标签页和自动开始标志位
  useEffect(() => {
    if (isOpen) {
        setActiveTab(initialTab);
        hasAutoStartedRef.current = false;
    }
  }, [isOpen, chapter?.id, initialTab]);

  // Auto-start video generation check
  useEffect(() => {
    if (isOpen && activeTab === 'video' && autoStartVideo && !hasAutoStartedRef.current && onGenerateVideo) {
        // Create a small delay to ensure UI is ready
        const timer = setTimeout(() => {
            if (!hasAutoStartedRef.current) {
                console.log('Auto-starting video generation...');
                hasAutoStartedRef.current = true;
                setIsVideoGenerating(true);
                onGenerateVideo().finally(() => {
                    setIsVideoGenerating(false);
                });
            }
        }, 500);
        return () => clearTimeout(timer);
    }
  }, [isOpen, activeTab, autoStartVideo, onGenerateVideo]);

  // 计算预览片段序列
  const previewSegments = useMemo<VideoSegment[]>(() => {
    if (!chapter.shots) return [];
    return chapter.shots
      .filter(shot => !!shot.video_url)
      .map(shot => ({
        url: shot.video_url!,
        durationInFrames: 120, // 假设 4秒 (30fps)
      }));
  }, [chapter.shots]);

  const handleRegenerateClick = async () => {
    setConfirmConfig({
      isOpen: true,
      title: '重新生成分镜',
      message: '确定要重新生成分镜脚本吗？\n这将覆盖现有的分镜内容，现有修改将丢失。',
      type: 'warning',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        try {
          setIsRegeneratingAll(true);
          await onRegenerate?.();
        } finally {
          setIsRegeneratingAll(false);
        }
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white/90 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="glass-card w-full max-w-5xl mx-4 h-[85vh] flex flex-col border border-slate-200 shadow-2xl relative overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 p-6 border-b border-slate-200 bg-slate-50 z-10 backdrop-blur-md flex flex-col gap-4">
           <div className="flex items-start justify-between">
               <div>
                 <div className="flex items-center gap-3 mb-2">
                   <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-mono border border-indigo-200">
                     第 {String(chapter.number).padStart(2, '0')} 章
                   </span>
                   <span className="text-slate-400 text-xs flex items-center gap-1">
                     <Clock size={12} />
                     {new Date().toLocaleDateString()}
                   </span>
                 </div>
                 <h2 className="text-2xl font-bold text-slate-900 font-heading">{chapter.title}</h2>
               </div>
               
               <button
                 onClick={onClose}
                 className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors"
               >
                 <X size={24} />
               </button>
           </div>

                {/* Tab Switcher & Actions */}
           <div className="flex items-center justify-between">
               <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl w-fit border border-slate-200">
                    <button
                        onClick={() => setActiveTab('script')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            activeTab === 'script' 
                            ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' 
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                    >
                        <FileText size={16} />
                        剧本正文
                    </button>
                    <button
                        onClick={() => setActiveTab('storyboard')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            activeTab === 'storyboard' 
                            ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' 
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                    >
                        <Clapperboard size={16} />
                        分镜脚本
                        {chapter.shots && chapter.shots.length > 0 && (
                            <span className="bg-slate-200 text-slate-900 text-[10px] px-1.5 rounded-full">
                                {chapter.shots.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('video')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            activeTab === 'video' 
                            ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' 
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                    >
                        <Video size={16} />
                        成片制作
                    </button>
               </div>

               {/* Right Actions - Button Group */}
               {activeTab === 'storyboard' && (
                   <div className="flex items-center gap-3">
                       <button
                            onClick={handleRegenerateClick}
                            disabled={isRegeneratingAll}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                                isRegeneratingAll 
                                ? 'bg-amber-500/10 border-amber-500/20 text-amber-500/50 cursor-not-allowed'
                                : 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100 hover:shadow-lg hover:shadow-amber-500/10'
                            }`}
                       >
                           <RefreshCw size={16} className={isRegeneratingAll ? 'animate-spin' : ''} />
                           {isRegeneratingAll ? '生成中...' : '重新生成提示词'}
                       </button>
                       {chapter.shots && chapter.shots.length > 0 && (
                           <>
                               <button
                                    onClick={() => {
                                       setConfirmConfig({
                                           isOpen: true,
                                           title: '批量生成分镜图',
                                           message: '确定要重新生成所有分镜图吗？\n这将为所有分镜重新生成图片。',
                                           type: 'warning',
                                           onConfirm: async () => {
                                               setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                               try {
                                                   setIsRegeneratingAllImages(true);
                                                   await onRegenerateAllImages?.();
                                               } finally {
                                                   setIsRegeneratingAllImages(false);
                                               }
                                           }
                                       });
                                    }}
                                    disabled={isRegeneratingAllImages}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                                        isRegeneratingAllImages 
                                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500/50 cursor-not-allowed'
                                        : 'text-cyan-600 bg-cyan-50 border-cyan-200 hover:bg-cyan-100 hover:shadow-lg hover:shadow-cyan-500/10'
                                    }`}
                               >
                                   <ImageIcon size={16} className={isRegeneratingAllImages ? 'animate-pulse' : ''} />
                                   {isRegeneratingAllImages ? '生成中...' : '重新生成所有分镜图'}
                               </button>
                               
                               {/* Emergency Stop Button */}
                               <button
                                    onClick={() => {
                                        setConfirmConfig({
                                            isOpen: true,
                                            title: '停止所有生成任务',
                                            message: '确定要停止所有生成任务吗？\n包括队列中和正在执行的任务都会被取消。',
                                            type: 'danger',
                                            onConfirm: async () => {
                                                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                                try {
                                                    const response = await fetch('/api/generation/stop_all', {
                                                        method: 'POST'
                                                    });
                                                    if (response.ok) {
                                                        window.location.reload(); 
                                                    } else {
                                                        console.error('Stop failed');
                                                    }
                                                } catch (error) {
                                                    console.error('Stop failed:', error);
                                                }
                                            }
                                        });
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border
                                               text-red-600 bg-red-50 border-red-200
                                               hover:bg-red-100 hover:shadow-lg hover:shadow-red-500/10
                                               transition-all"
                               >
                                   <X size={16} />
                                   停止所有生成
                               </button>
                           </>
                       )}
                   </div>
               )}
           </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50">
             {activeTab === 'script' ? (
                // === Script Tab Content ===
                <div className="grid grid-cols-1 lg:grid-cols-3 min-h-full">
                    {/* 剧本正文区域 (左侧) */}
                    <div className="lg:col-span-2 p-8 border-r border-slate-200 space-y-8 bg-slate-50">
                        {/* 核心看点 (Hook) */}
                        {chapter.hook && (
                            <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                               <h3 className="text-amber-600 text-sm font-bold mb-2 flex items-center gap-2">
                                 <Sparkles size={14} />
                                 核心看点 (Hook)
                               </h3>
                               <p className="text-amber-700 text-sm leading-relaxed italic">
                                 "{chapter.hook}"
                               </p>
                            </div>
                        )}

                        {/* 正文内容 */}
                        <div>
                           <div className="prose prose-p:text-slate-600 prose-p:leading-loose text-base bg-slate-50 p-8 rounded-2xl border border-slate-200 shadow-inner">
                              {chapter.content ? (
                                  chapter.content.split('\n').map((para: string, i: number) => (
                                      para.trim() && <p key={i} className="mb-4 last:mb-0 indent-8 text-justify">{para}</p>
                                  ))
                              ) : (
                                  <p className="text-slate-400 italic">暂无内容...</p>
                              )}
                           </div>
                        </div>
                    </div>

                    {/* 侧边栏 (右侧)：显示提取的人物、场景和情绪 */}
                    <div className="p-6 bg-slate-50 space-y-8">
                        {/* 情绪基调 */}
                        {emotions.length > 0 && (
                            <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">情绪基调</h4>
                                <div className="flex flex-wrap gap-2">
                                    {emotions.map((emo: string, i: number) => (
                                        <span key={i} className="px-3 py-1 bg-pink-50 text-pink-600 border border-pink-200 rounded-lg text-xs">
                                            #{emo}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Characters */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">出场人物</h4>
                                <span className="text-xs text-cyan-500 bg-cyan-50 px-2 py-0.5 rounded-full">{characters.length}</span>
                            </div>
                            <div className="space-y-3">
                                {characters.map((char: any, i: number) => {
                                    const charName = typeof char === 'string' ? char : char.name;
                                    const charDesc = typeof char === 'object' ? char.desc : '';
                                    
                                    // 尝试匹配项目中的角色获取头像
                                    const matchedChar = projectCharacters.find(pc => pc.name === charName || pc.alias === charName);
                                    const avatar = matchedChar?.avatarUrl;

                                    return (
                                        <div key={i} className="flex items-start gap-3 p-3 bg-slate-100 rounded-xl border border-slate-200 hover:border-cyan-300 transition-colors group/item">
                                            {avatar ? (
                                                <ImageWithPreview 
                                                    src={avatar} 
                                                    alt={charName} 
                                                    containerClassName="w-8 h-8 rounded-full shrink-0" 
                                                    className="w-full h-full object-cover"
                                                    showIcon={false}
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                                                    {charName[0]}
                                                </div>
                                            )}
                                            <div>
                                                <div className="text-sm font-medium text-slate-900">{charName}</div>
                                                {charDesc && <div className="text-xs text-slate-500 mt-1 line-clamp-2">{charDesc}</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Scenes */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">场景地点</h4>
                                <span className="text-xs text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full">{scenes.length}</span>
                            </div>
                            <div className="space-y-3">
                                 {scenes.map((scene: any, i: number) => {
                                    const locName = typeof scene === 'string' ? scene : (scene.location || scene.desc || '未知场景');
                                    const sceneDesc = typeof scene === 'object' ? (scene.desc || scene.time) : '';
                                    
                                    // 尝试匹配项目中的场景获取图
                                    const matchedScene = projectScenes.find(ps => ps.name === locName);
                                    const sceneImg = matchedScene?.imageUrl;

                                    return (
                                        <div key={i} className="flex items-start gap-3 p-3 bg-slate-100 rounded-xl border border-slate-200 hover:border-emerald-300 transition-colors group/item">
                                            {sceneImg ? (
                                                <ImageWithPreview 
                                                    src={sceneImg} 
                                                    alt={locName} 
                                                    containerClassName="w-12 h-8 rounded-lg shrink-0" 
                                                    className="w-full h-full object-cover"
                                                    showIcon={false}
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-500 shrink-0">
                                                    <ImageIcon size={16} />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-slate-900 truncate">{locName}</div>
                                                {sceneDesc && <div className="text-xs text-slate-500 mt-1 line-clamp-2">{sceneDesc}</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            ) : activeTab === 'video' ? (
                // === 视频制作标签页：包含分镜预览和视频生成参数编辑 ===
                <div className="flex flex-col h-full bg-white">
                    
                    {/* 1. 全局状态与批量操作区域 */}
                    <div className="shrink-0 p-6 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                         <div className="flex items-center gap-4">
                            {/* 进度环 (显示生成进度) */}
                            {(chapter.progress !== undefined && chapter.progress > 0 && chapter.progress < 100) ? (
                                <div className="flex items-center gap-3 bg-cyan-50 border border-cyan-200 px-4 py-2 rounded-xl">
                                    <div className="relative w-5 h-5">
                                         <svg className="w-full h-full -rotate-90" viewBox="0 0 24 24">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="text-cyan-100" fill="none" />
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="text-cyan-500" fill="none"
                                                strokeDasharray={`${2 * Math.PI * 10}`}
                                                strokeDashoffset={`${2 * Math.PI * 10 * (1 - (chapter.progress || 0) / 100)}`} />
                                         </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-cyan-600">正在生成: {chapter.progress}%</span>
                                        <span className="text-[10px] text-cyan-500/60">AI 正在逐个渲染分镜视频...</span>
                                    </div>
                                </div>
                            ) : videoUrl ? (
                                <div className="flex items-center gap-2 text-emerald-500 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <span className="text-xs font-bold">全片合成完成</span>
                                </div>
                            ) : (
                                <div className="text-slate-500 text-sm">
                                    <span className="text-slate-900 font-bold">{chapter.shots?.length || 0}</span> 个分镜待生成
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                             {/* Main Action Button - Now Preview */}
                             {previewSegments.length > 0 && (
                                 <button 
                                    onClick={() => setShowFullPreview(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-bold transition-all border border-cyan-200 shadow-lg shadow-cyan-500/10"
                                >
                                    <Play size={14} fill="currentColor" />
                                    预览完整视频 ({previewSegments.length})
                                </button>
                             )}

                             {videoUrl && !isAnyShotGenerating && (
                                 <button
                                     onClick={() => {
                                         setIsVideoGenerating(true);
                                         onGenerateVideo?.().finally(() => setIsVideoGenerating(false));
                                     }}
                                     className="flex items-center gap-2 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 rounded-lg text-sm font-bold transition-all"
                                 >
                                     <RefreshCw size={14} />
                                     重新生成视频
                                 </button>
                             )}

                             {videoUrl && (
                                 <a 
                                    href={videoUrl} 
                                    download={`chapter_${chapter.number}_video.mp4`}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg text-sm font-bold transition-all border border-slate-200"
                                    title="下载已合成的 MP4 文件"
                                >
                                    <Download size={14} />
                                    下载 MP4
                                </a>
                            )}
                            
                            {!videoUrl && !isAnyShotGenerating && (
                                <>

                                {/* Batch Prompt Generation Button */}
                                <button
                                    onClick={() => {
                                        if (isBatchGeneratingPrompts) {
                                            onStopBatchPrompts?.();
                                        } else {
                                            onGenerateAllVideoPrompts?.();
                                        }
                                    }}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all border ${
                                        isBatchGeneratingPrompts
                                        ? 'bg-red-50 hover:bg-red-100 text-red-500 border-red-200 w-[140px] justify-center'
                                        : 'bg-transparent hover:bg-cyan-50 text-cyan-500 border-cyan-300 hover:border-cyan-500/50'
                                    }`}
                                    title={isBatchGeneratingPrompts ? "停止生成提示词" : "一键生成所有视频提示词"}
                                >
                                    {isBatchGeneratingPrompts ? (
                                        <>
                                            <X size={16} />
                                            停止生成
                                        </>
                                    ) : (
                                        <>
                                            <FileText size={16} />
                                            一键生成提示词
                                        </>
                                    )}
                                </button>

                                 {/* 批量视频生成按钮 */}
                                <button
                                    onClick={() => {
                                        if (isAnyShotGenerating) {
                                            // 处于生成中状态时，点击则触发停止逻辑
                                            onStopBatchVideos?.();
                                            setIsVideoGenerating(false);
                                        } else {
                                            setIsVideoGenerating(true);
                                            onGenerateVideo?.().finally(() => setIsVideoGenerating(false));
                                        }
                                    }}
                                    disabled={(!onGenerateVideo && !onStopBatchVideos)}
                                    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg min-w-[160px] justify-center ${
                                        isAnyShotGenerating
                                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20'
                                        : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-500/20 hover:scale-105'
                                    }`}
                                >
                                    {isAnyShotGenerating ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            停止生成视频
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={14} fill="currentColor" />
                                            一键生成所有视频
                                        </>
                                    )}
                                 </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 2. 分镜列表区域（可滚动） */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                        {chapter.shots && chapter.shots.length > 0 ? (
                            chapter.shots.map((shot: Shot, i: number) => (
                                <div key={shot.id || i} className="group grid grid-cols-[300px_1fr_300px] gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-200 hover:border-cyan-300 hover:bg-slate-100 transition-all items-start">
                                    
                                    {/* Left: Source Image */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                                <div className="w-4 h-4 rounded bg-slate-200 flex items-center justify-center text-slate-800">
                                                    {i + 1}
                                                </div>
                                                分镜原图
                                            </span>
                                        </div>
                                        <div 
                                            className="relative aspect-video rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-lg group-hover:shadow-cyan-500/10 transition-all"
                                        >
                                            <ImageWithPreview 
                                                src={shot.image_url || undefined} 
                                                alt={`Shot ${i+1}`} 
                                                className="transition-transform duration-700 group-hover:scale-105"
                                                showIcon={!!shot.image_url}
                                            />
                                        </div>

                                    </div>

                                    {/* Center: Video Prompt Editing */}
                                    <div className="flex flex-col gap-3 h-full">
                                        <div className="flex items-center justify-between px-1">
                                            <span className="text-[10px] font-bold text-cyan-600 uppercase tracking-wider flex items-center gap-1.5">
                                                <div className="w-4 h-4 rounded bg-cyan-50 flex items-center justify-center text-cyan-500">
                                                    <FileText size={10} />
                                                </div>
                                                参数设置
                                            </span>
                                        </div>

                                        <div className="flex-1 flex flex-col gap-3">
                                            {/* Character Selection */}
                                            <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 rounded-lg border border-slate-200">
                                                 <span className="text-[10px] text-slate-400 font-bold shrink-0">指定角色</span>
                                                  <select
                                                      className="flex-1 bg-transparent text-xs text-slate-900 focus:outline-none appearance-none cursor-pointer"
                                                      value={shot.character_id ?? ""}
                                                      onChange={(e) => onUpdateShot?.(shot.id, { character_id: e.target.value || null })}
                                                  >
                                                     <option value="" className="bg-white text-slate-400">不指定 (使用通用描述)</option>
                                                     {projectCharacters.map((c) => (
                                                         <option key={c.id} value={c.id} className="bg-white">
                                                             {c.name} {c.alias ? `(${c.alias})` : ''}
                                                         </option>
                                                     ))}
                                                 </select>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 relative">
                                                    <textarea 
                                                        key={`prompt_${shot.id}_${shot.video_prompt}`}
                                                        className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:bg-slate-100 transition-all resize-none leading-relaxed custom-scrollbar placeholder:text-slate-400"
                                                        placeholder="描述视频中的动作，例如：镜头缓慢右移，角色轻轻挥手..."
                                                        defaultValue={shot.video_prompt ?? ""}
                                                        onBlur={(e) => {
                                                            if (e.target.value !== shot.video_prompt) {
                                                                onUpdateShot?.(shot.id, { video_prompt: e.target.value });
                                                            }
                                                        }}
                                                    />
                                                    <button 
                                                        onClick={() => onGenerateShotVideoPrompt?.(shot.id)}
                                                        className="absolute bottom-2 right-2 p-1.5 bg-cyan-50 hover:bg-cyan-200 text-cyan-600 rounded-lg transition-colors"
                                                        title="AI 生成视频动作提示词"
                                                    >
                                                        <Sparkles size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 mt-2">
                                                {/* Settings Group: Camera & Duration */}
                                                <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 divide-x divide-slate-200 overflow-hidden">
                                                    
                                                    {/* Camera Selection */}
                                                    <div className="group flex items-center px-2.5 py-1.5 gap-2 hover:bg-slate-100 transition-colors relative">
                                                        <Video size={10} className="text-zinc-500 group-hover:text-cyan-500 transition-colors" />
                                                        <select
                                                            className="bg-transparent text-[10px] w-20 text-slate-500 font-medium focus:outline-none appearance-none cursor-pointer hover:text-slate-800 transition-colors"
                                                            value={shot.camera_movement || "NONE"}
                                                            onChange={(e) => onUpdateShot?.(shot.id, { camera_movement: e.target.value })}
                                                            title="运镜方式"
                                                        >
                                                            <option value="NONE" className="bg-white text-slate-400">无运镜</option>
                                                            <option value="PAN_LEFT" className="bg-white">左移 (Pan Left)</option>
                                                            <option value="PAN_RIGHT" className="bg-white">右移 (Pan Right)</option>
                                                            <option value="PAN_UP" className="bg-white">上移 (Pan Up)</option>
                                                            <option value="PAN_DOWN" className="bg-white">下移 (Pan Down)</option>
                                                            <option value="ZOOM_IN" className="bg-white">推近 (Zoom In)</option>
                                                            <option value="ZOOM_OUT" className="bg-white">拉远 (Zoom Out)</option>
                                                            <option value="STATIC" className="bg-white">固定 (Static)</option>
                                                            <option value="CW" className="bg-white">顺时针 (CW)</option>
                                                            <option value="CCW" className="bg-white">逆时针 (CCW)</option>
                                                        </select>
                                                        {/* Custom Arrow because appearance-none hides it */}
                                                        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-50">
                                                            <svg width="6" height="4" viewBox="0 0 6 4" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                <path d="M3 4L0.401924 0.25L5.59808 0.25L3 4Z" fill="currentColor" className="text-slate-400"/>
                                                            </svg>
                                                        </div>
                                                    </div>

                                                    {/* Duration Input */}
                                                    <div className="group flex items-center px-2.5 py-1.5 gap-2 hover:bg-slate-100 transition-colors">
                                                        <Clock size={10} className="text-zinc-500 group-hover:text-cyan-500 transition-colors" />
                                                        <input 
                                                            key={shot.duration}
                                                            type="text" 
                                                            defaultValue={shot.duration || "4s"}
                                                            className="w-8 bg-transparent text-[10px] text-center text-slate-500 font-medium focus:outline-none hover:text-slate-800 transition-colors font-mono appearance-none"
                                                            onBlur={(e) => {
                                                                let val = e.target.value;
                                                                if (val && !val.endsWith('s') && !isNaN(Number(val))) val += 's';
                                                                onUpdateShot?.(shot.id, { duration: val });
                                                            }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Action Button */}
                                                <button 
                                                    onClick={() => {
                                                        if (shot.status === 'generating_video') {
                                                            onStopShotVideo?.(shot.id);
                                                        } else {
                                                            onGenerateShotVideo?.(shot.id);
                                                        }
                                                    }}
                                                    disabled={shot.status === 'queued' || shot.status === 'generating_image'}
                                                    className={`h-[28px] flex-1 flex items-center justify-center gap-1.5 px-3 rounded-lg text-[10px] font-bold transition-all border shadow-sm ${
                                                        shot.status === 'generating_video'
                                                        ? 'bg-red-100 text-red-500 border-red-200 hover:bg-red-200'
                                                        : (!!shot.video_url || shot.status === 'video_completed')
                                                        ? 'bg-emerald-50 text-emerald-500 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-600'
                                                        : 'bg-cyan-500 hover:bg-cyan-400 text-white border-transparent disabled:opacity-50 disabled:cursor-not-allowed shadow-cyan-500/20'
                                                    }`}
                                                >
                                                    {shot.status === 'generating_video' ? (
                                                        <>
                                                            <Loader2 size={10} className="animate-spin" />
                                                            <span>停止</span>
                                                        </>
                                                    ) : (!!shot.video_url) ? (
                                                        <>
                                                            <RefreshCw size={10} />
                                                            <span>重绘</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Video size={10} className="fill-current" />
                                                            <span>生成视频</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Generated Video Clip */}
                                    <div className="space-y-3">
                                         <div className="flex items-center justify-between px-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                                <Video size={10} />
                                                生成结果
                                            </span>
                                            {(shot.video_url || shot.status === 'video_completed') && (
                                                <span className="text-[9px] text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">完成</span>
                                            )}
                                        </div>
                                        
                                        <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-200 shadow-lg group-hover:border-cyan-300 transition-all">
                                            {shot.video_url && (
                                                <video 
                                                    src={shot.video_url} 
                                                    className="w-full h-full object-cover"
                                                    controls={shot.status !== 'generating_video'}
                                                    loop
                                                    muted 
                                                />
                                            )}

                                            {shot.status === 'generating_video' && (
                                                <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 transition-all duration-500 ${shot.video_url ? 'bg-white/80 backdrop-blur-[2px]' : 'bg-cyan-50'}`}>
                                                    <div className="relative">
                                                        <div className="absolute inset-0 bg-cyan-100 rounded-full blur-xl animate-pulse"></div>
                                                        <Loader2 size={32} className="text-cyan-500 animate-spin relative z-10" />
                                                    </div>
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-[11px] text-cyan-600 font-black tracking-[0.2em] animate-pulse">正在重塑场景</span>
                                                        <span className="text-[9px] text-cyan-500/60 font-medium">AI 视频引擎渲染中...</span>
                                                    </div>
                                                </div>
                                            )}

                                            {!shot.video_url && shot.status !== 'generating_video' && (
                                                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300 gap-2">
                                                    <div className="w-10 h-10 rounded-full border border-dashed border-slate-300 flex items-center justify-center">
                                                        <Video size={16} className="opacity-50" />
                                                    </div>
                                                    <span className="text-[10px]">等待生成</span>
                                                </div>
                                            )}
                                        </div>
                                         <p className="text-[10px] text-slate-300 px-1 truncate">
                                            {shot.video_url ? "已生成 00:04 秒视频" : "等待加入队列..."}
                                         </p>
                                    </div>

                                </div>
                            ))
                        ) : (
                             <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <Clapperboard size={48} className="mb-4 opacity-20" />
                                <p>暂无分镜数据</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // === Storyboard Tab Content ===
                <div className="p-8 max-w-4xl mx-auto">
                    {isAnalyzing ? (
                        <div className="flex flex-col items-center justify-center py-24 space-y-6 animate-in fade-in duration-500">
                             <div className="relative">
                                 <div className="absolute inset-0 bg-cyan-100 rounded-full blur-xl animate-pulse"></div>
                                 <div className="w-16 h-16 border-4 border-cyan-200 border-t-cyan-500 rounded-full animate-spin relative z-10"></div>
                             </div>
                             <div className="text-center space-y-2">
                                 <h3 className="text-lg font-bold text-slate-900">正在智能拆解剧本...</h3>
                                 <p className="text-slate-500 text-sm">AI 正在识别人物、场景，并构建分镜画面</p>
                             </div>
                             <div className="flex gap-2 mt-4">
                                <span className="w-2 h-2 rounded-full bg-cyan-200 animate-bounce delay-0"></span>
                                <span className="w-2 h-2 rounded-full bg-cyan-200 animate-bounce delay-150"></span>
                                <span className="w-2 h-2 rounded-full bg-cyan-200 animate-bounce delay-300"></span>
                             </div>
                        </div>
                    ) : (!chapter.shots || chapter.shots.length === 0) ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                             <Clapperboard size={48} className="mb-4 opacity-20" />
                             <p>暂无分镜数据</p>
                             <p className="text-sm mt-2 opacity-60">请先进行「分镜绘制」分析</p>
                        </div>
                    ) : (
                        <div className="relative pl-4 space-y-8">
                            {/* Central Timeline */}
                            <div className="absolute left-[23px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-cyan-200 via-cyan-100 to-transparent"></div>

                            {[...chapter.shots]
                                .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
                                .map((shot: any, i: number) => (
                                <div key={i} className="relative pl-12 group">
                                    {/* Timeline Node - Numbered */}
                                    <div className="absolute left-0 top-7 w-12 flex justify-center z-10">
                                        <div className="w-7 h-7 rounded-full bg-white border border-slate-200 ring-4 ring-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 font-mono shadow-lg group-hover:text-cyan-500 group-hover:border-cyan-300 transition-all">
                                            {String(i + 1).padStart(2, '0')}
                                        </div>
                                    </div>

                                    {/* Shot Card */}
                                    <div className="glass-panel p-5 rounded-2xl border border-slate-200 hover:bg-slate-100 hover:border-cyan-200 transition-all duration-300 group-hover:translate-x-1 relative">
                                        {/* Action Buttons - Top Right */}
                                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20">
                                            {/* 重新生成分镜 */}
                                            <button
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     setConfirmConfig({
                                                         isOpen: true,
                                                         title: '重新生成分镜',
                                                         message: '确定要重新生成该分镜吗？\n将重新生成旁白和提示词。',
                                                         type: 'warning',
                                                         onConfirm: async () => {
                                                            setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                                            const shotId = shot.id;
                                                            setRegeneratingPrompts(prev => new Set(prev).add(shotId));
                                                            try {
                                                                await onRegenerateShotPrompt?.(shotId);
                                                            } finally {
                                                                setRegeneratingPrompts(prev => {
                                                                    const next = new Set(prev);
                                                                    next.delete(shotId);
                                                                    return next;
                                                                });
                                                            }
                                                         }
                                                     });
                                                 }}
                                                disabled={regeneratingPrompts.has(shot.id)}
                                                className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg border border-amber-200 hover:border-amber-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-amber-500/20"
                                                title="重新生成分镜"
                                            >
                                                <RefreshCw size={14} className={regeneratingPrompts.has(shot.id) ? 'animate-spin' : ''} />
                                            </button>
                                            {/* 重新生成图片 */}
                                             <button
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     setConfirmConfig({
                                                         isOpen: true,
                                                         title: '重新生成图片',
                                                         message: '确定要重新生成该分镜的图片吗？\n将基于现有提示词加入生成队列。',
                                                         type: 'warning',
                                                         onConfirm: async () => {
                                                            setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                                            const shotId = shot.id;
                                                            setRegeneratingImages(prev => new Set(prev).add(shotId));
                                                            try {
                                                                await onRegenerateShotImage?.(shotId);
                                                            } finally {
                                                                setRegeneratingImages(prev => {
                                                                    const next = new Set(prev);
                                                                    next.delete(shotId);
                                                                    return next;
                                                                });
                                                            }
                                                         }
                                                     });
                                                 }}
                                                disabled={regeneratingImages.has(shot.id) || ['queued', 'processing', 'generating'].includes(shot.status)}
                                                className={`p-1.5 rounded-lg border transition-all shadow-lg ${
                                                    (regeneratingImages.has(shot.id) || ['queued', 'processing', 'generating'].includes(shot.status))
                                                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-50'
                                                    : 'bg-purple-50 hover:bg-purple-100 text-purple-600 border-purple-200 hover:border-purple-300 hover:shadow-purple-500/20'
                                                }`}
                                                title="重新生成图片"
                                            >
                                                <ImageIcon size={14} className={regeneratingImages.has(shot.id) ? 'animate-pulse' : ''} />
                                            </button>
                                            
                                            {/* 取消生成 (仅在队列或生成中显示) */}
                                            {['queued', 'processing', 'generating'].includes(shot.status) && (
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        const shotId = shot.id;
                                                        setCancellingImages(prev => new Set(prev).add(shotId));
                                                        try {
                                                            await onCancelShotImage?.(shotId);
                                                        } finally {
                                                            setCancellingImages(prev => {
                                                                const next = new Set(prev);
                                                                next.delete(shotId);
                                                                return next;
                                                            });
                                                        }
                                                    }}
                                                    disabled={cancellingImages.has(shot.id)}
                                                    className="p-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg border border-red-200 hover:border-red-300 transition-all opacity-0 group-hover:opacity-100 shadow-lg hover:shadow-red-500/20"
                                                    title="取消生成"
                                                >
                                                    <X size={14} className={cancellingImages.has(shot.id) ? 'animate-spin' : ''} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex flex-col md:flex-row gap-6">
                                            {/* Thumbnail Area */}
                                            <div 
                                                className="w-full md:w-48 aspect-video shrink-0 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden relative group/img cursor-pointer"
                                            >
                                                {['queued', 'processing', 'generating'].includes(shot.status) ? (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-cyan-50 gap-3 relative overflow-hidden">
                                                        {/* Animated Background */}
                                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-200 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>

                                                        <div className="relative z-10">
                                                            <div className="w-10 h-10 rounded-full border-2 border-cyan-200 border-t-cyan-500 animate-spin"></div>
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <RefreshCw size={14} className="text-cyan-500 animate-pulse" />
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-center z-10">
                                                            <span className="text-cyan-600 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                                                                {shot.status === 'processing' ? '正在绘画...' : '排队中...'}
                                                            </span>
                                                            <span className="text-cyan-500/50 text-[9px] mt-1">
                                                                {shot.status === 'processing' ? 'AI 计算中' : '等待资源'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <ImageWithPreview 
                                                        src={shot.image_url || undefined} 
                                                        alt="Shot preview" 
                                                        className="transition-transform duration-700 group-hover/img:scale-105"
                                                        showIcon={!!shot.image_url}
                                                    />
                                                )}

                                                {/* Status Badge */}
                                                <div className="absolute top-2 left-2 pointer-events-none">
                                                    {(shot.status === 'completed' || shot.status === 'ready' || (shot.image_url && shot.status !== 'error')) ? (
                                                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 backdrop-blur-md border border-slate-200 text-[10px] font-medium text-emerald-500 shadow-lg">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                            就绪
                                                        </span>
                                                    ) : shot.status === 'error' ? (
                                                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-50 backdrop-blur-md border border-red-200 text-[10px] font-medium text-red-500 shadow-lg">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                                            错误
                                                        </span>
                                                    ) : !['queued', 'processing', 'generating'].includes(shot.status) && (
                                                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 backdrop-blur-md border border-slate-200 text-[10px] font-medium text-amber-600 shadow-lg">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                                            等待中
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Info Area */}
                                            <div className="flex-1 space-y-4 pt-1 md:pt-0">
                                                {/* Narration */}
                                                <div>
                                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2 pr-20">
                                                        <div className="flex items-center gap-2">
                                                            <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                                                            旁白 / 台词
                                                        </div>
                                                    </h4>
                                                    <p className="text-slate-800 text-sm leading-relaxed font-medium whitespace-pre-wrap">
                                                        {shot.narration ? shot.narration.split('\n').map((line: string) => line.trim()).join('\n') : <span className="text-slate-400 italic">无旁白</span>}
                                                    </p>
                                                </div>

                                                {/* Prompt */}
                                                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                        <Sparkles size={10} className="text-purple-400" />
                                                        画面描述
                                                    </h4>
                                                    <p className="text-slate-500 text-xs leading-relaxed font-mono line-clamp-3 hover:line-clamp-none transition-all cursor-text select-text">
                                                        {shot.image_prompt || "等待生成..."}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>

      {/* 全片预览弹窗 */}
      <VideoPreviewModal 
          isOpen={showFullPreview}
          onClose={() => setShowFullPreview(false)}
          segments={previewSegments}
          chapterTitle={`第 ${chapter.number} 章：${chapter.title} - 全片预览`}
          downloadUrl={videoUrl}
      />

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
