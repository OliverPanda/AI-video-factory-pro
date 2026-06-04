import { useState, useRef, useEffect } from 'react';
import { X, Upload, Loader2, User, Mic, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Character, Voice } from '../types/drama';
import ImageWithPreview from './ImageWithPreview';
import ConfirmModal from './ConfirmModal';

interface CharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Character> & { avatarFile?: File; referenceFiles?: File[] }) => Promise<void>;
  initialData?: Character | null;
  projectId: string;
  voices: Voice[];
}

export default function CharacterModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  voices
}: CharacterModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Multi-reference images
  const [referencePreviews, setReferencePreviews] = useState<string[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  

  const fileInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name);
        setDescription(initialData.description || '');
        setPrompt(initialData.prompt || '');
        setVoiceId(initialData.voiceId || '');
        setAvatarPreview(initialData.avatarUrl);
        // 兼容新版 {url: string}[] 和旧版 string[]
        const rawRefs = initialData.referenceImages || (initialData as any).reference_images || [];
        const urls = Array.isArray(rawRefs) 
            ? rawRefs.map(img => typeof img === 'string' ? img : img.url)
            : [];
        setReferencePreviews(urls);
      } else {
        setName('');
        setDescription('');
        setPrompt('');
        setVoiceId('');
        setAvatarPreview(null);
        setReferencePreviews([]);
      }
      setSelectedFile(null);
      setReferenceFiles([]);
      setGenerating(false);
    }
  }, [isOpen, initialData]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleReferenceSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
          const newFiles = Array.from(files);
          setReferenceFiles(prev => [...prev, ...newFiles]);
          
          const newPreviews = newFiles.map(f => URL.createObjectURL(f));
          setReferencePreviews(prev => [...prev, ...newPreviews]);
      }
  };

  const handleGenerateReferences = async () => {
    if (!initialData?.id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/characters/${initialData.id}/generate-reference-images`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.generated_urls) {
            setReferencePreviews(prev => [...prev, ...data.generated_urls]);
        }
      } else {
        const err = await res.json();
        // Assume alert is global or okay to use here, matching existing code
        alert('生成失败: ' + (err.detail || '未知错误'));
      }
    } catch (error) {
       console.error(error);
       alert('请求失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleRemoveReference = (idx: number) => {
    setReferencePreviews(prev => prev.filter((_, i) => i !== idx));
    // Also remove from new files if this index maps to a file
    const existingCount = (initialData?.referenceImages || (initialData as any)?.reference_images || []).length;
    if (idx >= existingCount) {
      const fileIdx = idx - existingCount;
      setReferenceFiles(prev => prev.filter((_, i) => i !== fileIdx));
    }
  };

  const handleClearReferences = () => {
      setConfirmConfig({
          isOpen: true,
          title: '清除参考图',
          message: '确定清除所有参考图吗？',
          onConfirm: () => {
              setReferencePreviews([]);
              setReferenceFiles([]);
              setConfirmConfig(prev => ({ ...prev, isOpen: false }));
          }
      });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    
    setSaving(true);
    try {
      // Filter out blob URLs from referencePreviews to get the list of "kept" existing URLs
      const keptUrls = referencePreviews.filter(url => !url.startsWith('blob:'));
      
      await onSave({
        name,
        description,
        prompt,
        voiceId,
        avatarFile: selectedFile || undefined,
        referenceFiles: referenceFiles,
        referenceImages: keptUrls // Send plain string URLs, backend expects list[str]
      });
      onClose();
    } catch (error) {
      console.error('Failed to save character:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            {initialData ? '编辑人物' : '添加人物'}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Avatar Upload */}
          <div className="flex items-center gap-6">
            <div 
              className="relative w-24 h-24 rounded-full bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center overflow-hidden cursor-pointer group hover:border-cyan-500/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarPreview ? (
                <ImageWithPreview 
                  src={avatarPreview} 
                  alt="Avatar" 
                  className="w-full h-full object-cover" 
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <User className="text-slate-400 group-hover:text-cyan-500" size={32} />
              )}
              <div className="absolute inset-0 bg-slate-900/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <Upload className="text-white" size={20} />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-slate-900 mb-1">人物头像 (主图)</h3>
              <p className="text-xs text-slate-500 mb-2">建议尺寸 512x512</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-slate-50 text-xs text-slate-600 rounded border border-slate-200 hover:bg-slate-200"
              >
                更换头像
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handleFileSelect}
              />
            </div>
          </div>

          {/* New: Reference Images */}
          <div>
              <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-slate-900">参考图 (多角度/表情)</h3>
                  <div className="flex items-center gap-2">
                    {initialData?.id && (
                        <button
                            onClick={handleGenerateReferences}
                            disabled={generating || !avatarPreview}
                            className="flex items-center gap-1 text-xs text-cyan-500 hover:text-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={!avatarPreview ? "请先上传头像" : "AI自动生成"}
                        >
                             {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                             一键生成
                        </button>
                    )}
                    {referencePreviews.length > 0 && (
                        <button onClick={handleClearReferences} className="text-xs text-red-500 hover:text-red-600">
                            清除全部
                        </button>
                    )}
                  </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                  {referencePreviews.map((url, idx) => (
                      <div key={idx} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 group">
                          <ImageWithPreview 
                            src={url} 
                            alt={`Ref ${idx}`} 
                            className="w-full h-full object-cover" 
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveReference(idx); }}
                            className="absolute top-1 right-1 p-1 bg-slate-100 rounded-full text-slate-600 hover:text-red-500 hover:bg-slate-200 opacity-0 group-hover:opacity-100 transition-all z-10"
                            title="删除此参考图"
                          >
                            <Trash2 size={12} />
                          </button>
                      </div>
                  ))}
                  <button 
                    onClick={() => refInputRef.current?.click()}
                    className="aspect-[4/3] rounded-lg border border-dashed border-slate-300 flex flex-col items-center justify-center hover:bg-slate-50 hover:border-cyan-500/50 transition-all text-slate-400 hover:text-cyan-500"
                  >
                      <Plus size={20} className="mb-1" />
                      <span className="text-[10px]">添加</span>
                  </button>
              </div>
              <p className="text-xs text-slate-400">上传多张参考图可提高角色一致性。建议包含不同角度。</p>
              <input 
                type="file" 
                ref={refInputRef} 
                className="hidden" 
                accept="image/*"
                multiple
                onChange={handleReferenceSelect}
              />
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">人物名称 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                placeholder="例如：林晓"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">人物描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 resize-none focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                placeholder="例如：25岁，职场新人，性格乐观..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">
                <div className="flex items-center gap-2">
                  <Mic size={14} />
                  关联配音
                </div>
              </label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 appearance-none"
              >
                <option value="">选择配音...</option>
                {voices.map(voice => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.voiceType})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-slate-200">
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
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type="warning"
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
