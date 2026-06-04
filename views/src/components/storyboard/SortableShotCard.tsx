
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';

import type { Shot } from '../../types/drama';

interface SortableShotCardProps {
  shot: Shot;
  index: number;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onPlay: () => void;
  isPlaying: boolean;
  onRegenerate: () => void;
}

export function SortableShotCard({ 
    shot, 
    index, 
    isSelected, 
    onSelect, 
    onRegenerate
}: SortableShotCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shot.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative aspect-video bg-slate-100 rounded-xl overflow-hidden border-2 transition-all cursor-grab active:cursor-grabbing
        ${isSelected ? 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.3)]' : 'border-slate-200 hover:border-slate-300'}
      `}
      {...attributes}
      {...listeners}
      onClick={onSelect}
    >
      {/* Image */}
      {shot.imageUrl ? (
        <img src={shot.imageUrl} alt={`Shot ${index + 1}`} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400">
            <span className="text-2xl font-bold opacity-20">{index + 1}</span>
        </div>
      )}

      {/* Overlay Gradient (Hover) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
        
        {/* Top Controls */}
        <div className="absolute top-2 right-2 flex gap-1 transform translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
            <button 
                onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
                className="p-1.5 bg-slate-800/60 hover:bg-cyan-500 rounded-lg text-white/80 hover:text-white backdrop-blur transition-colors"
                title="重绘"
            >
                <RefreshCw size={14} />
            </button>
        </div>

        {/* Bottom Info */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white/90">Shot {String(index + 1).padStart(2, '0')}</span>
                <span className="text-[10px] text-slate-300 bg-black/50 px-1.5 rounded">{mockDuration()}</span>
            </div>
            
             {/* Status Icon */}
             {(shot.status === 'video_completed' || shot.status === 'image_completed') && <Check size={14} className="text-emerald-400" />}
             {shot.status === 'queued' && <RefreshCw size={14} className="text-yellow-400 animate-pulse" />}
             {shot.status === 'processing' && <RefreshCw size={14} className="text-amber-400 animate-spin" />}
             {shot.status === 'failed' && <AlertTriangle size={14} className="text-red-400" />}
        </div>
      </div>

       {/* Selection Check (if selected) */}
       {isSelected && (
           <div className="absolute top-2 left-2 w-5 h-5 bg-cyan-500 rounded-full flex items-center justify-center text-white border border-slate-200/30 shadow-lg z-20">
               <Check size={12} strokeWidth={3} />
           </div>
       )}
    </div>
  );
}

function mockDuration() {
    // Just a mock function to show "duration" based on text length maybe?
    return "3.5s";
}
