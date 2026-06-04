import React, { useState } from 'react';
import { StoryboardContainer } from '../components/storyboard/Container';
import type { StoryboardScene } from '../types/storyboard';
import { Play, Download, Wand2 } from 'lucide-react';

const INITIAL_SCENES: StoryboardScene[] = [
  {
    id: '1',
    type: 'image',
    content: {
      src: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&auto=format&fit=crop&q=60',
      prompt: 'A dark forest at night',
    },
    script: {
      text: '在一个寂静的夜晚，森林充满了神秘的气息...',
      duration: 3,
    },
    duration: 3,
  },
  {
    id: '2',
    type: 'image',
    content: {
      src: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&auto=format&fit=crop&q=60',
      prompt: 'A gentle river flowing',
    },
    script: {
      text: '远处传来了流水的响声。',
      duration: 3,
    },
    duration: 3,
  },
];

export const Editor: React.FC = () => {
  const [scenes, setScenes] = useState<StoryboardScene[]>(INITIAL_SCENES);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPreviewScene, setCurrentPreviewScene] = useState<StoryboardScene | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>('');

  const handleExport = async () => {
      if (isExporting) return;
      
      try {
          setIsExporting(true);
          setExportStatus('正在提交任务...');

          // 1. Submit Render Task
          const response = await fetch('/api/storyboard/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  scenes,
                  config: {
                      resolution: '1080p',
                      aspect_ratio: '16:9',
                      // Global BGM can be added here later
                  }
              })
          });

          if (!response.ok) {
              throw new Error('Failed to submit render task');
          }

          const { task_id } = await response.json();
          setExportStatus('任务已提交，正在渲染...');

          // 2. Poll for Status
          const pollInterval = setInterval(async () => {
              try {
                  const statusRes = await fetch(`/api/storyboard/tasks/${task_id}`);
                  const statusData = await statusRes.json();

                  if (statusData.status === 'completed') {
                      clearInterval(pollInterval);
                      setIsExporting(false);
                      setExportStatus('');
                      // Open video or show download link
                      if (statusData.output_url) {
                          const dowloadUrl = statusData.output_url;
                          // Create a temporary link to download
                          const link = document.createElement('a');
                          link.href = dowloadUrl;
                          link.download = `storyboard_video_${task_id}.mp4`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                      }
                      alert('导出成功！视频已开始下载。');
                  } else if (statusData.status === 'error') {
                      clearInterval(pollInterval);
                      setIsExporting(false);
                      setExportStatus('');
                      alert(`导出失败: ${statusData.error}`);
                  } else {
                      setExportStatus(`正在渲染... ${statusData.progress || 0}%`);
                  }
              } catch (e) {
                  console.error('Polling error', e);
              }
          }, 2000);

      } catch (error) {
          console.error(error);
          setIsExporting(false);
          alert('导出请求失败，请检查后端服务');
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation */}
      <header className="h-16 border-b border-slate-200 flex items-center justify-between px-6 bg-white">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center">
            <Wand2 size={20} />
          </div>
          <h1 className="text-lg font-bold">AI Video Factory <span className="text-xs font-normal text-slate-400 ml-2">Storyboard Mode</span></h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-sm"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            <Play size={16} className={isPlaying ? "text-green-500 fill-green-500" : ""} />
            {isPlaying ? '停止预览' : '全片预览'}
          </button>
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors text-sm font-medium"
            onClick={handleExport}
          >
            <Download size={16} />
            导出视频
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* Preview Player / Stage (Placeholder for now) */}
        <div className="flex-1 bg-slate-100/50 flex items-center justify-center p-8 border-b border-slate-200">
            {currentPreviewScene ? (
                 <div className="aspect-video h-full max-h-[50vh] bg-slate-100 rounded-lg overflow-hidden shadow-2xl relative">
                    <img 
                        src={currentPreviewScene.content.src} 
                        className="w-full h-full object-contain"
                        alt="Preview"
                    />
                    <div className="absolute bottom-10 left-0 right-0 text-center px-8">
                        <p className="text-slate-900 text-xl font-medium drop-shadow-md bg-slate-100/50 inline-block px-4 py-2 rounded">
                            {currentPreviewScene.script.text}
                        </p>
                    </div>
                 </div>
            ) : (
                <div className="text-slate-400 flex flex-col items-center">
                    <Play size={48} className="mb-4 opacity-20" />
                    <p>点击分镜卡片进行预览</p>
                </div>
            )}
        </div>

        {/* Storyboard Timeline */}
        <div className="h-[420px] bg-white border-t border-slate-200 flex flex-col">
            <div className="px-6 py-3 border-b border-slate-200 text-sm text-slate-500 flex justify-between">
                <span>分镜脚本 ({scenes.length})</span>
                <span>总时长: {scenes.reduce((acc, s) => acc + s.duration, 0)}s</span>
            </div>
            
            <StoryboardContainer 
                scenes={scenes}
                setScenes={setScenes}
                currentPlayingId={currentPreviewScene?.id}
                onPreviewScene={setCurrentPreviewScene}
            />
        </div>
      </main>
      {/* Export Loading Overlay */}
      {isExporting && (
          <div className="fixed inset-0 bg-white/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
              <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">视频生成中</h3>
              <p className="text-slate-500">{exportStatus}</p>
          </div>
      )}
    </div>
  );
};
