import { useState } from 'react';
import { Plus, User, Mic, Trash2, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import ImageWithPreview from './ImageWithPreview';
import CharacterModal from './CharacterModal';
import ConfirmModal from './ConfirmModal';
import { useToast } from './ToastContext';

import type { Character, Voice } from '../types/drama';

interface CharacterListProps {
  projectId: string;
  characters: Character[];
  voices: Voice[];
  onRefresh: () => Promise<void>;
}

export default function CharacterList({
  projectId,
  characters,
  voices,
  onRefresh
}: CharacterListProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [generatingCharId, setGeneratingCharId] = useState<string | null>(null);
  const [generatingRefsId, setGeneratingRefsId] = useState<string | null>(null);
  const [isBatchGeneratingRefs, setIsBatchGeneratingRefs] = useState(false);

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
  const { toast } = useToast();

  const handleEdit = (char: Character) => {
    setSelectedCharacter(char);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setSelectedCharacter(null);
    setModalOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent, charId: string) => {
    e.stopPropagation();
    setConfirmConfig({
      isOpen: true,
      title: '删除角色',
      message: '确定要删除这个角色吗？',
      type: 'danger',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        try {
            const res = await fetch(`/api/characters/${charId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            toast('删除成功', 'success');
            await onRefresh();
        } catch (error) {
            toast('删除失败', 'error');
        }
      }
    });
  };

  const handleRegenerateAvatar = async (e: React.MouseEvent, charId: string, charName: string) => {
    e.stopPropagation();
    if (generatingCharId) return; // Prevent multiple simultaneous generations
    
    try {
        setGeneratingCharId(charId);
        toast(`正在为 ${charName} 生成立绘...`, 'info');
        
        const res = await fetch(`/api/characters/${charId}/generate-avatar`, {
            method: 'POST'
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || 'Generation failed');
        }
        
        toast(`${charName} 立绘生成成功`, 'success');
        await onRefresh();
    } catch (error: any) {
        console.error(error);
        toast(`生成失败: ${error.message || '未知错误'}`, 'error');
    } finally {
        setGeneratingCharId(null);
    }
  };

  const handleGenerateRefs = async (e: React.MouseEvent, charId: string, charName: string) => {
    e.stopPropagation();
    if (generatingRefsId) return;
    
    try {
        setGeneratingRefsId(charId);
        toast(`正在为 ${charName} 生成多角度参考图...`, 'info');
        
        const res = await fetch(`/api/characters/${charId}/generate-reference-images`, {
            method: 'POST'
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || '参考图生成失败');
        }
        
        toast(`${charName} 参考图生成成功`, 'success');
        await onRefresh();
    } catch (error: any) {
        console.error(error);
        toast(`生成失败: ${error.message || '未知错误'}`, 'error');
    } finally {
        setGeneratingRefsId(null);
    }
  };

  const handleBatchGenerate = async () => {
    if (isBatchGenerating) return;
    
    // Check if there are characters without avatars
    const missingAvatarCount = characters.filter(c => !c.avatarUrl).length;
    const isRegenerateAll = missingAvatarCount === 0;
    
    // Determine target count and action name
    const targetCount = isRegenerateAll ? characters.length : missingAvatarCount;
    const actionName = isRegenerateAll ? '重新生成所有' : '批量生成缺失';

    if (targetCount === 0) {
        toast('暂无角色可生成', 'info');
        return;
    }
    
    // confirm
    setConfirmConfig({
      isOpen: true,
      title: `${isRegenerateAll ? '重新生成' : '批量生成'}立绘`,
      message: `确定要${actionName}个立绘吗（共 ${targetCount} 个）？可能需要几分钟。理论上受ComfyUI负载均衡控制性能。`,
      type: 'warning',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        try {
            setIsBatchGenerating(true);
            toast(`开始${actionName}立绘...`, 'info');
            
            const url = `/api/characters/batch-generate-avatar?project_id=${projectId}${isRegenerateAll ? '&force=true' : ''}`;
            const res = await fetch(url, {
                method: 'POST'
            });
            
            if (!res.ok) throw new Error('Batch generation failed');
            
            const data = await res.json();
            toast(`成功生成 ${data.success_count} 个立绘`, 'success');
            await onRefresh();
        } catch (error) {
            console.error(error);
            toast('批量生成失败', 'error');
        } finally {
            setIsBatchGenerating(false);
        }
      }
    });
  };

  const handleBatchGenerateRefs = async () => {
    if (isBatchGeneratingRefs) return;

    // Filter characters with avatars
    const charsWithAvatar = characters.filter(c => c.avatarUrl);
    // Find those without references
    const charsMissingRefs = charsWithAvatar.filter(c => !c.referenceImages || c.referenceImages.length === 0);
    
    const isRegenerateAll = charsMissingRefs.length === 0 && charsWithAvatar.length > 0;
    const targetCount = isRegenerateAll ? charsWithAvatar.length : charsMissingRefs.length;

    if (targetCount === 0) {
        toast('没有符合生成条件的角码（需有主立绘）。', 'info');
        return;
    }

    setConfirmConfig({
      isOpen: true,
      title: '批量生成参考图（三视图）',
      message: `确定要为 ${targetCount} 个角色一键生成三视图吗？${isRegenerateAll ? '(所有角色已有参考图，将覆盖生成)' : ''} 可能耗时较长。`,
      type: 'warning',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        try {
            setIsBatchGeneratingRefs(true);
            toast('已启动批量生成任务...', 'info');
            
            const url = `/api/characters/batch-generate-references?project_id=${projectId}${isRegenerateAll ? '&force=true' : ''}`;
            const res = await fetch(url, { method: 'POST' });
            
            if (!res.ok) throw new Error('Batch refs generation failed');
            
            const data = await res.json();
            toast(`成功生成 ${data.success_count} 个角色的参考图`, 'success');
            await onRefresh();
        } catch (error) {
            console.error(error);
            toast('批量生成参考图失败', 'error');
        } finally {
            setIsBatchGeneratingRefs(false);
        }
      }
    });
  };

  const handleSave = async (data: Partial<Character> & { avatarFile?: File; referenceFiles?: File[] }) => {
    try {
      let avatarUrl = selectedCharacter?.avatarUrl;

      // 1. 上传主头像（如果有）
      if (data.avatarFile) {
        const formData = new FormData();
        formData.append('file', data.avatarFile);
        const uploadRes = await fetch('/api/upload/image', {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) throw new Error('Failed to upload avatar');
        const uploadData = await uploadRes.json();
        avatarUrl = uploadData.url;
      }

      // 2. 上传参考图（如果有）
      let methodReferenceImages = data.referenceImages || [];
      if (data.referenceFiles && data.referenceFiles.length > 0) {
          // Upload each file
          // Note: In real production we should use Promise.all or a batch endpoint.
          // For now simplest is mapped promises.
          const uploadPromises = data.referenceFiles.map(async (file) => {
              const formData = new FormData();
              formData.append('file', file);
              const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
              if (!res.ok) throw new Error('Reference upload failed');
              const d = await res.json();
              return d.url;
          });
          
          const uploadedUrls = await Promise.all(uploadPromises);
          methodReferenceImages = [...methodReferenceImages, ...uploadedUrls];
      }

      // 3. 构建数据
      const payload = {
        project_id: projectId,
        name: data.name,
        description: data.description || undefined,
        prompt: data.prompt || undefined,
        voice_id: data.voiceId || undefined,
        avatar_url: avatarUrl || undefined,
        reference_images: methodReferenceImages // Send plain string URLs, backend expects list[str]
      };

      // 4. 调用 API
      const url = selectedCharacter 
        ? `/api/characters/${selectedCharacter.id}`
        : '/api/characters';
      
      const method = selectedCharacter ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Failed to save character');

      // 5. 刷新列表
      await onRefresh();
      toast('人物保存成功', 'success');
      setModalOpen(false); // Close modal only on success
      
    } catch (error) {
      console.error('Save error:', error);
      toast('保存失败，请重试', 'error');
      throw error;
    }
  };

  const getVoiceName = (voiceId?: string) => {
    if (!voiceId) return null;
    const voice = voices.find(v => v.id === voiceId);
    return voice ? voice.name : '未知配音';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">人物管理</h2>
        <div className="flex items-center gap-3">
             <button
              onClick={handleBatchGenerateRefs}
              disabled={isBatchGeneratingRefs || characters.every(c => !c.avatarUrl)}
              className={`flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-600 border border-violet-200 font-medium rounded-xl hover:bg-violet-100 transition-all ${(isBatchGeneratingRefs || characters.every(c => !c.avatarUrl)) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isBatchGeneratingRefs ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              一键生成三视图
            </button>
             <button
              onClick={handleBatchGenerate}
              disabled={isBatchGenerating}
              className={`flex items-center gap-2 px-4 py-2 bg-cyan-50 text-cyan-500 border border-cyan-200 font-medium rounded-xl hover:bg-cyan-100 transition-all ${isBatchGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isBatchGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {characters.length > 0 && characters.every(c => c.avatarUrl) ? '重新生成所有立绘' : '一键生成立绘'}
            </button>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-cyan-500/25 transition-all"
            >
              <Plus size={18} />
              添加人物
            </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {characters.map((char) => (
          <div 
            key={char.id}
            onClick={() => handleEdit(char)}
            className="glass-card group relative p-4 cursor-pointer hover:border-cyan-300 transition-all flex flex-col items-center text-center"
          >
            {/* Action Buttons (Hover Only) */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
                {/* Generate References Button */}
                {char.avatarUrl && (
                  <button
                      onClick={(e) => handleGenerateRefs(e, char.id, char.name)}
                      disabled={generatingRefsId === char.id}
                      className={`p-1.5 rounded-lg transition-colors ${generatingRefsId === char.id ? 'bg-cyan-100 text-cyan-500' : 'text-slate-400 hover:text-cyan-500 hover:bg-slate-100'}`}
                      title="一键生成多角度参考图"
                  >
                      {generatingRefsId === char.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  </button>
                )}
                {/* Regenerate Avatar Button */}
                <button
                    onClick={(e) => handleRegenerateAvatar(e, char.id, char.name)}
                    disabled={generatingCharId === char.id}
                    className={`p-1.5 text-slate-400 hover:text-cyan-500 hover:bg-slate-100 rounded-lg ${generatingCharId === char.id ? 'opacity-50' : ''}`}
                    title="重新生成立绘"
                >
                    <RefreshCw size={14} className={generatingCharId === char.id ? 'animate-spin' : ''} />
                </button>
                {/* Delete Button */}
                <button
                    onClick={(e) => handleDelete(e, char.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-lg"
                    title="删除角色"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            {/* Avatar */}
            <div className="w-20 h-20 rounded-full bg-slate-50 mb-3 overflow-hidden border border-slate-200 group-hover:border-cyan-300 transition-colors relative">
              {char.avatarUrl ? (
                <ImageWithPreview 
                  src={char.avatarUrl} 
                  alt={char.name} 
                  className="w-full h-full object-cover" 
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center relative">
                   {isBatchGenerating ? (
                       <>
                         <div className="absolute inset-0 bg-indigo-500/10 animate-pulse"></div>
                         <Loader2 size={24} className="text-indigo-400 animate-spin relative z-10" />
                       </>
                   ) : (
                       <User size={32} className="text-slate-300 group-hover:text-cyan-500" />
                   )}
                </div>
              )}
            </div>

            {/* Info */}
            <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-cyan-500 transition-colors">
              {char.name}
            </h3>
            {char.description && (
              <p className="text-xs text-slate-500 line-clamp-2 mb-2 w-full px-2">
                {char.description}
              </p>
            )}

            {/* Voice Tag */}
            {char.voiceId ? (
              <div className="mt-auto flex items-center gap-1 text-xs text-cyan-500 bg-cyan-50 px-2 py-1 rounded-full">
                <Mic size={10} />
                {getVoiceName(char.voiceId)}
              </div>
            ) : (
              <div className="mt-auto text-xs text-slate-300">
                未关联配音
              </div>
            )}
          </div>
        ))}
        
        {characters.length === 0 && (
          <div className="col-span-full border border-dashed border-slate-200 rounded-2xl p-12 text-center bg-slate-50">
             <div className="w-16 h-16 rounded-full bg-cyan-50 flex items-center justify-center mx-auto mb-4">
                <User size={32} className="text-cyan-500" />
             </div>
             <h3 className="text-lg font-bold text-slate-900 mb-2">暂无人物</h3>
             <p className="text-slate-500 mb-6 max-w-sm mx-auto">还没有添加任何角色。您可以手动添加，或通过导入小说自动提取。</p>
             <button
               onClick={handleCreate}
               className="inline-flex items-center gap-2 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded-xl transition-all"
             >
               <Plus size={18} />
               添加人物
             </button>
          </div>
        )}
      </div>

      <CharacterModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initialData={selectedCharacter}
        projectId={projectId}
        voices={voices}
      />

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
