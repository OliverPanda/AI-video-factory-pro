import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { StoryboardScene } from '../../types/storyboard';
import { GripVertical, Trash2, Play } from 'lucide-react';

interface SceneCardProps {
  scene: StoryboardScene;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<StoryboardScene>) => void;
  onPreview: (scene: StoryboardScene) => void;
  isActive: boolean; // Is currently playing in preview
}

export const SceneCard: React.FC<SceneCardProps> = ({ 
  scene, 
  index, 
  onRemove, 
  onUpdate,
  onPreview,
  isActive 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: scene.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col w-64 h-80 bg-white rounded-xl border-2 overflow-hidden transition-all
        ${isActive ? 'border-yellow-500 shadow-yellow-500/20 shadow-lg' : 'border-slate-200 hover:border-slate-300'}
      `}
    >
      {/* Header / Drag Handle */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-100/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button 
            {...attributes} 
            {...listeners} 
            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
          >
            <GripVertical size={16} />
          </button>
          <span className="text-xs font-mono text-slate-400">#{index + 1}</span>
        </div>
        <button 
          onClick={() => onRemove(scene.id)}
          className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Thumbnail Area - Click to Preview */}
      <div 
        className="relative flex-1 bg-slate-200 group/preview cursor-pointer"
        onClick={() => onPreview(scene)}
      >
        {scene.content.thumbnail || scene.content.src ? (
            scene.type === 'video' ? (
                 <video 
                    src={scene.content.src} 
                    className="w-full h-full object-cover" 
                    muted 
                    loop 
                    onMouseOver={e => e.currentTarget.play()}
                    onMouseOut={e => {
                        e.currentTarget.pause();
                        e.currentTarget.currentTime = 0;
                    }}
                 />
            ) : (
                <img 
                    src={scene.content.src} 
                    alt="Scene thumbnail" 
                    className="w-full h-full object-cover"
                />
            )
        ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300">
                No Media
            </div>
        )}
        
        {/* Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity bg-black/20">
            <Play className="text-white drop-shadow-md" size={32} fill="currentColor" />
        </div>
        
        {/* Duration Badge */}
        <div className="absolute bottom-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-xs text-white font-mono">
           {scene.duration}s
        </div>
      </div>

      {/* Script Input Area */}
      <div className="p-3 bg-slate-50 border-t border-slate-200">
        <textarea
          value={scene.script.text}
          onChange={(e) => onUpdate(scene.id, { 
              script: { ...scene.script, text: e.target.value } 
          })}
          className="w-full h-20 bg-transparent text-sm text-slate-600 resize-none focus:outline-none placeholder-slate-400"
          placeholder="输入台词或脚本..."
        />
      </div>
    </div>
  );
};
