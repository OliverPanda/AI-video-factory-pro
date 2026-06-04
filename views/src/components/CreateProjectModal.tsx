import { useState, useRef, useEffect } from 'react';
import { X, ImagePlus, Loader2, RefreshCw, ZoomIn } from 'lucide-react';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreate: (data: any) => Promise<void>;
}
import { PROJECT_STYLES as DEFAULT_STYLES, type StyleConfig } from '../constants/styles';

export default function CreateProjectModal({ isOpen, onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState(DEFAULT_STYLES[0].name);
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [previewCover, setPreviewCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [styles, setStyles] = useState<StyleConfig[]>(DEFAULT_STYLES);
  const [previewStyle, setPreviewStyle] = useState<StyleConfig | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch styles from backend
  useEffect(() => {
    if (isOpen) {
      const fetchStyles = async () => {
        try {
          const response = await fetch('/api/projects/styles');
          if (response.ok) {
            const data = await response.json();
            setStyles(data);
            if (data.length > 0) {
              setStyle(data[0].name);
            }
          }
        } catch (error) {
          console.error('Failed to fetch styles:', error);
        }
      };
      
      fetchStyles();
      
      setName('');
      setDescription('');
      setCoverImage(null);
      setPreviewCover(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        style,
        coverImage: coverImage || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create project:', error);
      // Keep modal open on error ideally, or show toast
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverImage(file);
      const url = URL.createObjectURL(file);
      setPreviewCover(url);
    }
  };
  
  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-white/95 backdrop-blur-md animate-in fade-in duration-300"
      onClick={handleBackdropClick}
    >
      <div 
        className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-wide">新建项目</h2>
            <p className="text-xs text-slate-500 mt-0.5">创建一个新的 AI 短剧项目，开始你的创作之旅</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col md:flex-row h-full max-h-[80vh] min-h-0">
          {/* Left: Cover Image Upload */}
          <div className="w-full md:w-5/12 p-8 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
            <label className="text-sm font-medium text-slate-600">
              项目封面 <span className="text-slate-400 text-xs font-normal ml-1">(可选)</span>
            </label>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`
                group relative w-full aspect-[3/4] rounded-xl border-2 border-dashed 
                ${previewCover ? 'border-slate-300' : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-100'}
                transition-all cursor-pointer overflow-hidden flex flex-col items-center justify-center gap-3
              `}
            >
              {previewCover ? (
                <>
                  <img 
                    src={previewCover} 
                    alt="Cover preview" 
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                    <RefreshCw size={24} className="text-slate-900" />
                    <span className="text-xs font-medium text-slate-900">点击更换封面</span>
                  </div>
                </>
              ) : (
                <>
                   <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-500 group-hover:text-teal-500 group-hover:bg-teal-50 transition-colors">
                      <ImagePlus size={28} />
                   </div>
                   <div className="text-center">
                      <p className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors">点击上传图片</p>
                      <p className="text-xs text-slate-400 mt-1">支持 JPG, PNG, WEBP</p>
                   </div>
                </>
              )}
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
            </div>
            
            <div className="text-xs text-center text-slate-400">
              建议尺寸: 1080x1920 (9:16) 或 1920x1080 (16:9)
            </div>
          </div>

          {/* Right: Form Fields */}
          <div className="w-full md:w-7/12 flex flex-col min-h-0">
             <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8">
                
                {/* Project Name */}
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-medium text-slate-600 block">
                    项目名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="输入精彩的短剧名称..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all font-medium"
                    autoFocus
                    required
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label htmlFor="description" className="text-sm font-medium text-slate-600 block">
                    剧情简介
                  </label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="简要描述故事背景、核心冲突或主要人物..."
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all resize-none text-sm leading-relaxed"
                  />
                </div>

                {/* Style Selector */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-600 block">
                    选择风格
                  </label>
                  <div className="grid grid-cols-2 gap-3 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
                    {styles.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setStyle(s.name);
                        }}
                        className={`
                          relative flex flex-col items-start p-3 rounded-xl border-2 transition-all duration-300
                          ${style === s.name
                            ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500/30'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'}
                        `}
                      >
                        {/* Preview Image or Gradient */}
                        <div className="group/img relative w-full h-16 rounded-lg mb-2 overflow-hidden bg-slate-200">
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
                                <ZoomIn size={18} className="text-slate-900 drop-shadow-lg" />
                              </div>
                            </>
                          ) : (
                            <div className={`w-full h-full bg-gradient-to-br ${s.previewColor} opacity-40 group-hover:opacity-60 transition-opacity`}></div>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-sm font-bold ${style === s.name ? 'text-slate-900' : 'text-slate-600'}`}>
                            {s.name}
                          </span>
                          {style === s.name && (
                            <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(8,145,178,0.6)]"></div>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 text-left mt-1 leading-tight line-clamp-1">
                          {s.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>


             </form>

             {/* Footer */}
             <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || !name.trim()}
                  className="
                    px-7 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600
                    text-white text-sm font-bold rounded-xl shadow-lg shadow-cyan-500/20
                    hover:shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98]
                    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                    transition-all flex items-center gap-2
                  "
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? '创建中...' : '立即创建'}
                </button>
             </div>
          </div>
        </div>
      </div>
    </div>

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
