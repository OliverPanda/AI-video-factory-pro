import { useState } from 'react';
import { 
  Clapperboard, 
  Video, 

  FileText,
  Users,
  Image as ImageIcon,
  RefreshCw,
  MoreVertical,
  Loader2,
  Play
} from 'lucide-react';

import type { Chapter } from '../types/drama';

interface ChapterKanbanProps {
  chapters: Chapter[];
  onStatusChange: (chapterId: string, newStatus: string) => Promise<void>;
  onChapterClick: (chapter: Chapter) => void;
  onAnalyze: (chapter: Chapter) => void; // 触发分镜提示词生成
  onGoToStoryboard?: (chapter: Chapter) => void; // 进入工作台进行分镜出图
  onReanalyze: (chapter: Chapter) => void; // 重新分析章节（重新识别人物场景）
  onViewDetail?: (chapter: Chapter) => void;
  onGenerateVideo?: (chapter: Chapter) => Promise<void>; // 批量生成视频并合成成片
  onPlayVideo?: (chapter: Chapter) => void; // 播放已生成的成片视频
}

const STATUS_CONFIG = {
  draft: { 
    label: '📝 故事草稿',
    description: '导入小说或创建章节',
    icon: FileText,
    color: 'bg-slate-100 text-slate-500',
    border: 'border-slate-200'
  },
  analysis_completed: { 
    label: '🎨 分镜绘制',
    description: '调整画面与运镜',
    icon: Clapperboard,
    color: 'bg-purple-50 text-purple-600',
    border: 'border-purple-200'
  },
  video_completed: { 
    label: '🎥 成片制作',
    description: '合成最终视频',
    icon: Video,
    color: 'bg-emerald-50 text-emerald-500',
    border: 'border-emerald-200' 
  },
};

type StatusKey = keyof typeof STATUS_CONFIG;

// 定义看板显示的三个列状态
const COLUMNS: StatusKey[] = ['draft', 'analysis_completed', 'video_completed'];

export default function ChapterKanban({ chapters, onStatusChange: _onStatusChange, onAnalyze, onGoToStoryboard, onReanalyze, onViewDetail, onGenerateVideo, onPlayVideo }: ChapterKanbanProps) {
  const [renderingChapterId, setRenderingChapterId] = useState<string | null>(null);

  // getNextStatus removed

  return (
    <div className="grid grid-cols-3 gap-6 h-[calc(100vh-280px)] min-h-[500px] overflow-hidden">
      {COLUMNS.map((status) => {
        const config = STATUS_CONFIG[status];
        const columnChapters = chapters.filter(c => c.status === status || (status === 'draft' && !STATUS_CONFIG[c.status as StatusKey]));
        
        return (
          <div key={status} className="flex flex-col h-full bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
            {/* Column Header */}
            <div className={`p-4 border-b border-slate-200 flex items-center justify-between ${config.color.split(' ')[1]}`}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-semibold">
                  <config.icon size={18} />
                  {config.label}
                </div>
                <div className="text-[10px] opacity-60 pl-6">
                  {config.description}
                </div>
              </div>
              <span className="bg-slate-200 px-2 py-0.5 rounded-full text-xs self-start mt-0.5">
                {columnChapters.length}
              </span>
            </div>

            {/* Cards Container */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {columnChapters.map((chapter) => {
                
                return (
                  <div 
                    key={chapter.id}
                    onClick={() => onViewDetail && onViewDetail(chapter)}
                    className="group bg-white p-4 rounded-xl border border-slate-200 hover:border-cyan-300 transition-all hover:shadow-lg hover:shadow-cyan-500/10 cursor-pointer relative"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="px-2 py-1 rounded bg-slate-50 text-xs text-slate-500 font-mono">
                        第 {chapter.number} 章
                      </div>
                      <div className="flex gap-1">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                onReanalyze(chapter);
                            }}
                            className="text-slate-400 hover:text-cyan-500 p-1 hover:bg-slate-100 rounded transition-all"
                            title="重新识别人物与场景"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <button className="text-slate-400 hover:text-slate-900 transition-colors opacity-0 group-hover:opacity-100">
                            <MoreVertical size={16} />
                        </button>
                      </div>
                    </div>
                    
                    <h4 className="font-medium text-slate-900 mb-2 line-clamp-2 group-hover:text-cyan-500 transition-colors">
                      {chapter.title}
                    </h4>
                    
                    {chapter.hook && (
                      <p className="text-xs text-slate-500 line-clamp-2 mb-3 bg-slate-50 p-2 rounded">
                        {chapter.hook}
                      </p>
                    )}

                    {/* Emotions Display */}
                    {(() => {
                      if (!chapter.emotions_json) return null;
                      try {
                        const emotions = JSON.parse(chapter.emotions_json);
                        if (Array.isArray(emotions) && emotions.length > 0) {
                          return (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {emotions.slice(0, 3).map((emo: string, idx: number) => (
                                <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 border border-pink-200">
                                  #{emo}
                                </span>
                              ))}
                            </div>
                          );
                        }
                      } catch (e) {
                         return null;
                      }
                      return null;
                    })()}

                    {/* Metadata: Characters & Scenes */}
                    {/* Metadata Grid */}
                    <div className="space-y-3">
                        {/* Row 1: Word Count & Scenes */}
                        <div className="flex items-center justify-between text-xs text-slate-400">
                             {/* Word Count */}
                             {chapter.content && (
                                <div className="flex items-center gap-1.5">
                                    <FileText size={12} />
                                    <span>{chapter.content.length}字</span>
                                </div>
                             )}

                             {/* Scenes */}
                             {(() => {
                                 try {
                                     const scenes = chapter.scenes_json ? JSON.parse(chapter.scenes_json) : [];
                                     if (Array.isArray(scenes) && scenes.length > 0) {
                                         const firstScene = scenes[0];
                                         let displayName = '';
                                         let tooltip = '';
                                         
                                         if (typeof firstScene === 'string') {
                                             displayName = firstScene;
                                             tooltip = scenes.join(', ');
                                         } else if (typeof firstScene === 'object' && firstScene !== null) {
                                             displayName = firstScene.location || firstScene.desc || '场景';
                                             tooltip = scenes.map((s: any) => {
                                                 if (typeof s === 'string') return s;
                                                 return `${s.location || ''} ${s.time || ''}`.trim() || s.desc || '未知场景';
                                             }).join(', ');
                                         }

                                         return (
                                             <div className="flex items-center gap-1.5 text-cyan-500 bg-cyan-50 px-2 py-0.5 rounded-full max-w-[120px]" title={tooltip}>
                                                 <ImageIcon size={12} />
                                                 <span className="truncate">{displayName}</span>
                                             </div>
                                         );
                                     }
                                 } catch (e) {}
                                 return null;
                             })()}
                        </div>

                        {/* Row 2: Characters (Full Width) */}
                        {(() => {
                           try {
                             const chars = chapter.characters_json ? JSON.parse(chapter.characters_json) : [];
                             if (Array.isArray(chars) && chars.length > 0) {
                               const names = chars.map((c: any) => typeof c === 'string' ? c : c.name);
                               return (
                                 <div className="flex items-center gap-2 pt-2 border-t border-slate-200" title={names.join(', ')}>
                                   <div className="flex items-center justify-center min-w-[32px] h-6 px-1.5 rounded-full bg-cyan-50 border border-cyan-300 shrink-0">
                                       <Users size={12} className="text-cyan-500 mr-1" />
                                       <span className="text-xs font-medium text-cyan-600">{names.length}</span>
                                   </div>
                                   <span className="text-xs text-slate-400 truncate flex-1">{names.join(', ')}</span>
                                 </div>
                               );
                             }
                           } catch (e) {}
                           return null;
                        })()}
                    </div>

                    {/* Progress Bar (Only if active) */}
                    {chapter.progress !== undefined && chapter.progress > 0 && (
                        <div className="flex items-center gap-2 mb-4">
                          <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                              style={{ width: `${chapter.progress}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-cyan-500 font-mono">
                            {chapter.progress}%
                          </span>
                        </div>
                    )}

                    {/* Quick Actions based on Status */}
                    <div className="mt-4 space-y-2">
                      {status === 'draft' && (
                        <button
                          onClick={(e) => {
                              e.stopPropagation();
                              onAnalyze(chapter);
                          }}
                          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-cyan-500/10 bg-gradient-to-r from-cyan-600 to-teal-600 text-white hover:scale-[1.02] hover:shadow-cyan-500/25`}
                        >
                          <Clapperboard size={16} />
                          生成分镜提示词
                        </button>
                      )}
                      
                      {status === 'analysis_completed' && (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onGoToStoryboard && onGoToStoryboard(chapter);
                            }}
                            className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-all hover:border-slate-300"
                          >
                            <Clapperboard size={14} />
                            分镜出图
                          </button>
                          
                          <button 
                              onClick={async (e) => {
                                  e.stopPropagation();
                                  if (onGenerateVideo && renderingChapterId !== chapter.id) {
                                      setRenderingChapterId(chapter.id);
                                      try {
                                          await onGenerateVideo(chapter);
                                      } finally {
                                          setRenderingChapterId(null);
                                      }
                                  }
                              }}
                              disabled={renderingChapterId === chapter.id}
                              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg ${
                                  renderingChapterId === chapter.id
                                      ? 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none'
                                      : 'bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-400 hover:shadow-emerald-500/30'
                              }`}
                          >
                            {renderingChapterId === chapter.id ? (
                                <><Loader2 size={14} className="animate-spin" /> 合成中...</>
                            ) : (
                                <><Video size={14} /> 一键成片</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {status === 'video_completed' && (
                        <div className="mt-4 space-y-2">
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPlayVideo && onPlayVideo(chapter);
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"
                            >
                                <Play size={14} fill="currentColor" />
                                播放成片
                            </button>
                        </div>
                    )}
                  </div>
                );
              })}
              
              {columnChapters.length === 0 && (
                <div className="text-center py-10 text-slate-300 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                  {status === 'draft' ? '暂无章节' : '在此等候...'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
