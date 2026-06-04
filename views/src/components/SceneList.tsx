import { useState } from 'react';
import { Plus, Image as ImageIcon, Sparkles, Loader2, Trash2 } from 'lucide-react';
import ImageWithPreview from './ImageWithPreview';
import SceneModal from './SceneModal';
import { useToast } from './ToastContext';

import type { Scene } from '../types/drama';

interface SceneListProps {
  projectId: string;
  scenes: Scene[];
  onRefresh: () => Promise<void>;
}

export default function SceneList({
  projectId,
  scenes,
  onRefresh
}: SceneListProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const handleEdit = (scene: Scene) => {
    if (generatingIds.has(scene.id)) return; // Don't edit while generating
    setSelectedScene(scene);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setSelectedScene(null);
    setModalOpen(true);
  };

  const handleBatchGenerate = async () => {
    if (scenes.length === 0) {
      toast('该项目没有任何场景', 'info');
      return;
    }

    setIsBatchGenerating(true);
    // Mark all scenes as generating
    const newGeneratingIds = new Set(generatingIds);
    scenes.forEach(s => newGeneratingIds.add(s.id));
    setGeneratingIds(newGeneratingIds);

    try {
      const res = await fetch(`/api/scenes/batch-generate-scene?project_id=${projectId}`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        toast(`批量生成完成: ${data.success_count}/${data.total_attempted} 成功`, 'success');
        await onRefresh();
      } else {
        const errorData = await res.json().catch(() => ({ detail: '生成失败' }));
        toast(errorData.detail || '生成失败', 'error');
      }
    } catch (error) {
      console.error('Batch generate error:', error);
      toast('请求出错', 'error');
    } finally {
      setIsBatchGenerating(false);
      setGeneratingIds(new Set());
    }
  };

  const handleRegenerateScene = async (e: React.MouseEvent, sceneId: string) => {
    e.stopPropagation();
    if (generatingIds.has(sceneId)) return;

    setGeneratingIds(prev => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/scenes/${sceneId}/generate`, {
        method: 'POST'
      });
      if (res.ok) {
        toast('场景生成中...', 'info');
        await onRefresh();
      } else {
        const errorData = await res.json().catch(() => ({ detail: '生成失败' }));
        toast(errorData.message || errorData.detail || '生成失败', 'error');
      }
    } catch (error) {
      console.error('Generate error:', error);
      toast('请求出错', 'error');
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(sceneId);
        return next;
      });
    }
  };

  const handleDelete = async (e: React.MouseEvent, sceneId: string) => {
    e.stopPropagation();
    if (!window.confirm('确定要删除这个场景吗？')) return;

    try {
      const res = await fetch(`/api/scenes/${sceneId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        toast('场景已删除', 'success');
        await onRefresh();
      } else {
        toast('删除失败', 'error');
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast('请求出错', 'error');
    }
  };

  const handleSave = async (data: Partial<Scene> & { imageFile?: File }) => {
    try {
      let imageUrl = selectedScene?.imageUrl;

      // 1. 上传图片（如果有）
      if (data.imageFile) {
        const formData = new FormData();
        formData.append('file', data.imageFile);
        const uploadRes = await fetch('/api/upload/image', {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) throw new Error('Failed to upload scene image');
        const uploadData = await uploadRes.json();
        imageUrl = uploadData.url;
      }

      // 2. 构建数据
      const payload = {
        project_id: projectId,
        name: data.name,
        description: data.description,
        prompt: data.prompt,
        image_url: imageUrl,
      };

      // 3. 调用 API
      const url = selectedScene 
        ? `/api/scenes/${selectedScene.id}`
        : '/api/scenes';
      
      const method = selectedScene ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Failed to save scene');

      // 4. 刷新列表
      await onRefresh();
      toast('场景保存成功', 'success');
      setModalOpen(false); // Close on success
      
    } catch (error) {
      console.error('Save error:', error);
      toast('保存失败，请重试', 'error');
      throw error;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">场景管理</h2>
        <div className="flex items-center gap-3">
            <button
              onClick={handleBatchGenerate}
              disabled={isBatchGenerating}
              className={`flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 text-slate-900 font-medium rounded-xl hover:bg-slate-100 transition-all ${isBatchGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isBatchGenerating ? (
                <Loader2 size={18} className="animate-spin text-cyan-500" />
              ) : (
                <Sparkles size={18} className="text-cyan-500" />
              )}
              一键生成场景
            </button>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-cyan-500/25 transition-all"
            >
              <Plus size={18} />
              添加场景
            </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {scenes.map((scene) => (
          <div 
            key={scene.id}
            onClick={() => handleEdit(scene)}
            className="glass-card group relative cursor-pointer hover:border-cyan-300 transition-all overflow-hidden"
          >
            {/* Image Thumbnail */}
            <div className="aspect-video w-full bg-slate-50 relative">
              {scene.imageUrl ? (
                <ImageWithPreview 
                  src={scene.imageUrl} 
                  alt={scene.name} 
                  className="w-full h-full object-cover" 
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center relative">
                   {generatingIds.has(scene.id) ? (
                       <>
                         <div className="absolute inset-0 bg-indigo-500/10 animate-pulse"></div>
                         <Loader2 size={24} className="text-cyan-500 animate-spin relative z-10" />
                       </>
                   ) : (
                       <ImageIcon size={32} className="text-slate-300 group-hover:text-cyan-500" />
                   )}
                </div>
              )}
              
              {/* Individual Regenerate Button */}
              {!generatingIds.has(scene.id) && (
                  <div className="absolute top-2 right-2 z-10 flex gap-2">
                    <button
                      onClick={(e) => handleRegenerateScene(e, scene.id)}
                      className="p-1.5 bg-white/80 backdrop-blur-md rounded-lg text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-cyan-500"
                      title="重新生成"
                    >
                      <Sparkles size={14} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, scene.id)}
                      className="p-1.5 bg-white/80 backdrop-blur-md rounded-lg text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                      title="删除场景"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
              )}

              {/* Overlay */}
              {!generatingIds.has(scene.id) && (
                  <div className="absolute inset-0 bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span className="text-slate-900 text-sm font-medium">点击编辑 / 预览</span>
                  </div>
              )}
            </div>

            {/* Info */}
            <div className="p-3">
              <h3 className="font-semibold text-slate-900 truncate mb-1">
                {scene.name}
              </h3>
              {scene.description && (
                <p className="text-xs text-slate-500 line-clamp-2">
                  {scene.description}
                </p>
              )}
            </div>
          </div>
        ))}
        
        {scenes.length === 0 && (
          <div className="col-span-full border border-dashed border-slate-200 rounded-2xl p-12 text-center bg-slate-50">
             <div className="w-16 h-16 rounded-full bg-cyan-50 flex items-center justify-center mx-auto mb-4">
                <ImageIcon size={32} className="text-cyan-500" />
             </div>
             <h3 className="text-lg font-bold text-slate-900 mb-2">暂无场景</h3>
             <p className="text-slate-500 mb-6 max-w-sm mx-auto">场景库为空。您可以上传图片或使用 AI 生成场景图。</p>
             <button
               onClick={handleCreate}
               className="inline-flex items-center gap-2 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded-xl transition-all"
             >
               <Plus size={18} />
               添加场景
             </button>
          </div>
        )}
      </div>

      <SceneModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={async (id) => {
           try {
             const res = await fetch(`/api/scenes/${id}`, { method: 'DELETE' });
             if (res.ok) {
               toast('场景已删除', 'success');
               await onRefresh();
             } else {
               toast('删除失败', 'error');
             }
           } catch (err) {
             console.error(err);
             toast('请求出错', 'error');
           }
        }}
        initialData={selectedScene}
        projectId={projectId}
      />
    </div>
  );
}
