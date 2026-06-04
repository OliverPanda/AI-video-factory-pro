import React from 'react';
import { X, Clapperboard, Download, ShieldCheck } from 'lucide-react';
import VideoPreviewPlayer from './VideoPreviewPlayer';
import type { VideoSegment } from './PreviewComposition';

interface VideoPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: VideoSegment[];
  chapterTitle?: string;
  downloadUrl?: string | null;
}

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  isOpen,
  onClose,
  segments,
  chapterTitle = "全片预览",
  downloadUrl
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-8 overflow-hidden">
      {/* Premium Backdrop with subtle gradient */}
      <div 
        className="absolute inset-0 bg-[#020202]/95 backdrop-blur-2xl animate-in fade-in duration-500"
        onClick={onClose}
      />
      
      {/* Gradient ambient glow behind modal */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[60%] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none opacity-50" />

      {/* Modal Content */}
      <div className="relative w-full max-w-5xl bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.15)] animate-in zoom-in-95 duration-500 flex flex-col">
        
        {/* Header - Glassmorphic */}
        <div className="flex items-center justify-between p-7 border-b border-slate-200 bg-slate-50 backdrop-blur-md relative overflow-hidden">
           {/* Header Accent Line */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
          
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-cyan-50 text-cyan-500 border border-cyan-500/20 shadow-inner">
              <Clapperboard size={22} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 leading-tight tracking-tight font-heading">
                {chapterTitle}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] text-slate-500 font-bold border border-slate-200 uppercase tracking-widest">
                  Preview Mode
                </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  30 FPS • {segments.length} Shots • Seamless Playback
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {downloadUrl && (
              <a 
                href={downloadUrl}
                download
                className="group relative flex items-center gap-2 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-bold transition-all shadow-xl shadow-cyan-500/30 hover:scale-105 active:scale-95"
              >
                <Download size={16} className="group-hover:bounce" />
                <span>下载视频</span>
                <div className="absolute -inset-1 bg-cyan-500/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />
              </a>
            )}
            <button 
              onClick={onClose}
              className="p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all border border-slate-200 shadow-lg"
              title="关闭预览"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Player Body - Focused Cinema Layout */}
        <div className="flex-1 p-6 md:p-10 bg-black/40 flex items-center justify-center">
          <div className="w-full max-w-4xl mx-auto">
            <VideoPreviewPlayer 
              segments={segments} 
              autoPlay={true}
              className="w-full shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)]"
            />
          </div>
        </div>

        {/* Footer info - Status bar style */}
        <div className="px-8 py-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            Real-time Rendering Engine
          </div>
          
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <ShieldCheck size={12} className="text-cyan-500/50" />
                <span>Verified Content</span>
             </div>
             <div className="text-[10px] text-cyan-500/50 font-black tracking-tighter">
                AI VIDEO FACTORY V2.0
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default VideoPreviewModal;
