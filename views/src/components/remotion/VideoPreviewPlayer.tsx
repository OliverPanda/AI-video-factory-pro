import { useMemo } from 'react';
import { Player } from '@remotion/player';
import { PreviewComposition, type VideoSegment } from './PreviewComposition';

interface VideoPreviewPlayerProps {
  segments: VideoSegment[];
  width?: number;
  height?: number;
  fps?: number;
  className?: string;
  autoPlay?: boolean;
}

export const VideoPreviewPlayer = ({
  segments,
  width = 1280,
  height = 720,
  fps = 30,
  className = "",
  autoPlay = false
}: VideoPreviewPlayerProps) => {
  // Memoize duration to avoid recalculation
  const totalDurationInFrames = useMemo(() => {
    return segments.reduce((sum, s) => sum + s.durationInFrames, 0) || 1;
  }, [segments]);

  // Memoize inputProps as recommended by Remotion docs
  const inputProps = useMemo(() => ({ segments }), [segments]);

  return (
    <div className={`relative overflow-hidden group bg-[#050505] shadow-2xl transition-all duration-500 rounded-2xl ring-1 ring-slate-300/20 ${className}`}>
      <Player
        component={PreviewComposition}
        inputProps={inputProps}
        durationInFrames={totalDurationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{
          width: '100%',
          aspectRatio: `${width} / ${height}`,
        }}
        controls
        autoPlay={autoPlay}
        loop
      />
      
      {/* Overlay hint for interactivity - subtle branding */}
      <div className="absolute top-4 left-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
         <span className="px-2 py-1 bg-black/40 backdrop-blur-md rounded text-[10px] text-white/60 border border-slate-400/15 uppercase tracking-tighter">
            AI Studio Preview
         </span>
      </div>
    </div>
  );
};

export default VideoPreviewPlayer;
