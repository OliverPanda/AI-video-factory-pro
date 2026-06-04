import { useState, useRef, useEffect } from 'react';
import { Edit3, ImagePlus, Archive, Trash2, Clock, ZoomIn, X } from 'lucide-react';
import ImageWithPreview from './ImageWithPreview';

interface Project {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  style?: string;
  lora_model?: string;
  lora_strength?: number;
  status?: string;
  archiveStatus?: string; // active, archived
  duration?: string;
  resolution?: string;
  progress?: number;
  chapterCount?: number;  // 章节数量
}

interface ProjectCardProps {
  project: Project;
  view?: 'grid' | 'list'; // 显示模式：网格或列表
  onClick?: () => void; // 点击卡片进入详情的回调
  onUpdate?: (updates: { name?: string; description?: string; style?: string; lora_model?: string; lora_strength?: number; coverImage?: File }) => void; // 更新项目属性的回调
  onArchive?: () => void; // 归档/取消归档的回调
  onDelete?: () => void; // 删除项目的回调
  onRefresh?: () => void;
}

import { PROJECT_STYLES, type StyleConfig } from '../constants/styles';

// 项目状态对应的样式映射
const statusStyles: Record<string, string> = {
  '处理中': 'bg-amber-100 text-amber-700 border-amber-300 animate-pulse',
  '已完成': 'bg-emerald-100 text-emerald-700 border-emerald-300',
  '等待中': 'bg-slate-100 text-slate-500 border-slate-300',
  '待处理': 'bg-violet-100 text-violet-700 border-violet-300',
  'archived': 'bg-slate-100 text-slate-500 border-slate-300',
};

export default function ProjectCard({ 
  project,
  view = 'grid',
  onClick, 
  onUpdate,
  onArchive,
  onDelete,
}: ProjectCardProps) {
  const status = project.status || '待处理';
  const isArchived = project.archiveStatus === 'archived';
  
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description || '');
  const [editStyle, setEditStyle] = useState(project.style || '短剧');
  const [previewCover, setPreviewCover] = useState<string | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  
  const [styles, setStyles] = useState<StyleConfig[]>(PROJECT_STYLES);
  const [previewStyle, setPreviewStyle] = useState<StyleConfig | null>(null);

  useEffect(() => {
    if (showSettingsModal) {
      setEditName(project.name);
      setEditDescription(project.description || '');
      setEditStyle(project.style || '短剧');
      setPreviewCover(null);
      setSelectedCoverFile(null);
      
      // Fetch dynamic styles with preview images
      const fetchStyles = async () => {
        try {
          const response = await fetch('/api/projects/styles');
          if (response.ok) {
            const data = await response.json();
            setStyles(data);
          }
        } catch (error) {
          console.error('Failed to fetch styles:', error);
        }
      };
      fetchStyles();
    }
  }, [showSettingsModal, project]);

  // 保存项目设置修改
  const handleSaveSettings = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {};
    // 检查是否有实质性的修改
    if (editName.trim() && editName !== project.name) {
      updates.name = editName.trim();
    }
    if (editDescription !== (project.description || '')) {
        updates.description = editDescription;
    }
    if (editStyle !== project.style) {
      updates.style = editStyle;
      // 当风格改变时，清空显式的 LoRA 设置，触发后端回退
      updates.lora_model = null;
      updates.lora_strength = 1.0;
    }
    if (selectedCoverFile) {
      updates.coverImage = selectedCoverFile;
    }

    if (Object.keys(updates).length > 0) {
      onUpdate?.(updates);
    }
    setShowSettingsModal(false);
  };

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 即时预览
      const objectUrl = URL.createObjectURL(file);
      setPreviewCover(objectUrl);
      setSelectedCoverFile(file);
    }
    if (coverInputRef.current) {
      coverInputRef.current.value = '';
    }
  };

  // 点击卡片时，如果有弹窗打开则不导航
  const handleCardClick = () => {
    if (showSettingsModal) {
      return;
    }
    // Block navigation if archived
    if (isArchived) {
      return;
    }
    onClick?.();
  };

  // ... (previous logic)

  // Render content based on view
  const renderCard = () => {
    if (view === 'grid') {
      return (
        <div 
          className={`glass-card glow-border group relative flex flex-col overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${isArchived ? 'grayscale opacity-75' : ''}`}
          onClick={handleCardClick}
        >
          {/* Cover Image Area */}
          <div className="relative aspect-video bg-gradient-to-br from-cyan-50 via-teal-50 to-emerald-50 overflow-hidden">
             {previewCover || project.coverUrl ? (
              <img 
                src={previewCover || project.coverUrl || ''} 
                alt={project.name}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
            ) : (
              <div 
                className="absolute inset-0 flex items-center justify-center group/play cursor-pointer"
              >
                <span className="text-6xl font-bold text-slate-100/50 select-none font-heading group-hover:text-slate-200/50 transition-colors duration-300">
                  {project.name.charAt(0)}
                </span>
              </div>
            )}
            
            {/* Status Badge */}
            <div className={`absolute top-3 left-3 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded-full border backdrop-blur-md shadow-lg ${isArchived ? statusStyles['archived'] : statusStyles[status]}`}>
              {isArchived ? '已归档' : status}
            </div>

          {/* Hover Gradient Overlay */}
            <div className={`absolute inset-0 bg-gradient-to-t from-slate-200/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}></div>
          </div>

          {/* Content Area */}
          <div className="p-4 flex flex-col relative h-[180px]">
             {/* Title & Style Row */}
             <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-slate-900 leading-tight truncate flex-1" title={project.name}>
                  {project.name}
                </h3>
                {project.style && (
                  <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-600 font-medium">
                    {project.style}
                  </span>
                )}
             </div>
             
             {/* Description */}
             <p className="text-slate-500 text-xs line-clamp-2 mb-4 h-8 leading-relaxed">
               {project.description || '暂无描述信息...'}
             </p>

             {/* Footer Info & Actions */}
             <div className="mt-auto flex items-center justify-between pt-3 border-t border-slate-200">
                {/* Meta Info */}
                <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium">
                   {project.chapterCount !== undefined && project.chapterCount > 0 && (
                     <div className="flex items-center gap-1.5" title={`${project.chapterCount} 个章节`}>
                       <span className="text-slate-300">📖</span>
                       <span>{project.chapterCount}章</span>
                     </div>
                   )}
                   <div className="flex items-center gap-1.5" title="预计总时长">
                      <Clock size={11} className="text-slate-300" />
                      <span>{project.duration || '0:00'}</span>
                   </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isArchived) {
                          setEditName(project.name);
                          setEditDescription(project.description || '');
                          setEditStyle(project.style || '短剧');
                          setShowSettingsModal(true);
                        }
                      }}
                      disabled={isArchived}
                      className={`p-2 rounded-lg transition-all duration-200 ${
                        isArchived
                          ? 'text-slate-300 cursor-not-allowed'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 hover:shadow-sm'
                      }`}
                      title={isArchived ? "归档项目不可编辑" : "编辑项目"}
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchive?.();
                      }}
                      className={`p-2 rounded-lg transition-all duration-200 ${
                         isArchived
                          ? 'text-teal-500 bg-teal-50 hover:bg-teal-100'
                          : 'text-slate-500 hover:text-cyan-500 hover:bg-cyan-50 hover:shadow-sm'
                      }`}
                      title={isArchived ? "取消归档" : "归档项目"}
                    >
                      <Archive size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.();
                      }}
                      className="p-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-100 hover:shadow-sm transition-all duration-200"
                      title="删除项目"
                    >
                      <Trash2 size={16} />
                    </button>
                </div>
             </div>
          </div>
        </div>
      );

    } 
    
    // List View
    return (
      <div 
        className={`glass-card p-3 flex items-center gap-4 cursor-pointer group hover:bg-slate-100 transition-all ${
          isArchived ? 'grayscale opacity-75' : ''
        }`}
        onClick={handleCardClick}
      >
        {/* Thumbnail */}
        <div className="relative w-32 aspect-video rounded-lg overflow-hidden flex-shrink-0 bg-slate-200">
          <ImageWithPreview 
            src={previewCover || project.coverUrl || undefined} 
            alt={project.name}
            showIcon={false}
            onClick={(e) => {
              if (isArchived) return;
              e.stopPropagation();
            }}
          />
          {status === '处理中' && (
             <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-100/50">
               <div className="h-full progress-neon" style={{ width: `${project.progress}%` }}></div>
             </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
             <h3 className="font-medium text-slate-800 truncate">{project.name}</h3>
             <span className={`text-[10px] px-1.5 py-0.5 rounded border ${isArchived ? statusStyles['archived'] : statusStyles[status]}`}>
               {isArchived ? '已归档' : status}
             </span>
          </div>
          <p className="text-xs text-slate-400 truncate mb-2">{project.description || '暂无描述'}</p>
          <div className="flex items-center gap-4 text-xs text-slate-300">
             <span className="flex items-center gap-1"><Clock size={10} /> {project.duration || '--'}</span>
             <span>{project.resolution || 'HD'}</span>
             {project.style && <span className="text-cyan-500">{project.style}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity px-2">
           <button 
             onClick={(e) => { e.stopPropagation(); setEditName(project.name); setShowSettingsModal(true); }}
             className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg"
             title="编辑"
             disabled={isArchived}
           >
              <Edit3 size={16} />
           </button>
           <button
             onClick={(e) => { e.stopPropagation(); onArchive?.(); }}
             className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg"
             title={isArchived ? '取消归档' : '归档'}
           >
              <Archive size={16} />
           </button>
           <button 
             onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
             className="p-2 text-red-500 hover:bg-red-100 rounded-lg"
             title="删除"
           >
              <Trash2 size={16} />
           </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderCard()}

      {/* Hidden file input */}
      <input 
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCoverSelect}
      />

      {/* Settings Modal - Shared */}
      {showSettingsModal && (
        <div 
          className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowSettingsModal(false)}
        >
          <div 
            className="glass-card w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">项目设置</h2>
            </div>
            <div className="p-5 space-y-5">
              {/* 项目名称 */}
              <div>
                <label className="block text-sm text-slate-500 mb-2">项目名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="输入项目名称"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  autoFocus
                />
              </div>

              {/* 项目描述 */}
              <div>
                 <label className="block text-sm text-slate-500 mb-2">项目描述</label>
                 <textarea
                   value={editDescription}
                   onChange={(e) => setEditDescription(e.target.value)}
                   placeholder="输入故事梗概或项目描述..."
                   rows={3}
                   className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 resize-none"
                 />
              </div>
              
              {/* 风格选择 */}
              <div>
                <label className="block text-sm text-slate-500 mb-2">项目风格</label>
                <div className="grid grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                  {styles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setEditStyle(s.name);
                      }}
                      className={`
                        relative flex flex-col items-start p-3 rounded-xl border-2 transition-all duration-300
                        ${editStyle === s.name
                          ? 'border-cyan-500 bg-cyan-50'
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}
                      `}
                    >
                      <div className="group/img relative w-full h-12 rounded-lg mb-2 overflow-hidden bg-slate-200">
                        {(s as any).previewImage ? (
                          <>
                            <img 
                              src={(s as any).previewImage} 
                              alt={s.name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110"
                              onError={(e) => {
                                (e.target as any).style.display = 'none';
                                (e.target as any).parentElement.classList.add('bg-gradient-to-br', ...s.previewColor.split(' '));
                              }}
                            />
                            <div 
                              className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center cursor-zoom-in"
                              onClick={(e) => { e.stopPropagation(); setPreviewStyle(s); }}
                            >
                              <ZoomIn size={16} className="text-slate-900 drop-shadow-lg" />
                            </div>
                          </>
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${s.previewColor} opacity-40 group-hover/img:opacity-60 transition-opacity`}></div>
                        )}
                      </div>
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-xs font-bold ${editStyle === s.name ? 'text-slate-900' : 'text-slate-500'}`}>
                          {s.name}
                        </span>
                        {editStyle === s.name && (
                          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                        )}
                      </div>
                      {s.description && (
                        <p className="text-xs text-slate-400 mt-1 text-left line-clamp-1">{s.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* 封面上传 */}
              <div>
                <label className="block text-sm text-slate-500 mb-2">项目封面</label>
                
                {(previewCover || project.coverUrl) && (
                  <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 mb-3 group">
                     <img 
                      src={previewCover || project.coverUrl || ''} 
                      alt="封面预览" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <button
                  onClick={() => coverInputRef.current?.click()}
                  className="w-full px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-colors flex items-center justify-center gap-2"
                >
                  <ImagePlus size={18} />
                  {previewCover || project.coverUrl ? '更换新封面' : '点击上传新封面'}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 text-slate-500 hover:text-slate-900 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={!editName.trim()}
                className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Style Preview Lightbox */}
      {previewStyle && (previewStyle as any).previewImage && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-white/95 backdrop-blur-md animate-in fade-in duration-200 cursor-pointer"
          onClick={() => setPreviewStyle(null)}
        >
          <div
            className="relative max-w-2xl w-full animate-in zoom-in-90 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={(previewStyle as any).previewImage}
              alt={previewStyle?.name}
              className="w-full rounded-2xl shadow-2xl object-contain max-h-[75vh]"
            />
            <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-slate-900/10 to-transparent rounded-b-2xl">
              <h3 className="text-lg font-bold text-slate-900">{previewStyle?.name}</h3>
              <p className="text-sm text-slate-600 mt-1">{previewStyle?.description}</p>
            </div>
            <button
              className="absolute top-3 right-3 p-2 bg-white/80 hover:bg-white/90 text-slate-900 rounded-full transition-colors"
              onClick={() => setPreviewStyle(null)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
