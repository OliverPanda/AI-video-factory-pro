import { useState, useRef, useEffect } from 'react';
import { X, Upload, Loader2, Image as ImageIcon } from 'lucide-react';
import ImageWithPreview from './ImageWithPreview';

interface Scene {
  id: string;
  name: string;
  description?: string;
  imageUrl: string | null;
  prompt?: string;
}

interface SceneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Scene> & { imageFile?: File }) => Promise<void>;
  onDelete?: (sceneId: string) => Promise<void>;
  initialData?: Scene | null;
  projectId: string;
}

export default function SceneModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialData,
}: SceneModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name);
        setDescription(initialData.description || '');
        setPrompt(initialData.prompt || '');
        setImagePreview(initialData.imageUrl);
      } else {
        setName('');
        setDescription('');
        setPrompt('');
        setImagePreview(null);
      }
      setSelectedFile(null);
    }
  }, [isOpen, initialData]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    
    setSaving(true);
    try {
      await onSave({
        name,
        description,
        prompt,
        imageFile: selectedFile || undefined
      });
      onClose();
    } catch (error) {
      console.error('Failed to save scene:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="glass-card w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            {initialData ? '编辑场景' : '添加场景'}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Image Preview & Upload */}
            <div className="space-y-4">
              <div 
                className="relative aspect-video rounded-xl bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center overflow-hidden cursor-pointer group hover:border-cyan-500/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <ImageWithPreview 
                    src={imagePreview} 
                    alt="Scene" 
                    className="w-full h-full object-cover" 
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="text-center">
                    <ImageIcon className="mx-auto text-slate-400 group-hover:text-cyan-500 mb-2" size={48} />
                    <span className="text-xs text-slate-400 group-hover:text-slate-500">点击上传场景图</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-slate-900/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <Upload className="text-white" size={24} />
                </div>
              </div>
              
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 bg-slate-50 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-200 transition-colors"
              >
                更换图片
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handleFileSelect}
              />
            </div>

            {/* Right: Fields */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">场景名称 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                  placeholder="例如：摩天大楼天台"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">场景描述 (4 维结构)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 resize-none focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 text-sm leading-relaxed"
                  placeholder="时空：...\n环境：...\n物品：...\n镜头与氛围：..."
                />
                {description && (description.includes('时空：') || description.includes('环境：')) && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {description.split('\n').map((line, idx) => {
                      const label = line.split(/[：:]/)[0];
                      if (['时空', '环境', '物品', '镜头与氛围'].includes(label)) {
                        return (
                          <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-600 border border-cyan-200">
                            {label} 已定义
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">提示词 (Prompt)</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono text-xs resize-none focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                  placeholder="生成的英文提示词..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-slate-200">
          <div>
            {initialData && onDelete && (
              <button
                onClick={() => {
                   if (window.confirm('确定要删除这个场景吗？')) {
                     onDelete(initialData.id).then(() => onClose());
                   }
                }}
                className="px-4 py-2 text-red-500 hover:text-red-400 text-sm font-medium transition-colors"
              >
                删除场景
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-500 hover:text-slate-900 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium rounded-lg hover:shadow-lg hover:shadow-cyan-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
